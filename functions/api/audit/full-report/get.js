// functions/api/audit/full-report/get.js
// GET /api/audit/full-report/get?token=<64-hex access token> — fetch a delivered report.
// The access token is a random secret issued at purchase; the numeric id alone
// is NOT sufficient. Reports are only reachable via the buyer's own email link.
//
// Stuck-report recovery: if a report has been 'generating' for more than
// 10 minutes (Worker evicted, subrequest timed out, LLM hung), this endpoint
// marks it 'failed' with a buyer-facing message, alerts the owner, and the
// admin retry endpoint (/api/audit/full-report/retry) can rebuild it.

import { sendCfEmail } from "../../_shared/cfEmail.js";

const OWNER_EMAIL = "mrswelim@gmail.com";
const STUCK_MS = 10 * 60 * 1000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

const BUYER_STUCK_MESSAGE =
  "Building your report hit a snag on our side — we're on it, and you'll be emailed the moment it's ready. Nothing was lost; your purchase is safe.";

export async function onRequestGet({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const u = new URL(request.url);
    const token = (u.searchParams.get("token") || "").trim();
    if (!/^[0-9a-f]{64}$/.test(token)) return json({ ok: false, error: "invalid_token" }, 400);
    const row = await env.LEADS_DB.prepare(
      "SELECT id, email, url, business, status, failure_reason, report_json, report_html, created_at, delivered_at, paid_at, status_changed_at FROM audit_full_reports WHERE access_token = ?"
    ).bind(token).first();
    if (!row) return json({ ok: false, error: "not_found" }, 404);

    let status = row.status;
    let buyerMessage = null;

    // Recovery: stuck 'generating' -> 'failed' + owner alert. The retry
    // endpoint can rebuild it; the buyer gets a clear message either way.
    if (status === "generating" && row.status_changed_at) {
      const age = Date.now() - Date.parse(row.status_changed_at);
      if (age > STUCK_MS) {
        await env.LEADS_DB.prepare(
          "UPDATE audit_full_reports SET status='failed', failure_reason='stuck_generation', status_changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?"
        ).bind(row.id).run();
        status = "failed";
        buyerMessage = BUYER_STUCK_MESSAGE;
        try {
          await sendCfEmail(env, {
            from: "MehyarSoft Audit <audit@mehyar.us>",
            to: OWNER_EMAIL,
            subject: "⚠️ Full report #" + row.id + " stuck in generating — marked failed",
            text: "A paid full report was stuck in 'generating' for over 10 minutes and was marked failed by the recovery path.\n\n" +
              "Report ID: " + row.id + "\nEmail: " + row.email + "\nURL: " + row.url + "\n" +
              "Stuck since: " + row.status_changed_at + "\n\n" +
              "Rebuild it with: POST /api/audit/full-report/retry { report_id: " + row.id + " } (Bearer AUDIT_CRON_SECRET).\n" +
              "The buyer will see a message saying they'll be emailed when it's ready.",
          });
        } catch (e) {
          console.error("stuck-report owner alert failed", e && e.message);
        }
      }
    }
    if (status === "failed" && !buyerMessage) buyerMessage = BUYER_STUCK_MESSAGE;

    let report = null;
    try { report = row.report_json ? JSON.parse(row.report_json) : null; } catch { report = null; }
    return json({
      ok: true,
      status,
      url: row.url,
      business: row.business,
      created_at: row.created_at,
      delivered_at: row.delivered_at,
      paid_at: row.paid_at,
      failure_reason: row.failure_reason,
      buyer_message: buyerMessage,
      report,
      report_html: row.report_html || null,
    });
  } catch (e) {
    console.error("full-report get error", e && e.message);
    return json({ ok: false, error: "failed" }, 500);
  }
}
