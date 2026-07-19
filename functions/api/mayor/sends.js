// /api/mayor/sends — paginated outbound send history for the AdminMayor
// "Outreach" tab. Reads from the real source of truth that the Mayor engine
// actually writes to:
//
//   prospect_sequences — every step the engine queued/sent/skipped/failed
//                        (138 queued, 17 sent, 46 failed, 51 skipped as of
//                        2026-07-18 — verified via D1 PRAGMA)
//   prospects          — business name + email
//   mayor_events       — every "Sent → someone@x" log row
//
// prospect_sends exists in schema but is currently broken (FK constraint
// failure on draft_id — see tickets). We DO NOT read from it. Once the
// engine INSERT is fixed to insert a placeholder draft when needed, this
// endpoint can switch to prospect_sends for per-provider-id tracking.
//
// Query params:
//   limit         (default 50, max 200)
//   offset        (default 0)
//   status        filter by prospect_sequences.status (sent|queued|skipped|failed)
//   days_back     (default 30)
//
// Response: { ok, count, total, items: [...] }

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
  const limit  = Math.min(Math.max(parseInt(url.searchParams.get("limit")  || "50", 10) || 50, 1), 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);
  const statusFilter  = (url.searchParams.get("status") || "").trim();
  const daysBack = Math.max(parseInt(url.searchParams.get("days_back") || "30", 10) || 30, 1);
  const sinceIso = new Date(Date.now() - daysBack * 86400000).toISOString();

  const conds = [
    "(ps.created_at >= ? OR ps.sent_at >= ? OR ps.scheduled_for >= ?)",
  ];
  const binds = [sinceIso, sinceIso, sinceIso];
  if (statusFilter) { conds.push("ps.status = ?"); binds.push(statusFilter); }
  const where = conds.join(" AND ");

  const listSql = `
    SELECT
      ps.id                AS step_id,
      ps.prospect_id,
      ps.step_no,
      ps.subject,
      ps.body_text         AS body_text,
      ps.status            AS step_status,
      ps.scheduled_for,
      ps.sent_at,
      ps.created_at,
      ps.send_id,
      p.business_name,
      p.email              AS to_email,
      p.website            AS from_website,
      m.summary            AS event_summary,
      m.created_at         AS event_at,
      pd.subject           AS draft_subject,
      pd.body_text         AS draft_body_text,
      pd.cited_signals_json AS draft_cited_signals
    FROM prospect_sequences ps
    LEFT JOIN prospects p ON p.id = ps.prospect_id
    LEFT JOIN mayor_events m
      ON m.kind IN ('outreach','followup')
     AND m.details_json LIKE '%"' || ps.id || '"%'
    LEFT JOIN prospect_drafts pd
      ON pd.id = ps.send_id
    WHERE ${where}
    ORDER BY (ps.sent_at IS NULL), ps.sent_at DESC, ps.created_at DESC
    LIMIT ? OFFSET ?`;
  const listBinds = [...binds, limit, offset];

  const countSql = `SELECT COUNT(*) AS total FROM prospect_sequences ps WHERE ${where}`;

  try {
    const listRes = await env.LEADS_DB.prepare(listSql).bind(...listBinds).all();
    const items = listRes.results || [];
    const cRes = await env.LEADS_DB.prepare(countSql).bind(...binds).first();
    const total = cRes?.total ?? 0;
    return json({ ok: true, count: items.length, total, items }, 200, request, env);
  } catch (e) {
    return json({ ok: false, error: `query_failed: ${String(e?.message || e).slice(0, 200)}` }, 500, request, env);
  }
}
