// GET /api/admin/audit?q=&kind=&event_type=&limit=
// Returns the most recent opportunity_events rows (the audit trail),
// newest first. Admin-only.
//
// `q` matches against event_type, payload_json, kind, or any *_id fields.

import { verifyAdminToken, json, corsHeaders } from "../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").slice(0, 100).trim();
  const kind = url.searchParams.get("kind") || "";
  const eventType = url.searchParams.get("event_type") || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 200);

  try {
    const conds = [];
    const binds = [];
    if (q) {
      conds.push(`(event_type LIKE ? OR payload_json LIKE ? OR prospect_id LIKE ? OR sam_id LIKE ? OR actor LIKE ?)`);
      const like = `%${q}%`;
      binds.push(like, like, like, like, like);
    }
    if (kind) { conds.push("kind = ?"); binds.push(kind); }
    if (eventType) { conds.push("event_type = ?"); binds.push(eventType); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const r = await env.LEADS_DB.prepare(`
      SELECT id, kind, prospect_id, sam_id, event_type, actor, from_stage, to_stage,
             payload_json, created_at
      FROM opportunity_events
      ${where}
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(...binds, limit).all();

    const items = (r.results || []).map((row) => {
      let summary = "";
      try { summary = String(JSON.parse(row.payload_json || "{}").summary || JSON.parse(row.payload_json || "{}")).slice(0, 200); }
      catch { summary = String(row.payload_json || "").slice(0, 200); }
      return {
        id: row.id,
        kind: row.kind,
        prospect_id: row.prospect_id,
        sam_id: row.sam_id,
        event_type: row.event_type,
        actor: row.actor,
        from_stage: row.from_stage,
        to_stage: row.to_stage,
        summary,
        payload: row.payload_json,
        created_at: row.created_at,
      };
    });

    return json({ ok: true, items, total: items.length, limit, q, kind, event_type: eventType || null, updatedAt: new Date().toISOString() }, 200, request, env);
  } catch (e) {
    return json({ ok: false, error: "audit_failed", details: String(e?.message || e) }, 500, request, env);
  }
}
