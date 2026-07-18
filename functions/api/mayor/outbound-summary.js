// /api/mayor/outbound-summary — quick aggregate counters for the AdminMayor
// "Outreach" tab. Cheap query: 4 COUNT aggregations + an UPPER-bound reply count.
// Renders: total sent, delivered, bounced, replied (in last N days).
//
// Auth: same bearer / GOV_INGEST_TOKEN path.

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

  const sendCountsSql = `
    SELECT status, COUNT(*) AS n
    FROM prospect_sends
    WHERE attempted_at >= ? OR (attempted_at IS NULL AND created_at >= ?)
    GROUP BY status`;

  const replyCountsSql = `
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN classification = 'interested' THEN 1 ELSE 0 END) AS interested,
      SUM(CASE WHEN classification = 'unsubscribe' OR recommended_action = 'unsubscribe' THEN 1 ELSE 0 END) AS unsubscribed,
      SUM(CASE WHEN classification = 'objection' THEN 1 ELSE 0 END) AS objections
    FROM prospect_replies WHERE received_at >= ?`;

  try {
    const [sc, rc] = await Promise.all([
      env.LEADS_DB.prepare(sendCountsSql).bind(sinceIso, sinceIso).all(),
      env.LEADS_DB.prepare(replyCountsSql).bind(sinceIso).first(),
    ]);
    const counts = { queued_for_review: 0, sent: 0, delivered: 0, bounced: 0, failed: 0 };
    for (const r of (sc?.results || [])) {
      counts[r.status] = r.n;
    }
    // "delivered" is computed as sent - bounced - failed when the column doesn't exist;
    // if delivered_at column exists the SQL above would split it instead. For now treat
    // 'sent' as delivered until the digest webhook surface gives us explicit events.
    return json({
      ok: true,
      days_back: daysBack,
      sends: counts,
      sent_total: counts.sent + counts.delivered,
      bounced: counts.bounced,
      replied_total: rc?.total || 0,
      replied_interested: rc?.interested || 0,
      replied_unsubscribed: rc?.unsubscribed || 0,
      replied_objections: rc?.objections || 0,
    }, 200, request, env);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e).slice(0, 200) }, 500, request, env);
  }
}
