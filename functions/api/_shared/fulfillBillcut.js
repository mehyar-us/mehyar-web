// functions/api/_shared/fulfillBillcut.js
// Fulfillment for Billcut (billcut.mehyar.us): statement audits.
//   billcut-audit      $9 one-time  — unlocks the full audit report.
//   billcut-monitoring $7/mo        — unlocks + monitoring (monthly re-upload diffs).
//
// Contract: fulfillBillcut({ db, env, waitUntil, sendEmail }, payment)
//   payment.metadata_json is FLAT body.params from the centralized
//   checkout: { audit_token } — the teaser audit created at upload.
//
// Behavior:
//   1. Idempotent on payment.id: billcut_audits.payment_id /
//      monitor_payment_id records the fulfilling payment; a replay with
//      the same payment already recorded returns {replay:true}.
//   2. Token unification: billing_payments.access_token := the audit
//      token, so the {access_token} in success_url_template opens the
//      buyer's report directly.
//   3. Emails the buyer their report link (transactional; sender is the
//      proven team@mehyar.us identity until billcut.mehyar.us is
//      ESP-onboarded). Never throws out of the hook.

const PRODUCT_NAMES = {
  "billcut-audit": "Billcut Full Audit",
  "billcut-monitoring": "Billcut Monitoring",
};

function baseUrl(env) {
  return String(env.BILLCUT_BASE_URL || "https://billcut.mehyar.us").replace(/\/+$/, "");
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>\"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;", "'": "&#39;",
  }[m]));
}

export async function fulfillBillcut({ db, env, waitUntil, sendEmail }, payment) {
  if (!db || !payment || !payment.id) throw new Error("fulfillBillcut: bad args");
  const productId = payment.product_id;
  if (!PRODUCT_NAMES[productId]) throw new Error("fulfillBillcut: wrong product " + productId);
  const isMonitor = productId === "billcut-monitoring";

  let meta = {};
  try { meta = JSON.parse(payment.metadata_json || "{}"); } catch {}
  const flat = (meta && typeof meta === "object" && meta.inputs) || meta || {};
  const auditToken = String(flat.audit_token || flat.auditToken || "").slice(0, 64);
  const buyerEmail = String(payment.email || "").trim().toLowerCase();
  if (!auditToken) {
    console.error("fulfillBillcut: no audit_token in metadata for payment", payment.id);
    return { ok: false, error: "missing_audit_token" };
  }

  const audit = await db
    .prepare("SELECT token, status, payment_id, monitor_payment_id FROM billcut_audits WHERE token = ?")
    .bind(auditToken)
    .first();
  if (!audit) {
    console.error("fulfillBillcut: unknown audit token for payment", payment.id);
    return { ok: false, error: "unknown_audit" };
  }

  // Idempotency: this exact payment already fulfilled.
  if (audit.payment_id === payment.id || audit.monitor_payment_id === payment.id) {
    return { ok: true, replay: true, token: auditToken };
  }

  const newStatus = isMonitor ? "monitor" : audit.status === "monitor" ? "monitor" : "paid";
  await db
    .prepare(
      "UPDATE billcut_audits SET status = ?, email = COALESCE(email, ?), " +
      "payment_id = CASE WHEN ? = 0 THEN COALESCE(payment_id, ?) ELSE payment_id END, " +
      "monitor_payment_id = CASE WHEN ? = 1 THEN ? ELSE monitor_payment_id END, " +
      "paid_at = COALESCE(paid_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE token = ?"
    )
    .bind(newStatus, buyerEmail || null, isMonitor ? 0 : 1, payment.id, isMonitor ? 1 : 0, payment.id, auditToken)
    .run();

  // Token unification — one token gates every Billcut buyer surface.
  await db
    .prepare("UPDATE billing_payments SET access_token = ? WHERE id = ?")
    .bind(auditToken, payment.id)
    .run();

  if (buyerEmail && typeof sendEmail === "function") {
    const reportUrl = `${baseUrl(env)}/?token=${auditToken}`;
    const subject = isMonitor
      ? "Your Billcut audit is unlocked — monitoring is on"
      : "Your Billcut audit is ready";
    const text =
      `Thanks — your ${PRODUCT_NAMES[productId]} is unlocked.\n\n` +
      `Open your full report here: ${reportUrl}\n\n` +
      `Inside: every recurring charge from your statement, ranked by yearly cost, ` +
      `with the flags we found and a cancel or negotiation script for each charge.\n` +
      (isMonitor
        ? `\nMonitoring: re-upload a fresh statement next month from the Billcut homepage ` +
          `(use the "Monitoring member re-uploading?" box with your report token) and we'll ` +
          `show you what changed.\n`
        : ``) +
      `\nYour uploaded file was deleted right after it was read — we keep only the audit ` +
      `summary behind this private link. You can delete it anytime from the report page.\n\n` +
      `Billcut is an information tool, not financial advice. It never contacts merchants — the scripts are yours to use.\n` +
      `Mehyar Soft LLC · info@mehyar.us`;
    const html =
      `<p>Thanks — your <strong>${esc(PRODUCT_NAMES[productId])}</strong> is unlocked.</p>` +
      `<p><a href="${esc(reportUrl)}" style="display:inline-block;background:#0b3d2e;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Open your full report</a></p>` +
      `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${esc(reportUrl)}">${esc(reportUrl)}</a></p>` +
      `<p style="color:#6b7280;font-size:13px;">Inside: every recurring charge from your statement, ranked by yearly cost, with flags and a cancel or negotiation script for each charge.` +
      (isMonitor ? ` Re-upload a fresh statement next month and we'll show you what changed.` : ``) +
      ` Your uploaded file was deleted right after it was read; only the audit summary is kept, behind this private link, and you can delete it anytime from the report page.</p>` +
      `<p style="color:#6b7280;font-size:13px;">Billcut is an information tool, not financial advice. It never contacts merchants — the scripts are yours to use.<br>Mehyar Soft LLC · info@mehyar.us</p>`;
    try {
      const result = await sendEmail(env, {
        from: "team@mehyar.us", fromName: "Billcut",
        to: buyerEmail, replyTo: "info@mehyar.us",
        subject, text, html,
      });
      if (!result || !result.ok) console.error("fulfillBillcut email failed", result && result.error);
    } catch (e) {
      console.error("fulfillBillcut email error", e && e.message);
    }
  }
  return { ok: true, token: auditToken, status: newStatus };
}
