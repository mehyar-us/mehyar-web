// functions/api/_shared/payFulfillment.js
// Shared centralized-ledger helpers, used by BOTH:
//  - functions/api/pay/webhook.js (the dedicated centralized webhook), and
//  - functions/api/audit/full-report/webhook.js (legacy webhook mirrors the
//    ledger here because its Stripe endpoint has the proven delivery channel).
//
// All operations are idempotent: re-running for the same session is safe.

import { sendCloudflareEmail } from "./cloudflareEmail.js";

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/** Mark a billing_payments row paid from a Stripe session. Returns the payment row or null. */
export async function markBillingPaid(db, sess, paymentId) {
  const payment = await db
    .prepare("SELECT * FROM billing_payments WHERE id = ?")
    .bind(paymentId)
    .first();
  if (!payment) return null;
  const duplicate =
    payment.stripe_session_id &&
    payment.stripe_session_id === sess.id &&
    payment.status !== "pending";
  if (!duplicate) {
    await db
      .prepare(
        `UPDATE billing_payments SET stripe_payment_intent=?, stripe_session_id=?, status='paid', paid_at=${nowSql} ` +
          "WHERE id=? AND status != 'paid'"
      )
      .bind(sess.payment_intent || null, sess.id || null, paymentId)
      .run();
  }
  return payment;
}

/** Email the buyer their token-gated download link (digital products). */
export async function sendDigitalDownloadEmail(env, payment) {
  const downloadUrl = "https://mehyar.us/api/pay/download?token=" + payment.access_token;
  // Brand comes from the product row when available; fall back to MehyarSoft.
  let brandName = "MehyarSoft";
  let fromEmail = "team@mehyar.us";
  let productName = payment.product_id;
  try {
    const product = await env.LEADS_DB.prepare(
      "SELECT name, brand FROM billing_products WHERE id = ?"
    )
      .bind(payment.product_id)
      .first();
    if (product) {
      productName = product.name || productName;
      if (product.brand === "stuffprettygood") {
        brandName = "Stuff Pretty Good";
        fromEmail = "hello@stuffprettygood.com";
      }
    }
  } catch { /* branding fallback */ }
  const subject = `Your ${productName} is ready`;
  const text =
    `Thanks for your purchase!\n\n` +
    `Your download for "${productName}" is ready:\n${downloadUrl}\n\n` +
    `This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.\n\n` +
    `-- ${brandName}`;
  const html =
    `<p>Thanks for your purchase!</p>` +
    `<p>Your download for <strong>${productName}</strong> is ready:</p>` +
    `<p><a href="${downloadUrl}" style="display:inline-block;background:#111827;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Download your guide</a></p>` +
    `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${downloadUrl}">${downloadUrl}</a></p>` +
    `<p style="color:#6b7280;font-size:13px;">This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.</p>` +
    `<p>-- ${brandName}</p>`;
  const result = await sendCloudflareEmail(env, {
    from: fromEmail,
    fromName: brandName,
    to: payment.email,
    replyTo: "info@mehyar.us",
    subject,
    text,
    html,
  });
  if (!result.ok) {
    console.error("digital download email failed", payment.product_id, result.error);
  }
  return result;
}

/**
 * Mirror a Stripe session into the centralized ledger. Called by the legacy
 * audit webhook (whose Stripe endpoint demonstrably receives deliveries) so
 * the billing_payments ledger stays correct even when the dedicated
 * /api/pay/webhook destination is not receiving events.
 *
 * - Marks billing_payments paid when sess.metadata.payment_id is present.
 * - Sends the digital download email for fulfillment='digital' products.
 * - Skips audit_report fulfillment: the legacy webhook already handles the
 *   audit paid-marking + generation trigger itself.
 * Never throws: failures are logged and swallowed so the caller's own
 * webhook logic is never broken by the mirror.
 */
export async function mirrorPaymentToLedger({ db, env }, sess) {
  try {
    const paymentId = Number(sess.metadata && sess.metadata.payment_id);
    if (!paymentId) return { mirrored: false };
    const payment = await markBillingPaid(db, sess, paymentId);
    if (!payment) return { mirrored: false };
    let fulfillment = "none";
    try {
      const product = await db
        .prepare("SELECT fulfillment FROM billing_products WHERE id = ?")
        .bind(payment.product_id)
        .first();
      fulfillment = (product && product.fulfillment) || "none";
    } catch { /* default none */ }
    if (fulfillment === "digital") {
      await sendDigitalDownloadEmail(env, payment);
    }
    return { mirrored: true, fulfillment };
  } catch (e) {
    console.error("ledger mirror failed", e && e.message);
    return { mirrored: false, error: String((e && e.message) || e).slice(0, 120) };
  }
}
