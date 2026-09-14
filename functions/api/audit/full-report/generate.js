// functions/api/audit/full-report/generate.js
// POST /api/audit/full-report/generate — build the $5 full evaluation.
// Auth: Bearer AUDIT_CRON_SECRET (called by the Stripe webhook or manually).
// Body: { report_id }
// The actual build lives in ../../_shared/fullReportBuild.js so the retry
// endpoint reuses identical logic. Idempotent: re-fires never rebuild a ready
// report (buildFullReport claims the row with a status lease).

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

    const res = await buildFullReport(env, reportId);
    if (res.ok) return json({ ok: true, report_id: reportId, status: "ready", pages_crawled: res.pages_crawled, emailed: res.emailed });
    const code = res.error === "not_found" ? 404 : res.error === "already_running" ? 409 : res.error === "invalid_url" ? 400 : 500;
    return json({ ok: false, error: res.error || "generation_failed" }, code);
  } catch (e) {
    console.error("full-report generate error", e && e.message);
    return json({ ok: false, error: "generation_failed" }, 500);
  }
}
