// /api/mayor/debug — read-only SQL query for diagnostics.
// Auth: GOV_INGEST_TOKEN OR admin JWT.
// Use ONLY for debugging — query is SELECT-only.

import { verifyAdminToken, json, corsHeaders } from "../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

async function bearerAccepted(request, env) {
  const h = request.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) return false;
  const tok = h.slice(7);
  if (tok && env?.GOV_INGEST_TOKEN && tok === env.GOV_INGEST_TOKEN) return true;
  const a = await verifyAdminToken(request, env);
  return a.ok;
}

export async function onRequestGet({ request, env }) {
  if (!await bearerAccepted(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  const url = new URL(request.url);
  const table = url.searchParams.get("table");
  const action = url.searchParams.get("action");
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);
  try {
    // 1. List tables (always)
    const tables = await env.LEADS_DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all();

    if (!table && !action) {
      return json({ ok: true, tables: tables.results?.map(t => t.name) || [] }, 200, request, env);
    }

    // 2. Count + sample rows from requested table
    if (table) {
      const safeName = table.replace(/[^a-zA-Z0-9_]/g, "");
      if (safeName !== table) return json({ ok: false, error: "bad_table_name" }, 400, request, env);
      const count = await env.LEADS_DB.prepare(`SELECT COUNT(*) AS n FROM ${safeName}`).first();
      const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "10", 10), 1), 50);
      const sample = await env.LEADS_DB.prepare(
        `SELECT * FROM ${safeName} ORDER BY rowid DESC LIMIT ${limit}`
      ).all();
      return json({
        ok: true,
        table: safeName,
        count: count?.n || 0,
        sample: sample.results || [],
      }, 200, request, env);
    }

    // 3. Specific actions: preview-outreach-queue, schema, etc.
    if (action === "preview_outreach_queue") {
      const now = new Date().toISOString();
      const rows = await env.LEADS_DB.prepare(
        `SELECT s.id, s.prospect_id, s.step_no, s.status, s.scheduled_for,
                p.business_name, p.email
         FROM prospect_sequences s
         LEFT JOIN prospects p ON p.id = s.prospect_id
         WHERE s.status = 'queued'
           AND (s.scheduled_for IS NULL OR s.scheduled_for <= ?)
         ORDER BY s.scheduled_for ASC
         LIMIT 20`
      ).bind(now).all();
      return json({ ok: true, count: (rows.results || []).length, rows: rows.results }, 200, request, env);
    }

    return json({ ok: false, error: "no_table_or_action" }, 400, request, env);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, request, env);
  }
}