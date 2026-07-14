// POST /api/admin/opportunities/:id/events?kind=prospect|sam
// Append-only audit event from the UI (note + tag).
// Used when "landed lead", "added contact", etc.

import { verifyAdminToken, json, corsHeaders } from "../../../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env, params }) {
  return json({ ok: false, error: "use_detail_endpoint" }, 400, request, env, env);
}

export async function onRequestPost({ request, env, params }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const id = params.id;
  if (!id) return json({ ok: false, error: "missing_id" }, 400, request, env);
  if (kind !== "prospect" && kind !== "sam") return json({ ok: false, error: "kind_required" }, 400, request, env);

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const eventType = String(body?.event_type || "note").slice(0, 64);
  const payload = body?.payload || {};

  // Make sure the parent exists
  const table = kind === "prospect" ? "prospects" : "gov_opportunities";
  try {
    const row = await env.LEADS_DB.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(id).first();
    if (!row) return json({ ok: false, error: "not_found" }, 404, request, env);

    const evId = crypto.randomUUID();
    await env.LEADS_DB.prepare(`
      INSERT INTO opportunity_events (id, kind, prospect_id, sam_id, event_type, actor, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, 'owner', ?, ?)
    `).bind(
      evId,
      kind,
      kind === "prospect" ? id : null,
      kind === "sam" ? id : null,
      eventType,
      JSON.stringify(payload).slice(0, 8000),
      new Date().toISOString(),
    ).run();

    // Bump last_touched_at
    await env.LEADS_DB.prepare(`UPDATE ${table} SET last_touched_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), id).run();

    return json({ ok: true, id: evId }, 200, request, env);
  } catch (err) {
    console.error("event log error", err);
    return json({ ok: false, error: "unhandled", details: String(err?.message || err) }, 500, request, env);
  }
}
