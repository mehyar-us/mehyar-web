// functions/api/_shared/fulfillBillcutBiz.js
// Fulfillment for Billcut for Business (billcut.mehyar.us/business):
//   billcut-biz-report    $49 one-time — unlocks one contract-vs-invoice report.
//   billcut-biz-unlimited $79/mo       — unlimited checks while subscribed.
//
// Contract: fulfillBillcutBiz({ db, env, waitUntil, sendEmail }, payment)
//   payment.metadata_json is FLAT body.params from the centralized
//   checkout: { biz_token } — the teaser report created at upload.
//
// Behavior mirrors fulfillBillcut:
//   1. Idempotent on payment.id (payment_id / unlimited_payment_id).
//   2. Token unification: billing_payments.access_token := the biz token,
//      so the {access_token} in success_url_template opens the report.
//   3. Emails the buyer their report link (transactional). Never throws
//      out of the hook.

const PRODUCT_NAMES = {
  "billcut-biz-report": "Billcut for Business — Contract-vs-Invoice Report",
  "billcut-biz-unlimited": "Billcut for Business — Unlimited Checks",
};

function baseUrl(env) {
  return String(env.BILLCUT_BASE_URL || "https://billcut.mehyar.us").replace(/\/+$/, "");
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[m]));
}

export async function fulfillBillcutBiz({ db, env, waitUntil, sendEmail }, payment) {
  if (!db || !payment || !payment.id) throw new Error("fulfillBillcutBiz: bad args");
  const productId = payment.product_id;
  if (!PRODUCT_NAMES[productId]) throw new Error("fulfillBillcutBiz: wrong product " + productId);
  const isUnlimited = productId === "billcut-biz-unlimited";

  let meta = {};
  try { meta = JSON.parse(payment.metadata_json || "{}"); } catch {}
  const flat = (meta && typeof meta === "object" && meta.inputs) || meta || {};
  const bizToken = String(flat.biz_token || flat.bizToken || "").slice(0, 64);
  const buyerEmail = String(payment.email || "").trim().toLowerCase();
  if (!bizToken) {
    console.error("fulfillBillcutBiz: no biz_token in metadata for payment", payment.id);
    return { ok: false, error: "missing_biz_token" };
  }

  const report = await db
    .prepare("SELECT token, status, payment_id, unlimited_payment_id FROM billcut_biz_reports WHERE token = ?")
    .bind(bizToken)
    .first();
  if (!report) {
    console.error("fulfillBillcutBiz: unknown biz token for payment", payment.id);
    return { ok: false, error: "unknown_report" };
  }

  if (report.payment_id === payment.id || report.unlimited_payment_id === payment.id) {
    return { ok: true, replay: true, token: bizToken };
  }

  const newStatus = isUnlimited ? "unlimited" : report.status === "unlimited" ? "unlimited" : "paid";
  await db
    .prepare(
      "UPDATE billcut_biz_reports SET status = ?, email = COALESCE(email, ?), " +
      "payment_id = CASE WHEN ? = 1 THEN COALESCE(payment_id, ?) ELSE payment_id END, " +
      "unlimited_payment_id = CASE WHEN ? = 1 THEN ? ELSE unlimited_payment_id END, " +
      "paid_at = COALESCE(paid_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE token = ?"
    )
    .bind(newStatus, buyerEmail || null, isUnlimited ? 0 : 1, payment.id, isUnlimited ? 1 : 0, payment.id, bizToken)
    .run();

  // Token unification — one token gates the buyer's report.
  await db
    .prepare("UPDATE billing_payments SET access_token = ? WHERE id = ?")
    .bind(bizToken, payment.id)
    .run();

  if (buyerEmail && typeof sendEmail === "function") {
    const reportUrl = baseUrl(env) + "/business?token=" + encodeURIComponent(bizToken);
    const subject = isUnlimited
      ? "Your Billcut for Business report is unlocked — unlimited checks are on"
      : "Your Billcut for Business report is ready";
    const text =
      "Thanks — your " + PRODUCT_NAMES[productId] + " is unlocked.\n\n" +
      "Open your full report here: " + reportUrl + "\n\n" +
      "Inside: every invoice checked against your contract, with match / overcharge / " +
      "renewal flags — each one citing the contract clause it rests on, plus a dispute " +
      "script for every overcharge flag.\n" +
      (isUnlimited
        ? "\nUnlimited checks: while your subscription is active, new contract checks " +
          "under this email unlock automatically. Cancel anytime from your Stripe receipt.\n"
        : "") +
      "\nYour uploaded files were deleted right after they were read — we keep only the " +
      "report behind this private link, and you can delete it anytime from the report page.\n\n" +
      "Billcut is an information tool, not legal or financial advice. It never contacts " +
      "vendors — the scripts are yours to use.\n" +
      "Mehyar Soft LLC · info@mehyar.us";
    const html =
      "<p>Thanks — your <strong>" + esc(PRODUCT_NAMES[productId]) + "</strong> is unlocked.</p>" +
      "<p><a href=\"" + esc(reportUrl) + "\" style=\"display:inline-block;background:#0b3d2e;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;\">Open your full report</a></p>" +
      "<p style=\"color:#6b7280;font-size:13px;\">Or copy this link:<br><a href=\"" + esc(reportUrl) + "\">" + esc(reportUrl) + "</a></p>" +
      "<p style=\"color:#6b7280;font-size:13px;\">Inside: every invoice checked against your contract — match / overcharge / renewal flags, each citing the contract clause it rests on, plus a dispute script for every overcharge flag." +
      (isUnlimited ? " While your subscription is active, new contract checks under this email unlock automatically; cancel anytime from your Stripe receipt." : "") +
      " Your uploaded files were deleted right after they were read; only the report is kept, behind this private link, and you can delete it anytime from the report page.</p>" +
      "<p style=\"color:#6b7280;font-size:13px;\">Billcut is an information tool, not legal or financial advice. It never contacts vendors — the scripts are yours to use.<br>Mehyar Soft LLC · info@mehyar.us</p>";
    try {
      const result = await sendEmail(env, {
        from: "team@mehyar.us", fromName: "Billcut",
        to: buyerEmail, replyTo: "info@mehyar.us",
        subject, text, html,
      });
      if (!result || !result.ok) console.error("fulfillBillcutBiz email failed", result && result.error);
    } catch (e) {
      console.error("fulfillBillcutBiz email error", e && e.message);
    }
  }
  return { ok: true, token: bizToken, status: newStatus };
}
