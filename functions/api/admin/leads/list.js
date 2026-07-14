// GET /api/admin/leads/list?limit=50&offset=0&q=...
// Admin-only list of ALL leads (no date filter), the unbatched counterpart
// to /api/admin/dashboard/today which only returns the window.

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await verifyAdminToken(request, env);
    if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
    if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);
    const q = (url.searchParams.get("q") || "").slice(0, 100).trim();
    const status = (url.searchParams.get("status") || "").slice(0, 32).trim();

    // Positional binds — D1 doesn't accept object form. Keep the bind list
    // explicit and aligned with the SQL placeholder count.
    const args = [];
    const placeholderQs = [];
    if (q) {
      placeholderQs.push("(name LIKE ? OR email LIKE ? OR company LIKE ? OR website LIKE ? OR phone LIKE ? OR message LIKE ?)");
      const wild = `%${q}%`;
      for (let i = 0; i < 6; i++) args.push(wild);
    }
    if (status) {
      placeholderQs.push("status = ?");
      args.push(status);
    }
    const whereSql = placeholderQs.length ? "WHERE " + placeholderQs.join(" AND ") : "";

    const rowsSql = `SELECT id, created_at, source, form_type, status,
                            name, email, phone, company, website,
                            service_interest, budget_range, timeline,
                            message, consent_contact, consent_marketing
                     FROM leads
                     ${whereSql}
                     ORDER BY created_at DESC
                     LIMIT ? OFFSET ?`;
    args.push(limit, offset);

    let rows, totalRow;
    try {
      rows = await env.LEADS_DB.prepare(rowsSql).bind(...args).all();
    } catch (inner) {
      console.error("leads list: SELECT failed", inner?.message || inner);
      return json({ ok: false, error: "leads_query_failed", details: inner?.message || String(inner) }, 500, request, env);
    }
    try {
      // Count uses only the WHERE binds (no LIMIT/OFFSET).
      const countArgs = args.slice(0, args.length - 2);
      totalRow = await env.LEADS_DB.prepare(`SELECT COUNT(*) AS n FROM leads ${whereSql}`).bind(...countArgs).first();
    } catch {
      totalRow = { n: (rows.results || []).length };
    }

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
  } catch (err) {
    console.error("leads list: outer error", err);
    return json({ ok: false, error: "unhandled", details: err?.message || String(err) }, 500, request, env);
  }
}

