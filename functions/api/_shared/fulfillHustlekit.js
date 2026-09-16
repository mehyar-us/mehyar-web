// pwa/fulfill-hustlekit.js
// Standalone ES module: Stripe fulfillment for fulfillment='hustlekit' products.
// Called from the shared /api/pay/webhook in mehyar-web.
// Modeled on fulfillDesignful.js.
//
// Contract: fulfillHustlekit({ db, env, waitUntil, sendEmail }, payment)
//   db        — D1 binding (shared mehyar_leads_prod DB; has hustlekit_orders)
//   env       — worker env (HUSTLEKIT_BASE_URL optional; defaults below)
//   waitUntil — Pages Functions waitUntil (optional; falls back to await)
//   sendEmail — injected mailer: sendEmail(env, {from, fromName, to, replyTo,
//               subject, text, html}) -> {ok, ...}. NEVER sends in local dev:
//               the caller injects a stub. In prod, mehyar-web injects a
//               wrapper around sendCloudflareEmail.
//   payment   — billing_payments row {id, product_id, email, metadata_json}
//               metadata_json = checkout body.params FLAT:
//               {track, skills, hours_per_week, income_goal, experience_level, niche}
//
// Behavior:
//   1. Idempotent: exactly one hustlekit_orders row per payment.id
//      (UNIQUE constraint on payment_id). Replays return early.
//   2. Token unification: UPDATE billing_payments SET access_token =
//      <order_token> so ONE token gates every HustleKit surface.
//   3. Background: POST HUSTLEKIT_BASE_URL/api/hustlekit/generate
//      {order_token, track, inputs}; on success mark ready + email the
//      token-gated deliverable link; on failure mark failed (buyer retries
//      from success.html?token=).

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const TRACKS = {
  "ai-writing": "AI freelance writing",
  "ai-video": "AI video editing",
  "ai-social": "AI social-media management",
};

function randomToken(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function baseUrl(env) {
  // NOTE 2026-09-16: hustlekit.mehyar.us is still provisioning on Cloudflare
  // (Pages custom-domain "pending" — does not resolve). Until it goes live,
  // hit the stable production Pages URL so generation + deliverable links
  // actually work. HUSTLEKIT_BASE_URL env overrides when set.
  return String(env.HUSTLEKIT_BASE_URL || "https://hustlekit.pages.dev").replace(/\/+$/, "");
}

function fromAddress(env) {
  // Until the hustlekit subdomain is onboarded on both ESPs (standing rule),
  // send from the proven mehyar.us identity.
  return {
    from: env.HUSTLEKIT_FROM_EMAIL || "team@mehyar.us",
    fromName: "HustleKit",
  };
}

export async function fulfillHustlekit({ db, env, waitUntil, sendEmail }, payment) {
  if (!db || !payment || !payment.id) throw new Error("fulfillHustlekit: bad args");

  const productId = payment.product_id;

  let meta = {};
  try {
    meta = JSON.parse(payment.metadata_json || "{}");
  } catch {}
  // NOTE: the centralized /api/pay/checkout stores body.params FLAT as
  // metadata_json (see checkout.js: metadata_json = JSON.stringify(params)).
  // Accept both the flat shape and a wrapped {inputs:{...}} shape.
  const inputs = (meta && typeof meta === "object" && meta.inputs) || meta || {};
  const track = inputs.track || "ai-writing";

  // ── idempotent order create (one row per payment) ──
  const existing = await db
    .prepare("SELECT id, access_token, status, product_id FROM hustlekit_orders WHERE payment_id = ?")
    .bind(payment.id)
    .first();
  if (existing) {
    return { ok: true, replay: true, order_id: existing.id, status: existing.status };
  }

  // Token: REUSE the payment's access_token (it's already in the buyer's
  // success URL). Generating a new token orphans the success link.
  const accessToken = payment.access_token || randomToken(32);
  const inputsJson = JSON.stringify({ track, inputs });
  const ins = await db
    .prepare(
      "INSERT INTO hustlekit_orders (payment_id, product_id, email, inputs_json, status, access_token) " +
        "VALUES (?, ?, ?, ?, 'paid', ?)"
    )
    .bind(payment.id, productId, payment.email, inputsJson, accessToken)
    .run();
  const orderId = ins.meta.last_row_id;

  const { from, fromName } = fromAddress(env);
  const trackName = TRACKS[track] || track;

  // ── background generation, then email ──
  const run = async () => {
    try {
      const genResp = await fetch(`${baseUrl(env)}/api/hustlekit/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_token: accessToken, track, inputs }),
      });
      const genData = await genResp.json().catch(() => ({}));
      if (!genResp.ok || !genData.ok) {
        throw new Error("generate:" + String((genData && genData.error) || genResp.status));
      }
      await db
        .prepare(`UPDATE hustlekit_orders SET status='ready', output_json=?, ready_at=${nowSql} WHERE id=? AND status!='ready'`)
        .bind(JSON.stringify(genData.manifest || {}), orderId)
        .run();

      const deliverUrl = `${baseUrl(env)}/deliverable.html?token=${accessToken}`;
      const subject = `Your HustleKit playbook is ready`;
      const text =
        `Thanks for your purchase!\n\n` +
        `Your personalized ${trackName} playbook is ready:\n${deliverUrl}\n\n` +
        `Inside: your niche, your offer and pricing, where to find your first clients, word-for-word outreach scripts, and your 30-day action plan.\n\n` +
        `This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.\n\n-- ${fromName}`;
      const html =
        `<p>Thanks for your purchase!</p>` +
        `<p>Your personalized <strong>${trackName}</strong> playbook is ready:</p>` +
        `<p><a href="${deliverUrl}" style="display:inline-block;background:#65a30d;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Download your playbook</a></p>` +
        `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${deliverUrl}">${deliverUrl}</a></p>` +
        `<p style="color:#6b7280;font-size:13px;">Inside: your niche, your offer and pricing, where to find your first clients, word-for-word outreach scripts, and your 30-day action plan. This link is personal to you — keep it somewhere safe.</p>` +
        `<p>-- ${fromName}</p>`;
      const result = await sendEmail(env, { from, fromName, to: payment.email, replyTo: "info@mehyar.us", subject, text, html });
      if (!result.ok) console.error("fulfillHustlekit deliverable email failed", productId, result.error);
    } catch (e) {
      console.error("fulfillHustlekit background generate failed", productId, e && e.message);
      try {
        await db.prepare("UPDATE hustlekit_orders SET status='failed' WHERE id=? AND status='paid'")
          .bind(orderId).run();
      } catch {}
      // No email on failure: the buyer lands on success.html?token= from
      // Stripe, which shows live status + a retry button that re-POSTs
      // /api/hustlekit/generate with their token.
    }
  };

  if (typeof waitUntil === "function") waitUntil(run());
  else await run();

  return { ok: true, order_id: orderId, mode: "single", track };
}
