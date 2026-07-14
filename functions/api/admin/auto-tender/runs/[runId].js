// GET /api/admin/auto-tender/runs/<runId>/draft → returns the last generated draft JSON
// associated with a run, embedded in the auto_tender_runs.errors_json? No — the draft
// itself is generated on each POST and stored only in the opportunity_events audit row.
// For a richer view we recompute it on-demand using the existing pipeline helper.

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";
import { generateAutoTenderDraft } from "../../_shared/autoTenderPipeline.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env, params }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const runId = params.runId;
  if (!runId) return json({ ok: false, error: "missing_run_id" }, 400, request, env);

  try {
    const run = await env.LEADS_DB.prepare(`
      SELECT id, sam_item_id, sam_item_title, status, draft_id, triggered_at, completed_at
      FROM auto_tender_runs WHERE id = ? LIMIT 1
    `).bind(runId).first();
    if (!run) return json({ ok: false, error: "run_not_found" }, 404, request, env);

    // Optional cache: re-derive when requested
    const oppRow = await env.LEADS_DB.prepare(`
      SELECT id, title, agency, office, source, source_url, opportunity_type,
             set_aside, naics_codes_json, posted_date, response_deadline,
             estimated_value, summary, fit_score, confidence, stage,
             raw_json
      FROM gov_opportunities WHERE id = ? LIMIT 1
    `).bind(run.sam_item_id).first();
    if (!oppRow) {
      return json({ ok: false, error: "opportunity_not_found", run }, 404, request, env);
    }

    const result = await generateAutoTenderDraft({
      env,
      opp: oppRow,
      runId,
      now: new Date(run.triggered_at || Date.now()),
    });

    return json({
      ok: result.status === "completed",
      run,
      draft: result.draft,
      errors: result.errors || [],
    }, 200, request, env);
  } catch (err) {
    return json({ ok: false, error: "draft_failed", details: String(err?.message || err) }, 500, request, env);
  }
}
