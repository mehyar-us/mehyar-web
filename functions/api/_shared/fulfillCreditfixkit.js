// functions/api/_shared/fulfillCreditfixkit.js
// Standalone ES module: Stripe fulfillment for fulfillment='creditfixkit' products.
// Called from the shared /api/pay/webhook in mehyar-web. Modeled on
// fulfillDesignful.js.
//
// Contract: fulfillCreditfixkit({ db, env, waitUntil, sendEmail }, payment)
//   db        — D1 binding (shared mehyar_leads_prod; has creditfixkit_orders)
//   env       — worker env (CREDITFIXKIT_BASE_URL optional override)
//   waitUntil — Pages Functions waitUntil (optional; falls back to await)
//   sendEmail — injected mailer: sendEmail(env, {from, fromName, to, replyTo,
//               subject, text, html}) -> {ok, ...}. NEVER sends in local dev.
//   payment   — billing_payments row {id, product_id, email, metadata_json}
//               metadata_json = FLAT checkout params {name, situation, state,
//               goal, accounts} (accepts a wrapped {inputs:{...}} shape too).
//
// Behavior:
//   1. Idempotent: exactly one creditfixkit_orders row per payment.id
//      (UNIQUE index idx_creditfixkit_orders_payment). Replays return early.
//   2. Single SKU (creditfix-kit): create order, unify the access token onto
//      billing_payments, then background:
//      POST {base}/api/creditfix/generate {order_token, inputs}; on success
//      mark ready + email the token-gated deliverable link; on failure mark
//      failed (buyer retries from success.html, which re-POSTs generate).

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const DISCLAIMER =
  "General information only \u2014 not legal or financial advice. " +
  "Consider consulting a licensed attorney or certified financial professional.";

function randomToken(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function baseUrl(env) {
  return String(env.CREDITFIXKIT_BASE_URL || "https://creditfixkit.mehyar.us").replace(/\/+$/, "");
}

function fromAddress() {
  // Until the creditfixkit subdomain is onboarded on both ESPs (standing rule),
  // send from the proven mehyar.us identity.
  return { from: "team@mehyar.us", fromName: "CreditFix Kit" };
}

export async function fulfillCreditfixkit({ db, env, waitUntil, sendEmail }, payment) {
  if (!db || !payment || !payment.id) throw new Error("fulfillCreditfixkit: bad args");

  const productId = payment.product_id;

  let meta = {};
  try {
    meta = JSON.parse(payment.metadata_json || "{}");
  } catch {}
  // The centralized /api/pay/checkout stores body.params FLAT as metadata_json.
  // Accept both the flat shape and a wrapped {inputs:{...}} shape.
  const intakeInputs = (meta && typeof meta === "object" && meta.inputs) || meta || {};

  // ── idempotent order create (one row per payment) ──
  const existing = await db
    .prepare("SELECT id, access_token, status FROM creditfixkit_orders WHERE payment_id = ?")
    .bind(payment.id)
    .first();
  if (existing) {
    return { ok: true, replay: true, order_id: existing.id, status: existing.status };
  }

  // The order reuses the payment's checkout-time token (the one baked into the
  // Stripe success_url). Minting a fresh token here would orphan the buyer's
  // success URL — the deliverable endpoint gates on the order token, so one
  // token must work from checkout through delivery.
  const accessToken = payment.access_token || randomToken(32);
  const inputsJson = JSON.stringify({ inputs: intakeInputs });
  const ins = await db
    .prepare(
      "INSERT INTO creditfixkit_orders (payment_id, product_id, email, inputs_json, status, access_token) " +
        "VALUES (?, ?, ?, ?, 'paid', ?)"
    )
    .bind(payment.id, productId, payment.email, inputsJson, accessToken)
    .run();
  const orderId = ins.meta.last_row_id;

  // Token unification (safety net): if a fallback token was minted above,
  // point the payment row at it so billing_payments.access_token always
  // matches the order token. Normally a no-op since the token is reused.
  await db
    .prepare("UPDATE billing_payments SET access_token = ? WHERE id = ?")
    .bind(accessToken, payment.id)
    .run();

  const { from, fromName } = fromAddress();

  // ── background generation, then email ──
  const run = async () => {
    try {
      const genResp = await fetch(`${baseUrl(env)}/api/creditfix/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_token: accessToken, inputs: intakeInputs }),
      });
      const genData = await genResp.json().catch(() => ({}));
      if (!genResp.ok || !genData.ok) {
        throw new Error("generate:" + String((genData && genData.error) || genResp.status));
      }
      await db
        .prepare(`UPDATE creditfixkit_orders SET status='ready', output_json=?, ready_at=${nowSql} WHERE id=? AND status!='ready'`)
        .bind(JSON.stringify(genData.manifest || {}), orderId)
        .run();

      const deliverUrl = `${baseUrl(env)}/deliverable.html?token=${accessToken}`;
      const buyerName = String(intakeInputs.name || "").trim();
      const subject = "Your CreditFix Kit is ready";
      const text =
        `Thanks for your purchase${buyerName ? ", " + buyerName : ""}!\n\n` +
        `Your CreditFix Kit is ready:\n${deliverUrl}\n\n` +
        `Inside: your personalized dispute letters, your 12-month rebuild plan, and the score-factor explainer — as a PDF you can download and print.\n\n` +
        `This link is personal to you \u2014 keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.\n\n` +
        `${DISCLAIMER}\n\n-- ${fromName}`;
      const html =
        `<p>Thanks for your purchase${buyerName ? ", " + buyerName : ""}!</p>` +
        `<p>Your <strong>CreditFix Kit</strong> is ready:</p>` +
        `<p><a href="${deliverUrl}" style="display:inline-block;background:#1e3a5f;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Get your kit</a></p>` +
        `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${deliverUrl}">${deliverUrl}</a></p>` +
        `<p>Inside: your personalized dispute letters, your 12-month rebuild plan, and the score-factor explainer \u2014 as a PDF you can download and print.</p>` +
        `<p style="color:#6b7280;font-size:13px;">This link is personal to you \u2014 keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.</p>` +
        `<p style="color:#6b7280;font-size:12px;">${DISCLAIMER}</p>` +
        `<p>-- ${fromName}</p>`;
      const result = await sendEmail(env, { from, fromName, to: payment.email, replyTo: "info@mehyar.us", subject, text, html });
      if (!result.ok) console.error("fulfillCreditfixkit deliverable email failed", productId, result.error);
    } catch (e) {
      console.error("fulfillCreditfixkit background generate failed", productId, e && e.message);
      try {
        await db.prepare("UPDATE creditfixkit_orders SET status='failed' WHERE id=? AND status='paid'")
          .bind(orderId).run();
      } catch {}
      // No email on failure: the buyer lands on success.html?token= from
      // Stripe, which shows live status + a retry button that re-POSTs
      // /api/creditfix/generate with their token.
    }
  };

  if (typeof waitUntil === "function") waitUntil(run());
  else await run();

  return { ok: true, order_id: orderId };
}
