// /api/mayor/sends — paginated outbound send history + linked inbound replies.
// Designed for the AdminMayor "Outreach" tab. Returns each prospect_sends
// row joined with any mayor_replies that came back from that recipient.
//
// Query params:
//   limit         (default 50, max 200)
//   offset        (default 0)
//   status        filter by prospect_sends.status (sent, queued_for_review, bounced, etc)
//   days_back     (default 30) — only show sends within the last N days
//   to_email      partial LIKE filter, useful when searching one company
//
// Response: { ok, count, total, items: [{...send, reply: {...}|null}] }
//
// Auth: same bearer / GOV_INGEST_TOKEN as the rest of the mayor endpoints.

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
  const status  = (url.searchParams.get("status") || "").trim();
  const daysBack = Math.max(parseInt(url.searchParams.get("days_back") || "30", 10) || 30, 1);
  const toEmail  = (url.searchParams.get("to_email") || "").trim();

  const sinceIso = new Date(Date.now() - daysBack * 86400000).toISOString();

  // Pull sends + linked classification. Real D1 schema (verified 2026-07-18):
  //   prospect_sends(prospect_id, draft_id, provider, provider_id, to_email,
  //                   from_email, reply_to, subject, status, attempted_at,
  //                   finished_at, failure_reason, list_unsub_header, test_only)
  //   reply_classifications(reply_id → raw reply row, prospect_id, label, confidence,
  //                         action_taken, reviewed_at)
  // No delivered_at / bounced_at columns exist; status drives the rendering.
  const conds = [
    "(s.attempted_at >= ? OR (s.attempted_at IS NULL AND s.created_at >= ?))",
  ];
  const binds = [sinceIso, sinceIso];
  if (status) { conds.push("s.status = ?"); binds.push(status); }
  if (toEmail) { conds.push("s.to_email LIKE ?"); binds.push(`%${toEmail}%`); }
  const where = conds.join(" AND ");

  const listSql = `
    SELECT
      s.id              AS send_id,
      s.prospect_id,
      s.draft_id,
      s.to_email,
      s.from_email,
      s.reply_to,
      s.subject         AS draft_subject,
      s.status          AS send_status,
      s.provider,
      s.provider_id,
      s.attempted_at,
      s.finished_at,
      s.created_at,
      s.failure_reason,
      rc.label          AS reply_label,
      rc.action_taken   AS reply_action,
      rc.confidence     AS reply_confidence,
      rc.reviewed_at    AS reply_reviewed_at,
      rc.reply_id
    FROM prospect_sends s
    LEFT JOIN reply_classifications rc
      ON (s.prospect_id IS NOT NULL AND rc.prospect_id = s.prospect_id)
    WHERE ${where}
    ORDER BY (s.attempted_at IS NULL), s.attempted_at DESC, s.created_at DESC
    LIMIT ? OFFSET ?`;
  const listBinds = [...binds, limit, offset];

  const countSql = `SELECT COUNT(*) AS total FROM prospect_sends s WHERE ${where}`;

  try {
    const listRes = await env.LEADS_DB.prepare(listSql).bind(...listBinds).all();
    items = listRes.results || [];
    const cRes = await env.LEADS_DB.prepare(countSql).bind(...binds).first();
    total = cRes?.total ?? 0;
  } catch (e) {
    return json({ ok: false, error: `query_failed: ${String(e?.message || e).slice(0, 200)}` }, 500, request, env);
  }

  return json({ ok: true, count: items.length, total, items }, 200, request, env);
}
