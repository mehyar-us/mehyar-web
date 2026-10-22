// functions/api/audit/business/report.js
// GET /api/audit/business/report?token=<64-hex access token> — fetch a delivered
// "Audit My Business" report. Same access pattern as full-report/get.js:
// the token is a random secret minted at checkout; the audit id alone is NOT
// sufficient. Reports are only reachable via the buyer's own link.
//
// Stuck-report recovery: a report 'generating' for more than 15 minutes
// (worker evicted, LLM hung, Whisper stalled) is marked 'failed' with a
// buyer-safe message and the owner is alerted. The admin retry endpoint can
// rebuild it.

import { sendCfEmail } from "../../_shared/cfEmail.js";

const OWNER_EMAIL = "mrswelim@gmail.com";
const STUCK_MS = 15 * 60 * 1000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

const BUYER_STUCK_MESSAGE =
  "Building your audit hit a snag on our side — we're on it, and your report will be ready shortly. Nothing was lost; your purchase is safe.";

export async function onRequestGet({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const u = new URL(request.url);
    const token = (u.searchParams.get("token") || "").trim();
    if (!/^[0-9a-f]{64}$/.test(token)) return json({ ok: false, error: "invalid_token" }, 400);

    const row = await env.LEADS_DB.prepare(
      "SELECT id, url, business_name, status, failure_reason, report_json, created_at, paid_at, status_changed_at FROM audit_business_reports WHERE access_token = ?"
    ).bind(token).first();
    if (!row) return json({ ok: false, error: "not_found" }, 404);

    let status = row.status;
    let buyerMessage = null;

    if (status === "generating" && row.status_changed_at) {
      const age = Date.now() - Date.parse(row.status_changed_at);
      if (age > STUCK_MS) {
        await env.LEADS_DB.prepare(
          "UPDATE audit_business_reports SET status='failed', failure_reason='stuck_generation', status_changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?"
        ).bind(row.id).run();
        status = "failed";
        buyerMessage = BUYER_STUCK_MESSAGE;
        try {
          await sendCfEmail(env, {
            from: "MehyarSoft Audit <audit@mehyar.us>",
            to: OWNER_EMAIL,
            subject: "⚠️ Audit My Business " + row.id + " stuck in generating — marked failed",
            text: "A paid $330 audit was stuck in 'generating' for over 15 minutes and was marked failed by the recovery path.\n\n" +
              "Audit ID: " + row.id + "\nURL: " + row.url + "\n" +
              "Stuck since: " + row.status_changed_at + "\n\n" +
              "Rebuild it with: POST /api/audit/business/retry { audit_id: \"" + row.id + "\" } (Bearer AUDIT_CRON_SECRET).\n" +
              "The buyer will see a message saying the report will be ready shortly.",
          });
        } catch (e) {
          console.error("audit business stuck-report owner alert failed", e && e.message);
        }
      }
    }
    if (status === "failed" && !buyerMessage) buyerMessage = BUYER_STUCK_MESSAGE;

    let report = null;
    try { report = row.report_json ? JSON.parse(row.report_json) : null; } catch { report = null; }

    return json({
      ok: true,
      status,
      audit_id: row.id,
      url: row.url,
      business_name: row.business_name,
      created_at: row.created_at,
      paid_at: row.paid_at,
      failure_reason: row.failure_reason,
      buyer_message: buyerMessage,
      report,
    });
  } catch (e) {
    console.error("audit business get error", e && e.message);
    return json({ ok: false, error: "fetch_failed" }, 500);
  }
}
