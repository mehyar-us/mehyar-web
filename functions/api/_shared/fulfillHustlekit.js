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
//   2. Token unification: UPDATE billing_payments SET access_token=<redacted>
//      <order_token> so ONE token gates every HustleKit surface.
//   3. Background: POST HUSTLEKIT_BASE_URL/api/hustlekit/generate
//      {order_token, track, inputs}; on success mark ready + email the
//      token-gated deliverable link; on failure mark failed (buyer retries
//      from success.html?token=).
//
// Reliability note (2026-09-16): the background generate run takes ~150s of
// mostly-idle Workers AI latency. A single waitUntil() driving it is fragile:
// if the webhook isolate is evicted mid-run, the row is orphaned in
// 'generating' forever (no catch runs — the isolate is gone, not errored).
// So this module is the OPTIMISTIC fast path only. The backstop is
// functions/api/pay/fulfillment-sweep.js (GitHub cron every 5 min): it
// re-arms rows stuck in paid/generating past STUCK_MINUTES, re-drives
// generate (idempotent), and sends the buyer email exactly once via the
// email_sent_at claim below. The two paths are mutually safe: generate is
// idempotent on ready, and the email claim is atomic.

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

export function hustlekitBaseUrl(env) {
  // NOTE 2026-09-16: hustlekit.mehyar.us is still provisioning on Cloudflare
  // (Pages custom-domain "pending" — does not resolve). Until it goes live,
  // hit the stable production Pages URL so generation + deliverable links
  // actually work. HUSTLEKIT_BASE_URL env overrides when set.
  return String(env.HUSTLEKIT_BASE_URL || "https://hustlekit.pages.dev").replace(/\/+$/, "");
}

export function hustlekitFromAddress(env) {
  // Until the hustlekit subdomain is onboarded on both ESPs (standing rule),
  // send from the proven mehyar.us identity.
  return {
    from: env.HUSTLEKIT_FROM_EMAIL || "team@mehyar.us",
    fromName: "HustleKit",
  };
}

// Shared buyer-email template. Used by the webhook fast path AND the sweep
// backstop so the buyer gets byte-identical mail whichever path wins.
export function buildHustlekitDeliverableEmail({ base, accessToken, track, fromName }) {
  const trackName = TRACKS[track] || track;
  const deliverUrl = `${base}/deliverable.html?token=${accessToken}`;
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
  return { subject, text, html, deliverUrl };
}

// Exactly-once email claim. The UPDATE is atomic: the first path to flip
// email_sent_at from NULL wins; losers see changes=0 and must not send.
export async function claimHustlekitEmailSent(db, orderId) {
  const r = await db
    .prepare(`UPDATE hustlekit_orders SET email_sent_at=${nowSql} WHERE id=? AND email_sent_at IS NULL`)
    .bind(orderId)
    .run()
    .catch(() => null);
  return r && r.meta && r.meta.changes > 0;
}

// Resume primitive: heal an order the optimistic fast path orphaned.
// Safe to call on any order: ready+emailed rows are a no-op (returns
// action 'already_done'). Re-arms stuck 'generating' rows (the generate
// endpoint only accepts paid/failed), re-drives generate (idempotent on
// ready), then sends the buyer email exactly once via the atomic claim.
// Used by the scheduled fulfillment-sweep AND the token-gated
// fulfill-backfill, so all recovery paths share one implementation.
export async function resumeHustlekitOrder({ db, env, sendEmail }, orderId) {
  const row = await db
    .prepare("SELECT id, email, inputs_json, status, access_token, email_sent_at FROM hustlekit_orders WHERE id=?")
    .bind(orderId)
    .first();
  if (!row) return { ok: false, error: "not_found" };
  if (row.status === "ready" && row.email_sent_at) {
    return { ok: true, action: "already_done", order_id: row.id };
  }
  const rec = { ok: true, order_id: row.id, from_status: row.status };
  const base = hustlekitBaseUrl(env);

  if (row.status === "generating") {
    await db
      .prepare("UPDATE hustlekit_orders SET status='failed' WHERE id=? AND status='generating'")
      .bind(row.id)
      .run();
    rec.rearmed = true;
  }

  let inputs = {};
  try { inputs = JSON.parse(row.inputs_json || "{}"); } catch {}
  const track = inputs.track || "ai-writing";

  try {
    const genResp = await fetch(`${base}/api/hustlekit/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ order_token: row.access_token, track, inputs }),
    });
    const genData = await genResp.json().catch(() => ({}));
    if (!genResp.ok || !genData.ok) {
      rec.generate = "failed:" + String((genData && genData.error) || genResp.status).slice(0, 80);
      return rec;
    }
    rec.generate = genData.replay ? "replay_ready" : "ok";
  } catch (e) {
    rec.generate = "threw:" + String((e && e.message) || e).slice(0, 80);
    return rec;
  }

  const order = await db
    .prepare("SELECT status, email_sent_at FROM hustlekit_orders WHERE id=?")
    .bind(row.id)
    .first();
  rec.status = order && order.status;
  if (!order || order.status !== "ready") {
    rec.email = "not_ready";
    return rec;
  }
  if (order.email_sent_at || !(await claimHustlekitEmailSent(db, row.id))) {
    rec.email = "already_sent";
    return rec;
  }
  const { from, fromName } = hustlekitFromAddress(env);
  const { subject, text, html } = buildHustlekitDeliverableEmail({
    base,
    accessToken: row.access_token,
    track,
    fromName,
  });
  const result = await sendEmail(env, {
    from,
    fromName,
    to: row.email,
    replyTo: "info@mehyar.us",
    subject,
    text,
    html,
  });
  if (result.ok) {
    rec.email = "sent:" + result.status;
  } else {
    // Release the claim so a later pass retries the send.
    await db
      .prepare("UPDATE hustlekit_orders SET email_sent_at=NULL WHERE id=?")
      .bind(row.id)
      .run()
      .catch(() => {});
    rec.email = "failed:" + String(result.error).slice(0, 120);
  }
  return rec;
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

  const { from, fromName } = hustlekitFromAddress(env);
  const base = hustlekitBaseUrl(env);

  // ── background generation, then email ──
  const run = async () => {
    try {
      const genResp = await fetch(`${base}/api/hustlekit/generate`, {
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

      const { subject, text, html } = buildHustlekitDeliverableEmail({ base, accessToken, track, fromName });
      const result = await sendEmail(env, { from, fromName, to: payment.email, replyTo: "info@mehyar.us", subject, text, html });
      if (result.ok) {
        await claimHustlekitEmailSent(db, orderId);
      } else {
        // Leave email_sent_at NULL: the sweep backstop will send it.
        console.error("fulfillHustlekit deliverable email failed", productId, result.error);
      }
    } catch (e) {
      console.error("fulfillHustlekit background generate failed", productId, e && e.message);
      try {
        await db.prepare("UPDATE hustlekit_orders SET status='failed' WHERE id=? AND status='paid'")
          .bind(orderId).run();
      } catch {}
      // No email on failure: the buyer lands on success.html?token= from
      // Stripe, which shows live status + a retry button that re-POSTs
      // /api/hustlekit/generate with their token. The sweep backstop also
      // re-drives stuck rows automatically.
    }
  };

  if (typeof waitUntil === "function") waitUntil(run());
  else await run();

  return { ok: true, order_id: orderId, mode: "single", track };
}
