// functions/api/audit/full-report/get.js
// GET /api/audit/full-report/get?report_id=123 — fetch a delivered report.
// No auth beyond the unguessable numeric id + email match; reports are only
// reachable via the buyer's own email link.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const u = new URL(request.url);
    const reportId = Number(u.searchParams.get("report_id"));
    if (!reportId) return json({ ok: false, error: "invalid_report_id" }, 400);
    const row = await env.LEADS_DB.prepare(
      "SELECT id, email, url, business, status, report_json, created_at, delivered_at FROM audit_full_reports WHERE id = ?"
    ).bind(reportId).first();
    if (!row) return json({ ok: false, error: "not_found" }, 404);
    let report = null;
    try { report = row.report_json ? JSON.parse(row.report_json) : null; } catch { report = null; }
    return json({
      ok: true,
      report_id: row.id,
      status: row.status,
      url: row.url,
      business: row.business,
      created_at: row.created_at,
      delivered_at: row.delivered_at,
      report,
    });
  } catch (e) {
    console.error("full-report get error", e && e.message);
    return json({ ok: false, error: "failed" }, 500);
  }
}
