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

    // Run two separate queries instead of building conditional WHERE+bind.
    // Cleaner, no bind-shape mismatch risk, and SQLite is fast enough for the
    // row counts we're dealing with.
    let where = [];
    const args = [];
    if (q) {
      where.push("(name LIKE ?1 OR email LIKE ?1 OR company LIKE ?1 OR website LIKE ?1 OR phone LIKE ?1 OR message LIKE ?1)");
      args.push(`%${q}%`);
    }
    if (status) {
      where.push("status = ?2");
      args.push(status);
    }
    const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
    const rowsSql = `SELECT id, created_at, source, form_type, status,
                            name, email, phone, company, website,
                            service_interest, budget_range, timeline,
                            message, consent_contact, consent_marketing
                     FROM leads
                     ${whereSql}
                     ORDER BY created_at DESC
                     LIMIT ?3 OFFSET ?4`;
    args.push(limit, offset);

    let rows, totalRow;
    try {
      rows = await env.LEADS_DB.prepare(rowsSql).bind(...args).all();
    } catch (inner) {
      // If the leads table is missing in this D1 (older schema), surface
      // an explicit error instead of a Worker-threw-exception 500.
      console.error("leads list: SELECT failed", inner?.message || inner);
      return json({ ok: false, error: "leads_query_failed", details: inner?.message || String(inner) }, 500, request, env);
    }
    try {
      totalRow = await env.LEADS_DB.prepare(`SELECT COUNT(*) AS n FROM leads ${whereSql}`).bind(...args.slice(0, -2)).first();
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

