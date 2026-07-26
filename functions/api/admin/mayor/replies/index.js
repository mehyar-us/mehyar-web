// GET /api/admin/mayor/replies
//
// Lightweight replies queue for the CRM Replies tab. Returns inbound
// prospect_replies rows, optionally restricted to items that still need owner
// attention.

import { verifyAdminToken, json, corsHeaders } from "../../../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

function boundInt(value, fallback, max) {
  const n = parseInt(value || "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, n));
}

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const needsActionOnly = url.searchParams.get("needs_action") === "1";
  const limit = boundInt(url.searchParams.get("limit"), 100, 200);

  const where = [];
  const args = [];
  if (needsActionOnly) where.push("COALESCE(pr.needs_action, 1) = 1");
  if (q) {
    where.push("(pr.from_email LIKE ? OR pr.subject LIKE ? OR pr.body_excerpt LIKE ? OR p.business_name LIKE ? OR p.email LIKE ?)");
    const wild = `%${q}%`;
    args.push(wild, wild, wild, wild, wild);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  try {
    const rows = await env.LEADS_DB.prepare(`
      SELECT
        pr.id,
        pr.prospect_id,
        pr.send_id,
        pr.received_at,
        pr.from_email,
        NULL AS from_name,
        pr.subject,
        pr.body_excerpt,
        pr.classification,
        COALESCE(pr.needs_action, 1) AS needs_action,
        pr.handled_at,
        p.business_name,
        p.root_domain,
        p.email AS prospect_email,
        p.vertical,
        p.city,
        p.region
      FROM prospect_replies pr
      LEFT JOIN prospects p ON p.id = pr.prospect_id
      ${whereSql}
      ORDER BY pr.received_at DESC
      LIMIT ?
    `).bind(...args, limit).all();

    return json({
      ok: true,
      replies: rows.results || [],
      total: (rows.results || []).length,
      needs_action: needsActionOnly,
      q,
      updatedAt: new Date().toISOString(),
    }, 200, request, env);
  } catch (e) {
    return json({ ok: false, error: "query_failed", details: String(e?.message || e) }, 500, request, env);
  }
}
