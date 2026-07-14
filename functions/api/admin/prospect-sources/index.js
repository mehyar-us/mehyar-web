// GET  /api/admin/prospect-sources          — list all sources
// POST /api/admin/prospect-sources          — create a source
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
  const activeOnly = url.searchParams.get("active") === "true";

  let rows;
  try {
    const sql = activeOnly
      ? "SELECT id, name, kind, active, dedup_days, enforce_30day, tag, description, contact_url, created_at, updated_at FROM prospect_sources WHERE active = 1 ORDER BY name"
      : "SELECT id, name, kind, active, dedup_days, enforce_30day, tag, description, contact_url, created_at, updated_at FROM prospect_sources ORDER BY name";
    rows = await env.LEADS_DB.prepare(sql).all();
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

  const { name, kind, active, dedup_days, enforce_30day, tag, description, contact_url } = body || {};
  if (!name) return json({ ok: false, error: "name_required" }, 400, request, env);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await env.LEADS_DB.prepare(`
      INSERT INTO prospect_sources (id, name, kind, active, dedup_days, enforce_30day, tag, description, contact_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      String(name).slice(0, 120),
      String(kind || "manual").slice(0, 24),
      active !== undefined ? (active ? 1 : 0) : 1,
      Math.max(1, Math.min(Number(dedup_days) || 90, 3650)),
      enforce_30day !== undefined ? (enforce_30day ? 1 : 0) : 1,
      String(tag || "").slice(0, 60),
      String(description || "").slice(0, 500),
      String(contact_url || "").slice(0, 500),
      now, now
    ).run();
  } catch (e) {
    return json({ ok: false, error: "insert_failed", details: String(e?.message || e) }, 500, request, env);
  }

  const row = await env.LEADS_DB.prepare("SELECT * FROM prospect_sources WHERE id = ?").bind(id).first();
  return json({ ok: true, item: row }, 201, request, env);
}
