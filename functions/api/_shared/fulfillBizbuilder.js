// functions/api/_shared/fulfillBizbuilder.js
// Standalone ES module: Stripe fulfillment for fulfillment='bizbuilder' products.
// Called from the shared /api/pay/webhook in mehyar-web. Modeled on
// fulfill-designful.js (same contract, single SKU, no bundles).
//
// Contract: fulfillBizbuilder({ db, env, waitUntil, sendEmail }, payment)
//   db        — D1 binding (mehyar_leads_prod; has bizbuilder_orders)
//   env       — worker env (BIZBUILDER_BASE_URL optional; defaults to
//               https://bizbuilder.mehyar.us so no dashboard env change needed)
//   waitUntil — Pages Functions waitUntil (optional; falls back to await)
//   sendEmail — injected mailer: sendEmail(env, {from, fromName, to, replyTo,
//               subject, text, html}) -> {ok, ...}. NEVER sends in local dev:
//               the caller injects a stub. In prod, mehyar-web injects a
//               wrapper around sendCloudflareEmail.
//   payment   — billing_payments row {id, product_id, email, metadata_json}
//               metadata_json = intake params captured at checkout
//               ({idea, audience, price_point}, flat).
//
// Behavior:
//   1. Idempotent: exactly one bizbuilder_orders row per payment.id
//      (UNIQUE index idx_bizbuilder_orders_payment). Replays return early.
//   2. Create order, then background: POST BIZBUILDER_BASE_URL/api/bizbuilder/generate
//      {order_token, inputs}; on success mark ready + email the token-gated
//      deliverable link (+ PDF); on failure mark failed (buyer retries from
//      the deliverable page).

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function randomToken(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function baseUrl(env) {
  return String(env.BIZBUILDER_BASE_URL || "https://bizbuilder.mehyar.us").replace(/\/+$/, "");
}

function fromAddress(env) {
  // Until the bizbuilder subdomain is onboarded on both ESPs (standing rule),
  // send from the proven mehyar.us identity.
  return {
    from: env.BIZBUILDER_FROM_EMAIL || "team@mehyar.us",
    fromName: "BizBuilder",
  };
}

export async function fulfillBizbuilder({ db, env, waitUntil, sendEmail }, payment) {
  if (!db || !payment || !payment.id) throw new Error("fulfillBizbuilder: bad args");

  const productId = payment.product_id;

  let meta = {};
  try {
    meta = JSON.parse(payment.metadata_json || "{}");
  } catch {}
  // NOTE: the centralized /api/pay/checkout stores body.params FLAT as
  // metadata_json (see checkout.js: metadata_json = JSON.stringify(params)).
  // Accept both the flat shape and a wrapped {inputs:{...}} shape.
  const intakeInputs = (meta && typeof meta === "object" && meta.inputs) || meta || {};

  // ── idempotent order create (one row per payment) ──
  const existing = await db
    .prepare("SELECT id, access_token, status, product_id FROM bizbuilder_orders WHERE payment_id = ?")
    .bind(payment.id)
    .first();
  if (existing) {
    return { ok: true, replay: true, order_id: existing.id, status: existing.status };
  }

  const accessToken = randomToken(32);
  const inputsJson = JSON.stringify({ inputs: intakeInputs });
  const ins = await db
    .prepare(
      "INSERT INTO bizbuilder_orders (payment_id, product_id, email, inputs_json, status, access_token) " +
        "VALUES (?, ?, ?, ?, 'paid', ?)"
    )
    .bind(payment.id, productId, payment.email, inputsJson, accessToken)
    .run();
  const orderId = ins.meta.last_row_id;

  // Token unification: the Stripe success_url_template receives
  // billing_payments.access_token, but every BizBuilder surface gates on
  // bizbuilder_orders tokens. Point the payment row at the BizBuilder token
  // so ONE token works everywhere.
  await db
    .prepare("UPDATE billing_payments SET access_token = ? WHERE id = ?")
    .bind(accessToken, payment.id)
    .run();

  const { from, fromName } = fromAddress(env);

  // ── background generation, then email ──
  const run = async () => {
    try {
      const genResp = await fetch(`${baseUrl(env)}/api/bizbuilder/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_token: accessToken, inputs: intakeInputs }),
      });
      const genData = await genResp.json().catch(() => ({}));
      if (!genResp.ok || !genData.ok) {
        throw new Error("generate:" + String((genData && genData.error) || genResp.status));
      }
      await db
        .prepare(`UPDATE bizbuilder_orders SET status='ready', output_json=?, ready_at=${nowSql} WHERE id=? AND status!='ready'`)
        .bind(JSON.stringify(genData.manifest || {}), orderId)
        .run();

      const deliverUrl = `${baseUrl(env)}/deliverable.html?token=${accessToken}`;
      const pdfUrl = `${baseUrl(env)}/api/bizbuilder/pdf?token=${accessToken}`;
      const subject = "Your BizBuilder business plan is ready";
      const text =
        `Thanks for your purchase!\n\n` +
        `Your business plan is built: the one-page plan, landing-page copy, and 5-email welcome sequence are ready here:\n${deliverUrl}\n\n` +
        `Direct PDF download: ${pdfUrl}\n\n` +
        `These links are personal to you — keep them somewhere safe. If they ever stop working, just reply to this email and we'll sort it out.\n\n-- ${fromName}`;
      const html =
        `<p>Thanks for your purchase!</p>` +
        `<p>Your business plan is built — one-page plan, landing-page copy, and 5-email welcome sequence:</p>` +
        `<p><a href="${deliverUrl}" style="display:inline-block;background:#10b981;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">View your business plan</a></p>` +
        `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${deliverUrl}">${deliverUrl}</a></p>` +
        `<p><a href="${pdfUrl}">Download the plan as PDF</a></p>` +
        `<p style="color:#6b7280;font-size:13px;">These links are personal to you — keep them somewhere safe. If they ever stop working, just reply to this email and we'll sort it out.</p>` +
        `<p>-- ${fromName}</p>`;
      const result = await sendEmail(env, { from, fromName, to: payment.email, replyTo: "info@mehyar.us", subject, text, html });
      if (!result.ok) console.error("fulfillBizbuilder deliverable email failed", productId, result.error);
    } catch (e) {
      console.error("fulfillBizbuilder background generate failed", productId, e && e.message);
      try {
        await db.prepare("UPDATE bizbuilder_orders SET status='failed' WHERE id=? AND status='paid'")
          .bind(orderId).run();
      } catch {}
      // No email on failure: the buyer lands on success.html?token= from
      // Stripe, which shows live status + a retry button that re-POSTs
      // /api/bizbuilder/generate with their token.
    }
  };

  if (typeof waitUntil === "function") waitUntil(run());
  else await run();

  return { ok: true, order_id: orderId, mode: "single" };
}
