// functions/api/audit/scan/status.js
// GET /api/audit/scan/status?scan_id=<32-hex> — poll a background free scan.
// Returns { ok, status: queued|working|ready|failed, progress?, report?,
// emailed?, error? }. The report is only included once status=ready.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const scanId = new URL(request.url).searchParams.get("scan_id") || "";
    if (!/^[0-9a-f]{32}$/.test(scanId)) return json({ ok: false, error: "invalid_scan_id" }, 400);
    const row = await env.LEADS_DB.prepare(
      `SELECT status, progress, report_json, emailed, error FROM audit_scans WHERE scan_id = ?`
    ).bind(scanId).first();
    if (!row) return json({ ok: false, error: "not_found" }, 404);
    const out = { ok: true, status: row.status, progress: row.progress || null };
    if (row.status === "ready") {
      try { out.report = JSON.parse(row.report_json || "{}"); }
      catch { out.report = {}; }
      out.emailed = !!row.emailed;
    }
    if (row.status === "failed") {
      out.error = row.error || "The scan hit a snag — please try again in a minute.";
    }
    return json(out);
  } catch (e) {
    console.error("audit scan status error", e?.message);
    return json({ ok: false, error: "status_failed" }, 500);
  }
}
