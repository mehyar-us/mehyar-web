// functions/api/_shared/fulfillAuditBusiness.js
// Standalone ES module: Stripe fulfillment for fulfillment='audit_business'.
// Called from the shared /api/pay/webhook (dedicated webhook) and registered
// in payFulfillment.js ORDER_FULFILL so the legacy-webhook mirror path also
// fulfills (both converge on the idempotent generate endpoint).
//
// Contract: fulfillAuditBusiness({ db, env, waitUntil, sendEmail }, payment)
//   payment — billing_payments row {id, product_id, email, access_token,
//             metadata_json}. metadata_json carries { audit_id } (set by the
//             checkout order hook).
//
// Behavior:
//   1. Find the audit row: metadata.audit_id first; fallback = the buyer's
//      most recent intake (matched by email_hash — the row never holds the
//      raw email).
//   2. Idempotent paid-marking: never touches a ready/generating row;
//      duplicate webhook deliveries for the same session are ignored.
//   3. ONE token everywhere: the audit row reuses payment.access_token, so
//      the Stripe success_url (?token=), /api/pay/status, and
//      /api/audit/business/report?token= all gate on the same token.
//   4. Triggers generation: internal POST /api/audit/business/generate with
//      Bearer AUDIT_CRON_SECRET (the endpoint claims the row with a status
//      lease — double-fires are safe).
//   5. Emails the buyer (payment.email — never stored on the audit row):
//      payment received + personal report link.

import { sha256hex } from "./auditBusinessShared.js";

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const REPORT_URL = "https://mehyar.us/audit/report?token=";

function randomHex(bytes) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function fulfillAuditBusiness({ db, env, waitUntil, sendEmail }, payment) {
  if (!db || !payment || !payment.id) throw new Error("fulfillAuditBusiness: bad args");
  const token = payment.access_token;
  if (!token || token.length < 16) throw new Error("fulfillAuditBusiness: bad payment token");

  let meta = {};
  try { meta = JSON.parse(payment.metadata_json || "{}"); } catch {}
  const auditId = String(meta.audit_id || "").trim();

  // 1. Locate the audit row.
  let row = null;
  if (/^[0-9a-f-]{36}$/i.test(auditId)) {
    row = await db.prepare("SELECT * FROM audit_business_reports WHERE id = ?").bind(auditId).first();
  }
  if (!row && payment.email) {
    // Fallback: most recent intake for this buyer (hash-only match).
    const emailHash = await sha256hex("audit-business|" + String(payment.email).toLowerCase().trim());
    row = await db.prepare(
      "SELECT * FROM audit_business_reports WHERE email_hash = ? AND status IN ('intake','failed') ORDER BY created_at DESC LIMIT 1"
    ).bind(emailHash).first();
  }
  if (!row) throw new Error("fulfillAuditBusiness: no audit row for payment " + payment.id);
  const id = row.id;

  // 2. Idempotent paid-marking. Ready/generating rows are never touched;
  //    the same Stripe session delivered twice changes nothing.
  const sessId = payment.stripe_session_id || null;
  const duplicate = row.stripe_session_id && sessId && row.stripe_session_id === sessId && row.status !== "intake" && row.status !== "failed";
  if (!duplicate) {
    await db.prepare(
      `UPDATE audit_business_reports SET stripe_payment_intent=?, stripe_session_id=?, paid_at=${nowSql}, ` +
      `access_token=?, status='paid', failure_reason=NULL, status_changed_at=${nowSql} ` +
      `WHERE id=? AND status NOT IN ('ready','generating')`
    ).bind(payment.stripe_payment_intent || null, sessId, token, id).run();
  }

  const run = async () => {
    // 3. Trigger generation via the internal endpoint (Bearer AUDIT_CRON_SECRET).
    if (!env.AUDIT_CRON_SECRET) {
      console.error("fulfillAuditBusiness: missing AUDIT_CRON_SECRET");
      return { ok: false, error: "no_cron_secret" };
    }
    const base = String(env.PUBLIC_BASE_URL || "https://mehyar.us").replace(/\/+$/, "");
    try {
      const genResp = await fetch(base + "/api/audit/business/generate", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + env.AUDIT_CRON_SECRET },
        body: JSON.stringify({ audit_id: id }),
        signal: AbortSignal.timeout(10000),
      });
      const genData = await genResp.json().catch(() => ({}));
      if (!genResp.ok || !genData.ok) {
        console.error("fulfillAuditBusiness auto-generate failed", genData && genData.error);
        await db.prepare(
          "UPDATE audit_business_reports SET failure_reason=? WHERE id=? AND status='paid'"
        ).bind("generate_failed:" + String((genData && genData.error) || genResp.status).slice(0, 80), id).run();
        return { ok: false, error: genData.error || "generate_failed" };
      }
    } catch (e) {
      console.error("fulfillAuditBusiness auto-generate threw", e && e.message);
      try {
        await db.prepare(
          "UPDATE audit_business_reports SET failure_reason=? WHERE id=? AND status='paid'"
        ).bind("generate_threw:" + String(e && e.message).slice(0, 80), id).run();
      } catch { /* best effort */ }
      return { ok: false, error: "generate_threw" };
    }

    // 4. Buyer email: payment received + personal report link.
    if (payment.email && typeof sendEmail === "function") {
      try {
        await sendEmail(env, {
          from: "team@mehyar.us",
          fromName: "MehyarSoft",
          to: payment.email,
          replyTo: "info@mehyar.us",
          subject: "Your Audit My Business report is building 🔍",
          text:
            `Thanks for your purchase!\n\n` +
            `Your full AI business audit is building now — this usually takes a few minutes.\n\n` +
            `Your personal report link (keep it safe):\n${REPORT_URL}${token}\n\n` +
            `The page updates itself when your report is ready.\n\n-- MehyarSoft`,
          html:
            `<p>Thanks for your purchase!</p>` +
            `<p>Your full AI business audit is building now — this usually takes a few minutes.</p>` +
            `<p><a href="${REPORT_URL}${token}" style="display:inline-block;background:#111827;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">View your audit report</a></p>` +
            `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${REPORT_URL}${token}">${REPORT_URL}${token}</a></p>` +
            `<p style="color:#6b7280;font-size:13px;">The page updates itself when your report is ready. This link is personal to you.</p>` +
            `<p>-- MehyarSoft</p>`,
        });
      } catch (e) {
        console.error("fulfillAuditBusiness buyer email failed", e && e.message);
      }
    }
    return { ok: true, audit_id: id, duplicate: !!duplicate };
  };

  if (typeof waitUntil === "function") { waitUntil(run()); return { ok: true, audit_id: id, background: true }; }
  return run();
}

// Exported for unit tests.
export { randomHex };
