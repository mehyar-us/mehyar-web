// GET /api/admin/audit/search?q=&kind=&event_type=&limit=
// Returns stage-change events + decision records, newest first.
// Admin-only. Read-only.
import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

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
    const items = [];
    const decisions = [];

    // ── Stage-change events ─────────────────────────────────────────────────
    {
      const conds = [];
      const binds = [];
      if (q) {
        conds.push("(opportunity_id LIKE ? OR payload_json LIKE ?)");
        const wq = `%${q}%`;
        binds.push(wq, wq);
      }
      if (kind === "prospect") { conds.push("kind = 'prospect'"); }
      else if (kind === "sam") { conds.push("kind = 'sam'"); }
      if (eventType && eventType !== "decision") { conds.push("event_type = ?"); binds.push(eventType); }
      const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
      const sql = `
        SELECT id, kind, opportunity_id, event_type, from_stage, to_stage,
               actor, substr(payload_json, 1, 600) AS payload_json, created_at
        FROM opportunity_events
        ${where}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
      const result = await env.LEADS_DB.prepare(sql).bind(...binds).all();
      if (!result.error) items.push(...(result.results || []));
    }

    // ── Decisions ───────────────────────────────────────────────────────────
    {
      const conds = [];
      const binds = [];
      if (q) {
        conds.push("(opportunity_id LIKE ? OR reason_body LIKE ? OR reason_code LIKE ?)");
        const wq = `%${q}%`;
        binds.push(wq, wq, wq);
      }
      if (kind === "prospect") { conds.push("kind = 'prospect'"); }
      else if (kind === "sam") { conds.push("kind = 'sam'"); }
      if (eventType === "decision") { /* include all decisions */ }
      const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
      const sql = `
        SELECT id, kind, opportunity_id, decision, reason_code, reason_body,
               decided_by, decided_at, created_at
        FROM opportunity_decisions
        ${where}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
      const result = await env.LEADS_DB.prepare(sql).bind(...binds).all();
      if (!result.error) decisions.push(...(result.results || []));
    }

    // Sort combined set by created_at desc
    const allRows = [...items.map((r) => ({ ...r, _isDecision: false })), ...decisions.map((r) => ({ ...r, _isDecision: true }))]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);

    return json({
      ok: true,
      items,
      decisions,
      total: allRows.length,
      updatedAt: new Date().toISOString(),
    }, 200, request, env);
  } catch (err) {
    console.error("audit search error", err);
    return json({ ok: false, error: "fetch_failed", details: String(err?.message || err) }, 500, request, env);
  }
}
