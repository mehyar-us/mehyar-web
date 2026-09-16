// pwa/fulfillPromptpack.js
// Standalone ES module: Stripe fulfillment for fulfillment='promptpack' products.
// Called from the shared /api/pay/webhook in mehyar-web. Modeled on the
// webhook's `digital` hook and the reference fulfill-designful.js.
//
// Contract: fulfillPromptpack({ db, env, waitUntil, sendEmail }, payment)
//   db        — D1 binding (shared mehyar-jobs DB; has promptpack_orders)
//   env       — worker env (PROMPTPACK_BASE_URL optional; falls back to the
//               production URL so the webhook works with no env change)
//   waitUntil — Pages Functions waitUntil (optional; falls back to await)
//   sendEmail — injected mailer: sendEmail(env, {from, fromName, to, replyTo,
//               subject, text, html}) -> {ok, ...}. NEVER sends in local dev:
//               the caller injects a stub. In prod, mehyar-web injects a
//               wrapper around sendCloudflareEmail.
//   payment   — billing_payments row {id, product_id, email, metadata_json}
//               metadata_json = flat checkout params {profession}
//
// Behavior:
//   1. Idempotent: exactly one promptpack_orders row per payment.id
//      (UNIQUE index idx_promptpack_orders_payment). Replays return early.
//   2. Single SKU: create the order, unify the access token onto the
//      billing_payments row, then background-POST the product's
//      /api/promptpack/generate endpoint. On success email the buyer the
//      token-gated deliverable link; on failure mark failed (no email — the
//      deliverable page shows live status + retry).

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const PROFESSIONS = ["contractor", "realtor", "coach-consultant", "freelancer"];
const PROF_NAMES = {
  "contractor": "Contractor",
  "realtor": "Realtor",
  "coach-consultant": "Coach & Consultant",
  "freelancer": "Freelancer"
};

function randomToken(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function baseUrl(env) {
  return String(env.PROMPTPACK_BASE_URL || "https://promptpack.mehyar.us").replace(/\/+$/, "");
}

function fromAddress(env) {
  // Until the promptpack subdomain is onboarded on both ESPs (standing rule),
  // send from the proven mehyar.us identity.
  return {
    from: env.PROMPTPACK_FROM_EMAIL || "team@mehyar.us",
    fromName: "PromptPack Pro"
  };
}

function readProfession(payment) {
  let meta = {};
  try {
    meta = JSON.parse(payment.metadata_json || "{}");
  } catch {}
  // NOTE: the centralized /api/pay/checkout stores body.params FLAT as
  // metadata_json. Accept both the flat shape and a wrapped {inputs:{...}}.
  const inputs = (meta && typeof meta === "object" && meta.inputs) || meta || {};
  const raw = String(inputs.profession || "").toLowerCase().trim();
  return PROFESSIONS.includes(raw) ? raw : "contractor"; // never fail on a bad value
}

export async function fulfillPromptpack({ db, env, waitUntil, sendEmail }, payment) {
  if (!db || !payment || !payment.id) throw new Error("fulfillPromptpack: bad args");

  const productId = payment.product_id;
  const profession = readProfession(payment);
  const profName = PROF_NAMES[profession] || profession;

  // ── idempotent order create (one row per payment) ──
  const existing = await db
    .prepare("SELECT id, access_token, status, product_id FROM promptpack_orders WHERE payment_id = ?")
    .bind(payment.id)
    .first();
  if (existing) {
    return { ok: true, replay: true, order_id: existing.id, status: existing.status };
  }

  const accessToken = randomToken(32);
  const inputsJson = JSON.stringify({ inputs: { profession } });
  const ins = await db
    .prepare(
      "INSERT INTO promptpack_orders (payment_id, product_id, email, inputs_json, status, access_token) " +
        "VALUES (?, ?, ?, ?, 'paid', ?)"
    )
    .bind(payment.id, productId, payment.email, inputsJson, accessToken)
    .run();
  const orderId = ins.meta.last_row_id;

  // Token unification: the Stripe success_url_template receives
  // billing_payments.access_token, but the deliverable page gates on
  // promptpack_orders tokens. Point the payment row at the order token so
  // ONE token works everywhere.
  await db
    .prepare("UPDATE billing_payments SET access_token = ? WHERE id = ?")
    .bind(accessToken, payment.id)
    .run();

  const { from, fromName } = fromAddress(env);

  const run = async () => {
    try {
      const genResp = await fetch(`${baseUrl(env)}/api/promptpack/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_token: accessToken, profession })
      });
      const genData = await genResp.json().catch(() => ({}));
      if (!genResp.ok || !genData.ok) {
        throw new Error("generate:" + String((genData && genData.error) || genResp.status));
      }
      // generate.js already marked the order ready; just confirm it's there.
      const check = await db
        .prepare("SELECT status FROM promptpack_orders WHERE id = ?")
        .bind(orderId)
        .first();
      if (!check || check.status !== "ready") {
        throw new Error("generate:not_ready");
      }

      const deliverUrl = `${baseUrl(env)}/deliverable.html?token=${accessToken}`;
      const subject = `Your PromptPack Pro (${profName}) is ready`;
      const text =
        `Thanks for your purchase!\n\n` +
        `Your PromptPack Pro pack for ${profName} is ready — 50 prompts + 10 swipe files:\n${deliverUrl}\n\n` +
        `There's a one-click PDF download on the page. ` +
        `This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.\n\n-- ${fromName}`;
      const html =
        `<p>Thanks for your purchase!</p>` +
        `<p>Your <strong>PromptPack Pro</strong> pack for <strong>${profName}</strong> is ready — 50 prompts + 10 swipe files.</p>` +
        `<p><a href="${deliverUrl}" style="display:inline-block;background:#f59e0b;color:#1a1206;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Open your pack</a></p>` +
        `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${deliverUrl}">${deliverUrl}</a></p>` +
        `<p style="color:#6b7280;font-size:13px;">There's a one-click PDF download on the page. This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.</p>` +
        `<p>-- ${fromName}</p>`;
      const result = await sendEmail(env, { from, fromName, to: payment.email, replyTo: "info@mehyar.us", subject, text, html });
      if (!result.ok) console.error("fulfillPromptpack deliverable email failed", productId, result.error);
    } catch (e) {
      console.error("fulfillPromptpack background generate failed", productId, e && e.message);
      try {
        await db.prepare("UPDATE promptpack_orders SET status='failed' WHERE id=? AND status IN ('paid','generating')")
          .bind(orderId).run();
      } catch {}
      // No email on failure: the buyer lands on success.html?token= from
      // Stripe, which shows live status + a retry path via deliverable.html.
    }
  };

  if (typeof waitUntil === "function") waitUntil(run());
  else await run();

  return { ok: true, order_id: orderId, mode: "single", profession };
}
