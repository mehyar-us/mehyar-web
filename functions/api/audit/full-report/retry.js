// functions/api/audit/full-report/retry.js
// POST /api/audit/full-report/retry — re-run generation for a stuck/failed report.
// Auth: Bearer AUDIT_CRON_SECRET (admin / cron use only — never called by buyers).
// Body: { report_id }
//
// Safety rules:
// - NEVER touches Stripe: no charge can happen here. If the row was never paid
//   (paid_at IS NULL), it refuses with 409 not_paid.
// - NEVER duplicates a ready report: returns already_ready without rebuilding.
// - Stuck 'generating' rows (>10 min) are claimable; actively-building rows
//   return 409 already_running.

import { buildFullReport } from "../../_shared/fullReportBuild.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const authz = request.headers.get("authorization") || "";
    if (!env.AUDIT_CRON_SECRET || authz !== "Bearer " + env.AUDIT_CRON_SECRET) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    const body = await request.json().catch(() => ({}));
    const reportId = Number(body.report_id);
    if (!reportId) return json({ ok: false, error: "invalid_report_id" }, 400);

    const row = await env.LEADS_DB.prepare(
      "SELECT id, status, paid_at FROM audit_full_reports WHERE id = ?"
    ).bind(reportId).first();
    if (!row) return json({ ok: false, error: "not_found" }, 404);
    if (row.status === "ready") return json({ ok: true, already_ready: true, report_id: reportId });
    if (!row.paid_at) {
      return json({ ok: false, error: "not_paid", message: "Report was never paid — retry refused." }, 409);
    }

    const res = await buildFullReport(env, reportId);
    if (res.ok) return json({ ok: true, report_id: reportId, status: "ready", pages_crawled: res.pages_crawled, emailed: res.emailed });
    const code = res.error === "already_running" ? 409 : 500;
    return json({ ok: false, error: res.error || "generation_failed" }, code);
  } catch (e) {
    console.error("full-report retry error", e && e.message);
    return json({ ok: false, error: "retry_failed" }, 500);
  }
}
