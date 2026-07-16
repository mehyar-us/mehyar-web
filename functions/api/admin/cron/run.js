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

  // SAM ingest (legacy govOpportunityIngest)
  if (job === "all" || job === "sam-ingest") {
    try {
      results.gov = await runGovOpportunityIngest({ env, now: startedAt });
    } catch (e) {
      results.gov = { ok: false, error: String(e?.message || e) };
    }
  }

  // Multi-source contract ingestion (SAM.gov + USASpending + NY State)
  if (job === "all" || job === "contracts") {
    try {
      const sources = (env.SAM_GOV_API_KEY || env.MEHYARSOFT_SAM_API_KEY)
        ? ["sam", "usaspending", "ny"]
        : ["usaspending", "ny"];
      const url = new URL(request.url);
      // Reconstruct base URL (CF Pages passes request.url that includes the path; we want the origin)
      const origin = `${url.protocol}//${url.host}`;
      const r = await fetch(`${origin}/api/admin/leads/ingest-contracts`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${actor === "cron:hermes" ? env.GOV_INGEST_TOKEN : (authHeader || "").slice(7)}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sources, deadline_days: 14, max_per_source: 20 }),
        signal: AbortSignal.timeout(180_000),
      });
      const j = await r.json().catch(() => ({}));
      results.contracts = j;
    } catch (e) {
      results.contracts = { ok: false, error: String(e?.message || e) };
    }
  }

  // Outreach send-due (read-only)
  if (job === "all" || job === "outreach") {
    try {
      const rows = await env.LEADS_DB.prepare(`
        SELECT p.id AS prospect_id, p.business_name, s.name AS source_name, os.step_order, p.source AS source_key
        FROM prospects p
        LEFT JOIN prospect_sources s
          ON LOWER(REPLACE(s.name, ' ', '_')) = p.source
          OR s.id = p.source
          OR LOWER(s.name) = LOWER(REPLACE(p.source, '_', ' '))
        LEFT JOIN outreach_steps os
          ON os.source_id = s.id
         AND os.step_order = COALESCE((SELECT MIN(os2.step_order)
                                          FROM outreach_steps os2
                                          WHERE os2.source_id = s.id
                                            AND os2.active = 1), 1)
         AND os.active = 1
        WHERE p.status = 'queued'
          AND NOT EXISTS (SELECT 1 FROM prospect_sends ps
                            WHERE ps.prospect_id = p.id
                              AND ps.status IN ('sent','replied'))
        LIMIT 50
      `).all().catch(() => ({ results: [] }));
      results.outreach = {
        ok: true,
        send_due_count: (rows.results || []).length,
        sample: (rows.results || []).slice(0, 5).map(r => ({
          prospect_id: r.prospect_id,
          business_name: r.business_name,
          source_key: r.source_key,
          source_name: r.source_name,
          step_order: r.step_order,
        })),
      };
    } catch (e) {
      results.outreach = { ok: false, error: String(e?.message || e) };
    }
  }

  // LLM deep-evaluate for top prospects (max 2/day to limit cost).
  // Actually fires the LLM by invoking the same handler the UI uses,
  // rather than just logging "candidates". Catches per-prospect failures
  // so a single bad row doesn't kill the rest of the batch.
  if (job === "all" || job === "deep-evaluate") {
    try {
      const top = await env.LEADS_DB.prepare(`
        SELECT p.id, p.business_name, p.root_domain,
               COALESCE(s.leak_score, 0) AS leak_score
        FROM prospects p
        LEFT JOIN prospect_signals s ON s.id = (
          SELECT id FROM prospect_signals
          WHERE prospect_id = p.id
          ORDER BY scanned_at DESC LIMIT 1
        )
        WHERE p.status NOT IN ('archived','rejected')
          AND (p.last_deep_eval_at IS NULL
               OR datetime(p.last_deep_eval_at) <= datetime('now','-12 hour'))
        ORDER BY leak_score DESC, p.updated_at DESC
        LIMIT 2
      `).all().catch(() => ({ results: [] }));

      const url = new URL(request.url);
      const origin = `${url.protocol}//${url.host}`;
      const evalResults = [];
      for (const r of (top.results || [])) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 75_000); // LLM call — give it room
          const er = await fetch(`${origin}/api/admin/leads/${encodeURIComponent(r.id)}/deep-evaluate?kind=prospect`, {
            method: "POST",
            headers: {
              "authorization": `Bearer ${env.GOV_INGEST_TOKEN}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ force: false }),
            signal: ctrl.signal,
          });
          clearTimeout(timer);
          const ej = await er.json().catch(() => ({}));
          evalResults.push({
            id: r.id, business_name: r.business_name, leak_score: r.leak_score,
            ok: ej.ok || false, cached: ej.cached || false,
            fit_score: ej.evaluation?.fit_score ?? null,
            used_llm: ej.used_llm ?? null,
            error: ej.ok ? null : (ej.error || "unknown"),
          });
          // Mark last_deep_eval_at so we don't re-eval next run
          await env.LEADS_DB.prepare(
            `UPDATE prospects SET last_deep_eval_at = datetime('now') WHERE id = ?`
          ).bind(r.id).run().catch(() => null);
        } catch (e) {
          evalResults.push({
            id: r.id, business_name: r.business_name, leak_score: r.leak_score,
            ok: false, error: String(e?.message || e),
          });
        }
      }
      results.deep_evaluate = {
        candidates: (top.results || []).length,
        fired: evalResults.length,
        succeeded: evalResults.filter((r) => r.ok).length,
        sample: evalResults,
      };
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
