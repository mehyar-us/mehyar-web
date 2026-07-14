// GET /api/admin/cron/runs?limit=50&name=sam-ingest
// Owner-only listing of cron job runs. Used by the /admin "Cron Runs" tab
// to surface worker-side scheduled-task history without going to Telegram.

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 500);
  const name = url.searchParams.get("name") || "";
  // Ensure table exists (the scheduled handler creates it on first write,
  // but we want the read to work even if no scheduled run has happened yet).
  try {
    await env.LEADS_DB.prepare(`CREATE TABLE IF NOT EXISTS cron_runs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`).run();
  } catch {}

  let rows;
  if (name) {
    rows = await env.LEADS_DB.prepare(`SELECT id, name, payload_json, created_at FROM cron_runs WHERE name = ? ORDER BY created_at DESC LIMIT ?`).bind(name, limit).all();
  } else {
    rows = await env.LEADS_DB.prepare(`SELECT id, name, payload_json, created_at FROM cron_runs ORDER BY created_at DESC LIMIT ?`).bind(limit).all();
  }

  const items = (rows.results || []).map((r) => ({
    id: r.id,
    name: r.name,
    payload: safeJson(r.payload_json),
    created_at: r.created_at,
  }));

  return json({
    ok: true,
    items,
    total: items.length,
    limit,
    name: name || null,
    updatedAt: new Date().toISOString(),
  }, 200, request, env);
}

function safeJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return { _raw: s }; }
}
