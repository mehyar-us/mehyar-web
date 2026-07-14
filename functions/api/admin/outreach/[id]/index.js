// GET    /api/admin/outreach/:id            — get one outreach step
// PUT    /api/admin/outreach/:id            — update an outreach step
// DELETE /api/admin/outreach/:id            — deactivate a step

import { verifyAdminToken, json, corsHeaders } from "../../../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env, params }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);
  const { id } = params || {};
  if (!id) return json({ ok: false, error: "id_required" }, 400, request, env);

  let row;
  try {
    row = await env.LEADS_DB.prepare(`
      SELECT s.*, (SELECT name FROM prospect_sources WHERE id = s.source_id) AS source_name
      FROM outreach_steps s WHERE s.id = ?
    `).bind(id).first();
  } catch (e) {
    return json({ ok: false, error: "query_failed", details: String(e?.message || e) }, 500, request, env);
  }
  if (!row) return json({ ok: false, error: "not_found" }, 404, request, env);
  return json({ ok: true, item: row }, 200, request, env);
}

export async function onRequestPut({ request, env, params }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);
  const { id } = params || {};
  if (!id) return json({ ok: false, error: "id_required" }, 400, request, env);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400, request, env);
  }

  const allowed = [
    "name", "step_order", "type", "delay_days", "require_manual_approval",
    "skip_if_replied", "active", "subject_template", "body_template",
    "from_name", "from_email", "description",
  ];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (body.hasOwnProperty(k)) {
      sets.push(`${k} = ?`);
      if (k === "require_manual_approval" || k === "skip_if_replied" || k === "active") {
        vals.push(body[k] ? 1 : 0);
      } else {
        vals.push(body[k]);
      }
    }
  }
  if (!sets.length) return json({ ok: false, error: "no_valid_fields" }, 400, request, env);

  sets.push("updated_at = ?");
  vals.push(new Date().toISOString());
  vals.push(id);

  try {
    await env.LEADS_DB.prepare(`UPDATE outreach_steps SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
  } catch (e) {
    return json({ ok: false, error: "update_failed", details: String(e?.message || e) }, 500, request, env);
  }

  const row = await env.LEADS_DB.prepare("SELECT * FROM outreach_steps WHERE id = ?").bind(id).first();
  return json({ ok: true, item: row }, 200, request, env);
}

export async function onRequestDelete({ request, env, params }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);
  const { id } = params || {};
  if (!id) return json({ ok: false, error: "id_required" }, 400, request, env);

  // Soft-delete: set active = 0
  try {
    await env.LEADS_DB.prepare(`UPDATE outreach_steps SET active = 0, updated_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), id).run();
  } catch (e) {
    return json({ ok: false, error: "delete_failed", details: String(e?.message || e) }, 500, request, env);
  }
  return json({ ok: true }, 200, request, env);
}
