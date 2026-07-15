// POST /api/admin/leads/<id>/stage?kind=prospect|sam   body { stage }
// Move a lead's stage + audit.

import { verifyAdminToken, json, corsHeaders } from "../../../_shared/adminAuth.js";

const VALID_PROSPECT = ["new","scanned","draft_needed","drafting","approved","queued","sent","replied","won","lost","archived","rejected"];
const VALID_SAM      = ["discovery","evaluating","drafting","ready","queued","sent","replied","won","lost","archived","no_bid"];

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
  let body = {};
  try { body = await request.json(); } catch {}
  const stage = String(body?.stage || "").trim();
  if (!["prospect","sam"].includes(kind)) return json({ ok: false, error: "kind_required" }, 400, request, env);
  if (!id) return json({ ok: false, error: "missing_id" }, 400, request, env);
  const valid = kind === "sam" ? VALID_SAM : VALID_PROSPECT;
  if (!valid.includes(stage)) return json({ ok: false, error: "bad_stage", accepted: valid }, 400, request, env);

  try {
    const table = kind === "sam" ? "gov_opportunities" : "prospects";
    const col = kind === "sam" ? "stage" : "status";

    // Capture previous stage
    const prev = await env.LEADS_DB.prepare(`SELECT ${col} as prev FROM ${table} WHERE id = ?`).bind(id).first().catch(() => null);

    const r = await env.LEADS_DB.prepare(`UPDATE ${table} SET ${col} = ?, updated_at = datetime('now') WHERE id = ?`).bind(stage, id).run().catch(() => null);
    if (!r || (r.meta && r.meta.changes === 0)) {
      // fallback for endpoints that may not include .meta
    }

    // Audit
    await env.LEADS_DB.prepare(`
      INSERT INTO opportunity_events (id, kind, prospect_id, sam_id, event_type, actor, from_stage, to_stage, payload_json, created_at)
      VALUES (?, ?, ?, ?, 'stage_change', 'owner', ?, ?, ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      kind, kind === "sam" ? null : id, kind === "sam" ? id : null,
      prev?.prev || "", stage,
      JSON.stringify({ source: "leads/stage" }).slice(0, 4000),
    ).run().catch(() => null);

    return json({ ok: true, id, kind, previous_stage: prev?.prev || null, stage }, 200, request, env);
  } catch (e) {
    return json({ ok: false, error: "stage_failed", details: String(e?.message || e) }, 500, request, env);
  }
}
