// /api/admin/health  +  /api/admin/settings (POST)

import { verifyAdminToken, json, corsHeaders } from "../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  try {
    const dbsize = await env.LEADS_DB.prepare(`SELECT page_count * page_size as size_bytes FROM pragma_page_count(), pragma_page_size()`).first().catch(() => null);
    const tablesCount = await env.LEADS_DB.prepare(`SELECT COUNT(*) as n FROM sqlite_master WHERE type='table'`).first().catch(() => null);
    const rowsCount = await env.LEADS_DB.prepare(`SELECT SUM((SELECT COUNT(*) FROM opportunities_events)) + (SELECT COUNT(*) FROM prospects) + (SELECT COUNT(*) FROM gov_opportunities) as n`).first().catch(() => null);

    const errCount = await env.LEADS_DB.prepare(`
      SELECT COUNT(*) as n FROM opportunity_events
      WHERE event_type IN ('error','exception')
      AND created_at >= datetime('now','-1 day')
    `).first().catch(() => null);

    const reqCount = await env.LEADS_DB.prepare(`
      SELECT COUNT(*) as n FROM opportunity_events
      WHERE created_at >= datetime('now','-1 day')
    `).first().catch(() => null);

    const llmCount = await env.LEADS_DB.prepare(`
      SELECT COUNT(*) as n FROM opportunity_events
      WHERE event_type IN ('deep_evaluate','analysis','enrichment','jarvis_query','auto_tender')
      AND created_at >= datetime('now','-1 day')
    `).first().catch(() => null);

    return json({
      ok: true,
      db: {
        size_mb: dbsize ? (dbsize.size_bytes || 0) / (1024*1024) : null,
        tables: tablesCount?.n || 0,
        rows_total: rowsCount?.n || 0,
      },
      llm: {
        provider: "cloudflare",
        model: env.LLM_MODEL || "@cf/meta/llama-3.2-3b-instruct",
        reachable: false, // we don't probe from here; the helper chatJson reports per-call
      },
      errors_24h: errCount?.n || 0,
      requests_24h: reqCount?.n || 0,
      llm_calls_24h: llmCount?.n || 0,
      updatedAt: new Date().toISOString(),
    }, 200, request, env);
  } catch (e) {
    return json({ ok: false, error: "health_failed", details: String(e?.message || e) }, 500, request, env);
  }
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  let body = {};
  try { body = await request.json(); } catch {}
  // Settings persist via per-env vars — record audit + return ok.
  try {
    if (env?.LEADS_DB) {
      await env.LEADS_DB.prepare(`
        INSERT INTO opportunity_events (id, kind, prospect_id, sam_id, event_type, actor, payload_json, created_at)
        VALUES (?, 'sam', NULL, NULL, 'settings_updated', 'owner', ?, datetime('now'))
      `).bind(crypto.randomUUID(), JSON.stringify({ body }).slice(0, 4000)).run().catch(() => null);
    }
    return json({ ok: true, note: "Settings are recorded. Real persistence requires CF Pages env vars; restart workers to apply model changes." }, 200, request, env);
  } catch (e) {
    return json({ ok: false, error: "settings_failed", details: String(e?.message || e) }, 500, request, env);
  }
}
