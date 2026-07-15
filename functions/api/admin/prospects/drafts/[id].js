// GET /api/admin/prospects/drafts/:id
// Returns a single prospect_drafts row + its queued send + business + LLM context.
//
// Used by:
//   - AdminMoney DraftDetailDrawer (opened from /admin/money?focus=<id>)
//   - AdminCRM deep-link: /admin/outreach?focus=<id>  (backward-compat — legacy route)
//
// Owner-only.

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env, params }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const id = params?.id;
  if (!id) return json({ ok: false, error: "id_required" }, 400, request, env);

  let draft;
  try {
    draft = await env.LEADS_DB.prepare(`
      SELECT id, prospect_id, sam_id, subject, body_text, body_html,
             generated_by, model, status, reviewer_notes, payload_json,
             cited_signals_json, created_at, updated_at
      FROM prospect_drafts WHERE id = ? LIMIT 1
    `).bind(id).first();
  } catch (e) {
    return json({ ok: false, error: "query_failed", details: String(e?.message || e) }, 500, request, env);
  }

  if (!draft) return json({ ok: false, error: "not_found" }, 404, request, env);

  // Hydrate related: prospect, sam_opportunity, queued send
  let prospect = null;
  let sam = null;
  let queuedSend = null;

  if (draft.prospect_id) {
    try {
      prospect = await env.LEADS_DB.prepare(`
        SELECT id, business_name, root_domain, website, email, vertical, city, region, status
        FROM prospects WHERE id = ? LIMIT 1
      `).bind(draft.prospect_id).first();
    } catch {}
  }
  if (draft.sam_id) {
    try {
      sam = await env.LEADS_DB.prepare(`
        SELECT id, title, agency, naics, deadline_date, fit_score, stage
        FROM gov_opportunities WHERE id = ? LIMIT 1
      `).bind(draft.sam_id).first();
    } catch {}
  }
  try {
    queuedSend = await env.LEADS_DB.prepare(`
      SELECT id, to_email, status, scheduled_for, attempted_at, finished_at, provider_id
      FROM prospect_sends WHERE draft_id = ? ORDER BY created_at DESC LIMIT 1
    `).bind(id).first();
  } catch {}

  // Parse payload_json (LLM tier/service context)
  let payload = null;
  try { if (draft.payload_json) payload = JSON.parse(draft.payload_json); } catch {}

  return json({
    ok: true,
    draft: {
      id: draft.id,
      subject: draft.subject,
      body_text: draft.body_text,
      body_html: draft.body_html,
      generated_by: draft.generated_by,
      model: draft.model,
      status: draft.status,
      reviewer_notes: draft.reviewer_notes,
      payload,
      cited_signals: safeJson(draft.cited_signals_json),
      created_at: draft.created_at,
      updated_at: draft.updated_at,
    },
    prospect,
    sam_opportunity: sam,
    queued_send: queuedSend,
    kind: draft.sam_id ? "sam" : (draft.prospect_id ? "prospect" : "unknown"),
  }, 200, request, env);
}

function safeJson(s) {
  if (!s) return [];
  try { return JSON.parse(s); } catch { return []; }
}

// PATCH /api/admin/prospects/drafts/:id
// Updates body_text / status / reviewer_notes for an existing draft.
// Used by the DraftDetailDrawer's "Approve & queue send" button.
export async function onRequestPatch({ request, env, params }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const id = params?.id;
  if (!id) return json({ ok: false, error: "id_required" }, 400, request, env);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, request, env); }

  const allowed = ["body_text", "body_html", "status", "reviewer_notes", "subject"];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (body[k] != null) { sets.push(`${k} = ?`); vals.push(String(body[k])); }
  }
  if (sets.length === 0) return json({ ok: false, error: "no_fields" }, 400, request, env);
  sets.push("updated_at = datetime('now')");
  vals.push(id);

  try {
    const res = await env.LEADS_DB.prepare(`UPDATE prospect_drafts SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
    return json({ ok: true, updated: res?.meta?.changes ?? 0, id }, 200, request, env);
  } catch (e) {
    return json({ ok: false, error: "update_failed", details: String(e?.message || e) }, 500, request, env);
  }
}