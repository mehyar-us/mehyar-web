// POST /api/admin/cron/run?job=sam-ingest|outreach|all
// Manually invokes the same logic that _scheduled.js runs server-side.
// Used by:
//   - Hermes daily cron job (8am UTC) — fires this endpoint
//   - "Run now" button in /admin/system Cron sub-tab
//   - Development & verification
//
// Auth: bearer admin token OR bearer GOV_INGEST_TOKEN (machine-to-machine).

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";
import { runGovOpportunityIngest } from "../../_shared/govOpportunities.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env }) {
  // Allow two auth paths
  const authHeader = request.headers.get("authorization") || "";
  const url = new URL(request.url);
  const job = url.searchParams.get("job") || "all";

  let authorized = false;
  let actor = "anonymous";

  if (authHeader.startsWith("Bearer ")) {
    const tok = authHeader.slice(7);
    if (tok && env.GOV_INGEST_TOKEN && tok === env.GOV_INGEST_TOKEN) {
      authorized = true;
      actor = "cron:hermes";
    } else {
      const a = await verifyAdminToken(request, env);
      if (a.ok) { authorized = true; actor = "owner"; }
    }
  }
  if (!authorized) return json({ ok: false, error: "unauthorized" }, 401, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const startedAt = new Date();
  const results = { started_at: startedAt.toISOString(), actor, job };

  // SAM ingest
  if (job === "all" || job === "sam-ingest") {
    try {
      results.gov = await runGovOpportunityIngest({ env, now: startedAt });
    } catch (e) {
      results.gov = { ok: false, error: String(e?.message || e) };
    }
  }

  // Outreach send-due (read-only)
  if (job === "all" || job === "outreach") {
    try {
      const rows = await env.LEADS_DB.prepare(`
        SELECT p.id AS prospect_id, p.business_name, s.name AS source_name, os.step_order
        FROM prospects p
        JOIN prospect_sources s ON s.id = p.source AND s.active = 1
        JOIN outreach_steps os ON os.source_id = s.id AND os.active = 1
        WHERE p.status = 'queued'
          AND NOT EXISTS (SELECT 1 FROM prospect_sends ps WHERE ps.prospect_id = p.id AND ps.status IN ('sent','replied'))
        LIMIT 50
      `).all().catch(() => ({ results: [] }));
      results.outreach = { ok: true, send_due_count: (rows.results || []).length };
    } catch (e) {
      results.outreach = { ok: false, error: String(e?.message || e) };
    }
  }

  // LLM deep-evaluate for top-3 prospects with highest leak_score (max 3/day to limit cost)
  if (job === "all" || job === "deep-evaluate") {
    try {
      const top = await env.LEADS_DB.prepare(`
        SELECT p.id, p.business_name, p.root_domain
        FROM prospects p
        LEFT JOIN prospect_signals s ON s.id = (SELECT id FROM prospect_signals WHERE prospect_id = p.id ORDER BY scanned_at DESC LIMIT 1)
        WHERE p.status NOT IN ('archived','rejected')
          AND (p.last_deep_eval_at IS NULL OR datetime(p.last_deep_eval_at) <= datetime('now','-12 hour'))
        ORDER BY s.leak_score DESC NULLS LAST
        LIMIT 3
      `).all().catch(() => ({ results: [] }));
      results.deep_evaluate = { candidates: (top.results || []).length };
      // We don't invoke the LLM here synchronously to avoid timeouts; instead, log that they were "queued".
      // The /api/admin/leads/<id>/deep-evaluate endpoint is what fires the LLM.
    } catch (e) {
      results.deep_evaluate = { ok: false, error: String(e?.message || e) };
    }
  }

  // Persist run
  const duration_ms = Date.now() - startedAt.getTime();
  const runId = crypto.randomUUID();
  await env.LEADS_DB.prepare(`
    INSERT INTO cron_runs (id, name, payload_json, created_at)
    VALUES (?, ?, ?, datetime('now'))
  `).bind(runId, `manual:${job}`, JSON.stringify({ ...results, duration_ms, source: `manual:${actor}` }).slice(0, 18000)).run().catch(() => null);

  return json({
    ok: true,
    run_id: runId,
    duration_ms,
    ...results,
    updatedAt: new Date().toISOString(),
  }, 200, request, env);
}
