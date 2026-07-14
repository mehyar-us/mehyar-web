// POST /api/admin/opportunities/:id/stage?kind=prospect|sam   { stage, note? }
// Move the opportunity stage and audit it.

import { verifyAdminToken, json, corsHeaders } from "../../../_shared/adminAuth.js";

const STAGES = new Set([
  "Discovery",
  "Evaluating",
  "Drafting",
  "ReadyToSend",
  "Sent",
  "Replied",
  "Won",
  "Lost",
  "Archived",
]);

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
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
  const stage = String(body?.stage || "");
  const note = body?.note ? String(body.note).slice(0, 800) : "";

  if (!STAGES.has(stage)) {
    return json({ ok: false, error: "bad_stage", allowed: [...STAGES] }, 400, request, env);
  }

  const table = kind === "prospect" ? "prospects" : "gov_opportunities";
  try {
    const existing = await env.LEADS_DB.prepare(`SELECT stage FROM ${table} WHERE id = ?`).bind(id).first();
    if (!existing) return json({ ok: false, error: "not_found" }, 404, request, env);

    await env.LEADS_DB.prepare(`UPDATE ${table} SET stage = ?, last_touched_at = ? WHERE id = ?`)
      .bind(stage, new Date().toISOString(), id).run();

    // Audit
    await env.LEADS_DB.prepare(`
      INSERT INTO opportunity_events (id, kind, prospect_id, sam_id, event_type, from_stage, to_stage, actor, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'owner', ?, ?)
    `).bind(
      crypto.randomUUID(),
      kind,
      kind === "prospect" ? id : null,
      kind === "sam" ? id : null,
      "stage_change",
      existing?.stage || null,
      stage,
      JSON.stringify({ note }),
      new Date().toISOString(),
    ).run();

    return json({ ok: true, stage, previous: existing?.stage || null, id }, 200, request, env);
  } catch (err) {
    console.error("stage update error", err);
    return json({ ok: false, error: "unhandled", details: String(err?.message || err) }, 500, request, env);
  }
}
