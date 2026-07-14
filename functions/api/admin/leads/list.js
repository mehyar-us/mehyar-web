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

    // Run two separate queries with explicit named binds and the simplest
    // possible WHERE assembly. No fancy template parameter math.
    const conds = [];
    const qBind = q ? `%${q}%` : null;
    const statusBind = status || null;
    if (qBind) conds.push("(name LIKE ?q OR email LIKE ?q OR company LIKE ?q OR website LIKE ?q OR phone LIKE ?q OR message LIKE ?q)");
    if (statusBind) conds.push("status = ?st");
    const whereSql = conds.length ? "WHERE " + conds.join(" AND ") : "";

    const limitBind = limit;
    const offsetBind = offset;

    const namedArgs = {};
    if (qBind) namedArgs.q = qBind;
    if (statusBind) namedArgs.st = statusBind;
    namedArgs.lim = limitBind;
    namedArgs.off = offsetBind;

    const rowsSql = `SELECT id, created_at, source, form_type, status,
                            name, email, phone, company, website,
                            service_interest, budget_range, timeline,
                            message, consent_contact, consent_marketing
                     FROM leads
                     ${whereSql}
                     ORDER BY created_at DESC
                     LIMIT @lim OFFSET @off`;

    let rows, totalRow;
    try {
      rows = await env.LEADS_DB.prepare(rowsSql).bind(namedArgs).all();
    } catch (inner) {
      console.error("leads list: SELECT failed", inner?.message || inner);
      return json({ ok: false, error: "leads_query_failed", details: inner?.message || String(inner) }, 500, request, env);
    }
    try {
      const countArgs = {};
      if (qBind) countArgs.q = qBind;
      if (statusBind) countArgs.st = statusBind;
      totalRow = await env.LEADS_DB.prepare(`SELECT COUNT(*) AS n FROM leads ${whereSql}`).bind(countArgs).first();
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

