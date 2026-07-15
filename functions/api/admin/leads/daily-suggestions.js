// /api/admin/leads/daily-suggestions
//
// GET /api/admin/leads/daily-suggestions?limit=5
//
// AI-curated shortlist of leads to focus on today. Combines:
//   - Urgency (deadline soon for SAM, last_touched_at old for prospects)
//   - Quality (fit_score / leak_score)
//   - Recency (newly added, never reviewed)
//   - Pipeline stage (stale in "drafting", "ready", "queued")
//
// Owner-only. Cached for 1h via LLM cache.
//
// Response: { ok, items: [{ id, kind, title, priority_score, why, suggested_action }], reasoning, used_llm }

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";
import { chatJson } from "../../_shared/llmChat.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 5), 1), 12);

  // Pull the candidate pool: hottest 30 across both kinds
  // SAM.gov: prefer high fit_score + low days-to-deadline
  // (gov_opportunities.status can be NULL or 'new'; NOT IN excludes NULL rows, so use OR clause)
  const samRows = await env.LEADS_DB.prepare(`
    SELECT id, 'sam' AS kind, title, agency AS subtitle, fit_score, stage, response_deadline,
           CAST(julianday(response_deadline) - julianday('now') AS INTEGER) AS days_to_deadline,
           ai_suggestion
    FROM gov_opportunities
    WHERE (status IS NULL OR status NOT IN ('archived','won','lost','inactive'))
    ORDER BY (CASE WHEN fit_score IS NULL THEN 0 ELSE fit_score END) DESC,
             (CASE WHEN response_deadline IS NULL THEN 9999 ELSE julianday(response_deadline) - julianday('now') END) ASC
    LIMIT 30
  `).all().catch(() => ({ results: [] }));

  const prospectRows = await env.LEADS_DB.prepare(`
    SELECT id, 'prospect' AS kind, business_name AS title, root_domain AS subtitle,
           leak_score, stage, last_touched_at, ai_suggestion
    FROM prospects
    WHERE status NOT IN ('archived','won','lost','unsubscribed','bounced')
    ORDER BY (CASE WHEN leak_score IS NULL THEN 0 ELSE leak_score END) DESC,
             (CASE WHEN last_touched_at IS NULL THEN 0 ELSE julianday('now') - julianday(last_touched_at) END) DESC
    LIMIT 30
  `).all().catch(() => ({ results: [] }));

  const candidates = [...(samRows.results || []), ...(prospectRows.results || [])];

  // Debug breadcrumb so we can see counts from CF Pages logs
  console.log(
    "daily-suggestions: samRows=" + (samRows.results?.length || 0) +
    " prospectRows=" + (prospectRows.results?.length || 0) +
    " candidates=" + candidates.length
  );

  if (candidates.length === 0) {
    return json({
      ok: true,
      items: [],
      reasoning: "No active leads.",
      used_llm: false,
      debug: {
        samRows: (samRows.results || []).length,
        prospectRows: (prospectRows.results || []).length,
      },
    }, 200, request, env);
  }

  // Pre-rank heuristically so the LLM only has to pick the top N from a manageable shortlist
  const ranked = candidates.map((c) => {
    let score = 0;
    let reasons = [];
    if (c.kind === "sam") {
      const fit = Number(c.fit_score || 0);
      score += fit;
      if (fit >= 70) reasons.push("high fit score");
      const days = Number(c.days_to_deadline);
      if (Number.isFinite(days)) {
        if (days <= 3) { score += 50; reasons.push(`due in ${days}d`); }
        else if (days <= 14) { score += 30; reasons.push(`due in ${days}d`); }
        else if (days <= 30) { score += 10; reasons.push(`due in ${days}d`); }
      }
    } else {
      const leak = Number(c.leak_score || 0);
      score += leak;
      if (leak >= 70) reasons.push("leaking revenue signals");
      else if (leak >= 50) reasons.push("moderate growth gap");
    }
    if (c.stage === "ready") { score += 15; reasons.push("draft ready to send"); }
    else if (c.stage === "drafting") { score += 10; reasons.push("draft in progress"); }
    else if (c.stage === "evaluating") { score += 5; reasons.push("being evaluated"); }
    return { ...c, heuristic_score: score, heuristic_reasons: reasons };
  }).sort((a, b) => b.heuristic_score - a.heuristic_score).slice(0, 10);

  // Try LLM for final ranking + reasoning (uses 1 query; cached 1h in-memory)
  let chosen = ranked.slice(0, limit);
  let reasoning = "Heuristic ranking only (LLM unavailable).";
  let used_llm = false;

  try {
    const llm = await chatJson({
      env,
      messages: [
        {
          role: "system",
          content: `You are a sales/BD advisor for a one-person software/cloud/AI consultancy (MehyarSoft, run by Mehyar Swelim).
The user wants a shortlist of ${limit} leads to work on TODAY. Pick the highest-ROI picks from the candidate list and explain why each should be prioritized right now.

Output ONLY valid JSON: {"chosen_indices": [array of integer indices 0..N-1 into the candidate list, top ${limit}], "reasoning": "1-2 sentence overall narrative"}`,
        },
        {
          role: "user",
          content: `Candidates (JSON):\n${JSON.stringify(ranked.map((c, i) => ({
            i,
            kind: c.kind,
            title: c.title,
            subtitle: c.subtitle,
            stage: c.stage,
            heuristic_score: c.heuristic_score,
            heuristic_reasons: c.heuristic_reasons,
            deadline: c.days_to_deadline != null ? `D-${c.days_to_deadline}` : null,
            fit: c.fit_score,
            leak: c.leak_score,
            ai_suggestion: c.ai_suggestion,
          })), null, 2)}`,
        },
      ],
      max_tokens: 700,
      temperature: 0.3,
      json_mode: true,
    });

    if (llm.used_llm && llm.content) {
      try {
        const parsed = JSON.parse(llm.content);
        const idxs = Array.isArray(parsed.chosen_indices) ? parsed.chosen_indices : [];
        const reMapped = idxs.slice(0, limit).map((i) => ranked[i]).filter(Boolean);
        if (reMapped.length) {
          chosen = reMapped;
          reasoning = parsed.reasoning || reasoning;
          used_llm = true;
        }
      } catch {}
    }
  } catch {}

  const items = chosen.map((c, i) => ({
    id: c.id,
    kind: c.kind,
    title: c.title,
    subtitle: c.subtitle,
    stage: c.stage,
    priority_score: Math.round(c.heuristic_score),
    why: c.heuristic_reasons.join(" · ") || (c.ai_suggestion || "").slice(0, 120),
    suggested_action:
      c.kind === "sam" && Number(c.days_to_deadline) <= 14
        ? "Open drawer → Review requirements → Deep-evaluate → Generate draft"
        : c.kind === "sam"
          ? "Open → Deep-evaluate → Generate draft"
          : c.stage === "ready"
            ? "Open → Review draft → Approve & queue"
            : "Open → Deep-evaluate → Pick a tier → Generate draft",
  }));

  return json({ ok: true, items, reasoning, used_llm }, 200, request, env);
}
