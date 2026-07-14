// GET  /api/admin/outreach            — list outreach steps with optional source_id filter
// POST /api/admin/outreach            — create an outreach step
// OPTIONS handled for CORS

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const url = new URL(request.url);
  const sourceId = url.searchParams.get("source_id") || "";

  let rows;
  try {
    if (sourceId) {
      rows = await env.LEADS_DB.prepare(`
        SELECT s.*, s.name as step_name,
               (SELECT name FROM prospect_sources WHERE id = s.source_id) AS source_name
        FROM outreach_steps s
        WHERE source_id = ?
        ORDER BY step_order ASC
      `).bind(sourceId).all();
    } else {
      rows = await env.LEADS_DB.prepare(`
        SELECT s.*, s.name as step_name,
               (SELECT name FROM prospect_sources WHERE id = s.source_id) AS source_name
        FROM outreach_steps s
        ORDER BY s.source_id, s.step_order ASC
      `).all();
    }
  } catch (e) {
    return json({ ok: false, error: "query_failed", details: String(e?.message || e) }, 500, request, env);
  }

  return json({ ok: true, items: rows.results || [], updatedAt: new Date().toISOString() }, 200, request, env);
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400, request, env);
  }

  const { name, source_id, step_order, type, delay_days, require_manual_approval, skip_if_replied, active, subject_template, body_template, from_name, from_email, description } = body || {};
  if (!name || !source_id) return json({ ok: false, error: "name_and_source_id_required" }, 400, request, env);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    await env.LEADS_DB.prepare(`
      INSERT INTO outreach_steps (id, name, source_id, step_order, type, delay_days, require_manual_approval, skip_if_replied, active, subject_template, body_template, from_name, from_email, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      String(name).slice(0, 120),
      String(source_id).slice(0, 40),
      Math.max(1, Number(step_order) || 1),
      String(type || "email").slice(0, 24),
      Math.max(0, Number(delay_days) || 0),
      require_manual_approval !== undefined ? (require_manual_approval ? 1 : 0) : 1,
      skip_if_replied !== undefined ? (skip_if_replied ? 1 : 0) : 1,
      active !== undefined ? (active ? 1 : 0) : 1,
      String(subject_template || "").slice(0, 500),
      String(body_template || "").slice(0, 10000),
      String(from_name || "Mehyar | MehyarSoft").slice(0, 120),
      String(from_email || "hello@mehyar.us").slice(0, 254),
      String(description || "").slice(0, 500),
      now, now
    ).run();
  } catch (e) {
    return json({ ok: false, error: "insert_failed", details: String(e?.message || e) }, 500, request, env);
  }

  const row = await env.LEADS_DB.prepare("SELECT * FROM outreach_steps WHERE id = ?").bind(id).first();
  return json({ ok: true, item: row }, 201, request, env);
}
