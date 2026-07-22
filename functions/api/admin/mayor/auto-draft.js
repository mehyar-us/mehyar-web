// POST /api/admin/mayor/auto-draft
//
// Endpoint for the morning cron to generate AI drafts for SAM opps above
// fit_score threshold. Picks the top N drafts the founder hasn't yet seen.
// Uses _shared/cloudflareAI.js's draftOne() so it picks the right model per kind.
//
// Auth: bearer admin token OR GOV_INGEST_TOKEN (machine-to-machine cron).
// Closes the loop: discover → score → draft, all inside CF infrastructure.

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";
import { draftOne, fitScoreBatch, summarize } from "../../_shared/cloudflareAI.js";

const SAFE_FAILURE = "Mayor auto-draft unavailable.";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env }) {
  if (!env?.LEADS_DB) return json({ ok: false, message: SAFE_FAILURE }, 500, request, env);

  // Auth: GOV_INGEST_TOKEN bearer OR admin JWT
  const authHeader = request.headers.get("authorization") || "";
  let authorized = false;
  if (authHeader.startsWith("Bearer ")) {
    const tok = authHeader.slice(7);
    if (tok && env.GOV_INGEST_TOKEN && tok === env.GOV_INGEST_TOKEN) authorized = true;
    else {
      const a = await verifyAdminToken(request, env);
      if (a.ok) authorized = true;
    }
  }
  if (!authorized) return json({ ok: false, message: "unauthorized" }, 401, request, env);

  const t0 = Date.now();
  const db = env.LEADS_DB;

  // Read top opps that need drafting (fit_score >= threshold, no brief yet)
  const threshold = clamp(parseInt(env.MAYOR_DRAFT_THRESHOLD || "55", 10), 30, 95, 55);
  const perRun = clamp(parseInt(env.MAYOR_DRAFT_PER_RUN || "5", 10), 1, 25, 5);

  const candidates = await db.prepare(`
    SELECT id, title, agency, set_aside, naics_codes_json,
           response_deadline, estimated_value, opportunity_type, summary,
           fit_score, why_fit, why_not_fit, confidence
    FROM gov_opportunities
    WHERE (status IS NULL OR status NOT IN ('archived', 'won', 'lost'))
      AND fit_score >= ?
      AND id NOT IN (SELECT opp_id FROM gov_opportunity_briefs WHERE kind = 'draft')
    ORDER BY fit_score DESC, COALESCE(response_deadline, posted_date) ASC
    LIMIT ?
  `).bind(threshold, perRun).all().catch(() => ({ results: [] }));

  const items = candidates?.results || [];
  if (items.length === 0) {
    return json({
      ok: true,
      message: "no_candidates",
      threshold,
      per_run: perRun,
      drafted: 0,
      duration_ms: Date.now() - t0,
    }, 200, request, env);
  }

  // Draft for each candidate. CF AI calls happen in series (per-call is fast).
  // TODO: parallelize via boundedMap when we confirm Workers supports it for
  // this many concurrent fetch()s per request (CF limit ~6).
  const drafted = [];
  for (const c of items) {
    try {
      const ctx = {
        business_name: c.agency || c.title,
        vertical: c.naics_codes_json ? JSON.parse(c.naics_codes_json).join(",") : "",
        website: "",
        leaks: [],
        fit_score: c.fit_score,
        confidence: c.confidence,
        why_fit: c.why_fit ? c.why_fit.split(" ").slice(0, 5) : [],
      };
      const r = await draftOne(env, ctx, { kind: c.opportunity_type === "sam.gov" ? "proposal" : "cold" });
      if (r.used_llm && r.content) {
        await db.prepare(`
          INSERT OR REPLACE INTO gov_opportunity_briefs (id, opp_id, kind, body, llm_model, llm_provider, latency_ms, neurons, created_at)
          VALUES (?, ?, 'draft', ?, ?, 'cloudflare', ?, ?, datetime('now'))
        `).bind(
          crypto.randomUUID(),
          c.id,
          r.content,
          r.model,
          r.latency_ms || 0,
          r.neurons || 0,
        ).run().catch(() => {});
        drafted.push({ id: c.id, model: r.model, latency_ms: r.latency_ms });
      }
    } catch (e) {
      drafted.push({ id: c.id, error: String(e?.message || e) });
    }
  }

  // Log to mayor_events
  await db.prepare(`
    INSERT INTO mayor_events (id, kind, loop, summary, details_json, created_at)
    VALUES (?, 'draft', 'auto_draft', ?, ?, datetime('now'))
  `).bind(
    crypto.randomUUID(),
    `Auto-drafted ${drafted.filter(d => !d.error).length}/${items.length} SAM opps`,
    JSON.stringify({ drafted, threshold, per_run: perRun }),
  ).run().catch(() => {});

  return json({
    ok: true,
    drafted: drafted.length,
    successful: drafted.filter(d => !d.error).length,
    items: drafted,
    duration_ms: Date.now() - t0,
  }, 200, request, env);
}

function clamp(v, lo, hi, fallback) {
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, v));
}
