// GET /api/admin/leads/list?limit=50&offset=0&q=...
// Admin-only list of ALL leads (no date filter), the unbatched counterpart
// to /api/admin/dashboard/today which only returns the window.

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);
  const q = (url.searchParams.get("q") || "").slice(0, 100).trim();
  const status = (url.searchParams.get("status") || "").slice(0, 32).trim();

  // Build conditional WHERE — D1 doesn't bind a fragment, so build it in code.
  let where = [];
  const args = [];
  if (q) {
    where.push("(name LIKE ? OR email LIKE ? OR company LIKE ? OR website LIKE ? OR phone LIKE ? OR message LIKE ?)");
    const wild = `%${q}%`;
    for (let i = 0; i < 6; i++) args.push(wild);
  }
  if (status) {
    where.push("status = ?");
    args.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  args.push(limit, offset);

  const rows = await env.LEADS_DB.prepare(`
    SELECT id, created_at, source, source_channel, form_type, status,
           name, first_name, last_name, email, phone, company, business_name,
           website, service_interest, service_category, budget_range, timeline,
           zip_code, message, request_type, offer_code, consent_contact,
           utm_source, utm_medium, utm_campaign
    FROM leads
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).bind(...args).all();

  const totalRow = where.length
    ? await env.LEADS_DB.prepare(`SELECT COUNT(*) AS n FROM leads ${whereSql}`).bind(...args.slice(0, -2)).first()
    : await env.LEADS_DB.prepare(`SELECT COUNT(*) AS n FROM leads`).first();

  return json({
    ok: true,
    items: rows.results || [],
    total: Number(totalRow?.n || 0),
    limit,
    offset,
    q,
    status,
    updatedAt: new Date().toISOString(),
  }, 200, request, env);
}
