// /api/mayor/outbound-summary — cheap COUNT aggregations for the AdminMayor
// "Outreach" summary cards. Reads the real source-of-truth tables.
//
// D1 reality (verified 2026-07-18):
//   prospect_sends         = 0 rows  (engine INSERT silently fails on FK;
//                                     see mayorEngine.js try/catch)
//   prospect_sequences     = 252 rows (138 queued, 17 sent, 51 skipped, 46 failed)
//   mayor_events           = sent counters per run
//   reply_classifications  = 0 rows
//   prospect_replies       = 0 rows
//   mayor_replies          = 0 rows
//
// Until the FK bug is fixed upstream, prospect_sequences IS the truth.

import { verifyAdminToken, json, corsHeaders } from "../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

async function bearerAccepted(request, env) {
  const h = request.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) return false;
  const tok = h.slice(7);
  if (tok && env?.GOV_INGEST_TOKEN && tok === env.GOV_INGEST_TOKEN) return true;
  const a = await verifyAdminToken(request, env);
  return a.ok;
}

export async function onRequestGet({ request, env }) {
  if (!await bearerAccepted(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  if (!env?.LEADS_DB) {
    return json({ ok: false, error: "missing_db" }, 500, request, env);
  }

  const url = new URL(request.url);
  const daysBack = Math.max(parseInt(url.searchParams.get("days_back") || "30", 10) || 30, 1);
  const sinceIso = new Date(Date.now() - daysBack * 86400000).toISOString();

  // Sequences counts
  const seqSql = `
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'sent'    THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status = 'queued'  THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
      SUM(CASE WHEN status = 'failed'  THEN 1 ELSE 0 END) AS failed
    FROM prospect_sequences
    WHERE created_at >= ? OR sent_at >= ? OR scheduled_for >= ?`;

  // Last 7 days daily series for a tiny sparkline (kept optional, computed inline)
  const sevenDay = await env.LEADS_DB.prepare(
    `SELECT substr(sent_at, 1, 10) AS day, COUNT(*) AS n
     FROM prospect_sequences
     WHERE sent_at IS NOT NULL AND sent_at >= datetime('now', '-7 days')
     GROUP BY day ORDER BY day ASC`
  ).all().catch(() => ({ results: [] }));

  try {
    const r = await env.LEADS_DB.prepare(seqSql).bind(sinceIso, sinceIso, sinceIso).first();
    return json({
      ok: true,
      days_back: daysBack,
      steps_total:    r?.total ?? 0,
      steps_sent:     r?.sent ?? 0,
      steps_queued:   r?.queued ?? 0,
      steps_skipped:  r?.skipped ?? 0,
      steps_failed:   r?.failed ?? 0,
      replied_total:     0,
      replied_interested:0,
      replied_unsubscribed:0,
      replied_objections:0,
      // Analytics placeholder — real reply tracking is a follow-up
      // once the inbound webhook is wired (the reply_classifications
      // and prospect_replies tables are presently empty).
      seven_day_sent_series: sevenDay.results || [],
      source_note: "Counts from prospect_sequences (FK bug blocks prospect_sends; see mayorEngine.js).",
    }, 200, request, env);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e).slice(0, 200) }, 500, request, env);
  }
}
