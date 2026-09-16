// functions/api/_shared/fulfillFreelanceros.js
// Standalone ES module: Stripe fulfillment for fulfillment='freelanceros' products.
// Called from the shared /api/pay/webhook in mehyar-web.
// Modeled on fulfillDesignful.js, minus AI generation: FreelancerOS is a
// token-gated dashboard PWA, so the deliverable is ready at purchase time.
//
// Contract: fulfillFreelanceros({ db, env, waitUntil, sendEmail }, payment)
//   db        — D1 binding (shared mehyar-jobs DB; has freelanceros_orders)
//   env       — worker env (FREELANCEROS_BASE_URL optional, defaults below)
//   waitUntil — unused (kept for contract symmetry)
//   sendEmail — injected mailer: sendEmail(env, {from, fromName, to, replyTo,
//               subject, text, html}) -> {ok, ...}. NEVER sends in local dev:
//               the caller injects a stub. In prod, mehyar-web injects a
//               wrapper around sendCloudflareEmail.
//   payment   — billing_payments row {id, product_id, email, metadata_json}
//
// Behavior:
//   1. Idempotent: exactly one freelanceros_orders row per payment.id
//      (UNIQUE index idx_freelanceros_orders_payment). Replays return early
//      with {replay:true} and send nothing.
//   2. Token unification: UPDATE billing_payments SET access_token=<order
//      token> so the Stripe success_url token gates the dashboard, the data
//      API, and /api/pay/status with ONE token.
//   3. Email the buyer their private dashboard link from team@mehyar.us
//      (freelanceros.mehyar.us is not onboarded on the ESPs yet — standing rule).
//   4. Never throws out of the hook: on email failure the order is still
//      'ready' and the buyer lands on success.html?token= from Stripe anyway.

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function randomToken(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function baseUrl(env) {
  return String(env.FREELANCEROS_BASE_URL || "https://freelanceros.mehyar.us").replace(/\/+$/, "");
}

function fromAddress(env) {
  // Until freelanceros.mehyar.us is onboarded on BOTH ESPs (standing rule),
  // send from the proven mehyar.us identity.
  return {
    from: env.FREELANCEROS_FROM_EMAIL || "team@mehyar.us",
    fromName: "FreelancerOS",
  };
}

export async function fulfillFreelanceros({ db, env, sendEmail }, payment) {
  if (!db || !payment || !payment.id) throw new Error("fulfillFreelanceros: bad args");

  const productId = payment.product_id || "freelanceros-os";

  // ── idempotent order create (one row per payment) ──
  const existing = await db
    .prepare("SELECT id, access_token, status FROM freelanceros_orders WHERE payment_id = ?")
    .bind(payment.id)
    .first();
  if (existing) {
    return { ok: true, replay: true, order_id: existing.id, status: existing.status };
  }

  // ── token unification ──
  // The checkout session's success_url_template already embedded
  // billing_payments.access_token at session creation. Reuse it so the
  // success page, dashboard, data API, and /api/pay/status all share ONE
  // token. Only generate (and backfill the payment row) when the payment
  // has none yet.
  const accessToken = payment.access_token || randomToken(32);
  if (!payment.access_token) {
    await db
      .prepare("UPDATE billing_payments SET access_token = ? WHERE id = ?")
      .bind(accessToken, payment.id)
      .run();
  }

  const ins = await db
    .prepare(
      "INSERT INTO freelanceros_orders (payment_id, product_id, email, data_json, status, access_token, ready_at) " +
        `VALUES (?, ?, ?, '{}', 'ready', ?, ${nowSql})`
    )
    .bind(payment.id, productId, payment.email, accessToken)
    .run();
  const orderId = ins.meta.last_row_id;

  const { from, fromName } = fromAddress(env);
  const appUrl = `${baseUrl(env)}/app.html?token=${accessToken}`;
  const subject = "Your FreelancerOS dashboard is ready";
  const text =
    `Thanks for your purchase!\n\n` +
    `Your FreelancerOS dashboard is live — client tracker, invoice generator,\n` +
    `content pipeline, and your template pack are all inside:\n${appUrl}\n\n` +
    `Bookmark this link — it's your private key to your dashboard. Your data\n` +
    `saves to the cloud automatically.\n\n` +
    `If the link ever stops working, just reply to this email and we'll sort it out.\n\n-- ${fromName}`;
  const html =
    `<p>Thanks for your purchase!</p>` +
    `<p>Your <strong>FreelancerOS</strong> dashboard is live — client tracker, invoice generator, content pipeline, and your template pack are all inside.</p>` +
    `<p><a href="${appUrl}" style="display:inline-block;background:#059669;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Open your dashboard</a></p>` +
    `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${appUrl}">${appUrl}</a></p>` +
    `<p style="color:#6b7280;font-size:13px;">Bookmark this link — it's your private key to your dashboard. Your data saves to the cloud automatically. If it ever stops working, just reply to this email and we'll sort it out.</p>` +
    `<p>-- ${fromName}</p>`;

  let emailOk = false;
  try {
    const result = await sendEmail(env, {
      from,
      fromName,
      to: payment.email,
      replyTo: "info@mehyar.us",
      subject,
      text,
      html,
    });
    emailOk = !!(result && result.ok);
    if (!emailOk) console.error("fulfillFreelanceros email failed", productId, result && result.error);
  } catch (e) {
    // Never throw out of the hook: the order is ready and the buyer lands on
    // success.html?token= from Stripe regardless of email delivery.
    console.error("fulfillFreelanceros email threw", productId, e && e.message);
  }

  return { ok: true, order_id: orderId, email_ok: emailOk };
}
