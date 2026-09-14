// functions/api/audit/full-report/get.js
// GET /api/audit/full-report/get?token=<64-hex access token> — fetch a delivered report.
// The access token is a random secret issued at purchase; the numeric id alone
// is NOT sufficient. Reports are only reachable via the buyer's own email link.

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
    const token = (u.searchParams.get("token") || "").trim();
    if (!/^[0-9a-f]{64}$/.test(token)) return json({ ok: false, error: "invalid_token" }, 400);
    const row = await env.LEADS_DB.prepare(
      "SELECT id, email, url, business, status, report_json, created_at, delivered_at FROM audit_full_reports WHERE access_token = ?"
    ).bind(token).first();
    if (!row) return json({ ok: false, error: "not_found" }, 404);
    let report = null;
    try { report = row.report_json ? JSON.parse(row.report_json) : null; } catch { report = null; }
    return json({
      ok: true,
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
