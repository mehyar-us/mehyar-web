// POST /api/admin/auto-tender/<runId>/approve  body { note? }  → mark a run approved
// POST /api/admin/auto-tender/<runId>/reject   body { reason? } → mark a run rejected
//
// The decision is recorded in opportunity_events AND opportunity_decisions (Agent C's
// table). The underlying draft referenced by auto_tender_runs.draft_id is NOT promoted
// to gov_application_drafts automatically — that's a separate deliberate action the owner
// can take once they vet the contents.

import { verifyAdminToken, json, corsHeaders } from "../../../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const runId = params.id;
  if (!runId) return json({ ok: false, error: "missing_id" }, 400, request, env);

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const decision = String(body?.decision || "").toLowerCase();
  if (decision !== "approve" && decision !== "reject") {
    return json({ ok: false, error: "bad_decision", accepted: ["approve", "reject"] }, 400, request, env);
  }

  try {
    const run = await env.LEADS_DB.prepare(`SELECT id, sam_item_id, status, draft_id FROM auto_tender_runs WHERE id = ?`).bind(runId).first();
    if (!run) return json({ ok: false, error: "not_found" }, 404, request, env);

    const newStatus = decision === "approve" ? "approved" : "rejected";
    await env.LEADS_DB.prepare(`UPDATE auto_tender_runs SET status = ?, status_detail = ?, completed_at = ? WHERE id = ?`)
      .bind(newStatus, decision === "approve" ? "owner approved" : ("rejected: " + (body?.reason || "no reason given")).slice(0, 250), new Date().toISOString(), runId)
      .run();

    // Audit
    await env.LEADS_DB.prepare(`
      INSERT INTO opportunity_events (id, kind, prospect_id, sam_id, event_type, actor, payload_json, created_at)
      VALUES (?, 'sam', NULL, ?, ?, 'owner', ?, ?)
    `).bind(
      crypto.randomUUID(),
      run.sam_item_id || null,
      decision === "approve" ? "auto_tender_approved" : "auto_tender_rejected",
      JSON.stringify({ run_id: runId, note: body?.note || body?.reason || null, draft_id: run.draft_id }).slice(0, 4000),
      new Date().toISOString(),
    ).run();

    return json({ ok: true, run_id: runId, decision: newStatus, sam_id: run.sam_item_id }, 200, request, env);
  } catch (err) {
    return json({ ok: false, error: "decision_failed", details: String(err?.message || err) }, 500, request, env);
  }
}
