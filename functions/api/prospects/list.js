// GET /api/prospects/list?status=…&vertical=…&q=…&limit=50
// Returns prospects (joined with latest signal + draft + last send) for admin UI.
//
// Admin-only — bearer JWT issued by /v1/admin/login (same secret as /api/admin/metrics).

import { verifyAdminToken, json, corsHeaders } from "../_shared/adminAuth.js";

export async function onRequestGet({ request, env }) {
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  const u = new URL(request.url);
  const status    = u.searchParams.get("status");
  const vertical  = u.searchParams.get("vertical");
  const q         = u.searchParams.get("q");
  const limit     = Math.min(parseInt(u.searchParams.get("limit") || "50", 10), 200);

  const wheres = []; const params = [];
  if (status)   { wheres.push("p.status = ?"); params.push(status); }
  if (vertical) { wheres.push("p.vertical = ?"); params.push(vertical); }
  if (q)        { wheres.push("(p.business_name LIKE ? OR p.root_domain LIKE ? OR p.email LIKE ?)"); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const whereSql = wheres.length ? "WHERE " + wheres.join(" AND ") : "";

  const sql = `
    SELECT
      p.id, p.business_name, p.root_domain, p.website, p.vertical, p.city, p.email, p.status,
      p.last_scanned_at, p.last_drafted_at, p.last_sent_at,
      s.leak_score, s.leak_signals_json, s.detected_platform, s.title, s.page_weight_kb, s.load_time_ms,
      (SELECT subject FROM prospect_drafts d WHERE d.prospect_id = p.id AND d.status IN ('draft','approved') ORDER BY d.created_at DESC LIMIT 1) AS draft_subject,
      (SELECT status FROM prospect_drafts d WHERE d.prospect_id = p.id AND d.status IN ('draft','approved') ORDER BY d.created_at DESC LIMIT 1) AS draft_status,
      (SELECT status FROM prospect_sends r WHERE r.prospect_id = p.id ORDER BY r.attempted_at DESC LIMIT 1) AS last_send_status,
      (SELECT attempted_at FROM prospect_sends r WHERE r.prospect_id = p.id ORDER BY r.attempted_at DESC LIMIT 1) AS last_send_at
    FROM prospects p
    LEFT JOIN prospect_signals s ON s.id = (SELECT id FROM prospect_signals WHERE prospect_id = p.id ORDER BY scanned_at DESC LIMIT 1)
    ${whereSql}
    ORDER BY COALESCE(s.leak_score, 0) DESC, p.created_at DESC
    LIMIT ?
  `;
  const rows = await env.LEADS_DB.prepare(sql).bind(...params, limit).all();
  return json({ ok: true, count: rows.results?.length || 0, items: rows.results || [] }, 200, request, env);
}

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

