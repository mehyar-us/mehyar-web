// POST /api/admin/prospects/<id>/deep-analyze
//
// Full AI-powered analysis of a prospect business. Goes deeper than the existing
// /deep-evaluate — it produces:
//   1. Business intelligence: what they do, target market, tech stack signals
//   2. Pain-point detection: based on detected_platform, leak_signals, content
//   3. Concrete fix proposals: each tied to a deliverable, hours estimate, price
//   4. Execution plan: ordered weeks/phases with milestones
//   5. Pricing matrix: 3 tiers (Starter / Growth / Premium) priced for MehyarSoft's
//      2026 c2c (consultant-to-client) market rate
//   6. Risk flags + decision (bid / pass / ask for intro)
//   7. Outreach angle: 1-paragraph hook for cold email
//
// The response is a structured JSON document. The UI renders it nicely,
// and the user can refine each section conversationally via DeepEvalChat
// (which then saves the merged eval as a new deep_analyze event).
//
// Pricing model — 2026 MehyarSoft c2c rates (Brooklyn, NY small software agency):
//   - Junior engineer (1-3y):  $135/hr   (~$108k/yr loaded)
//   - Senior engineer (5-10y): $210/hr   (~$168k/yr loaded)
//   - Principal engineer:      $280/hr   (~$224k/yr loaded)
//   - Designer (UI/UX):        $150/hr
//   - PM/Strategist:           $145/hr
//   - Average blended rate:    ~$175/hr
//
// Tier rules (binding):
//   - Starter:  $3,500–$8,000 one-time + $150–$300/mo    (≤ ~40 hrs)
//   - Growth:   $8,000–$22,000 one-time + $600–$1,400/mo (80–120 hrs)
//   - Premium:  $28,000–$80,000 one-time + $1,800–$5,500/mo (180–400 hrs)
//
// Owner-only.

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";
import { chatJson } from "../../_shared/llmChat.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const id = params.id;
  if (!id) return json({ ok: false, error: "missing_id" }, 400, request, env);

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const force = body?.force === true;

  // Load prospect + last signals + last deep_evaluate (so we can build on it)
  let ctx;
  try {
    ctx = await loadProspectContext(env, id);
  } catch (e) {
    return json({ ok: false, error: "load_failed", details: String(e?.message || e) }, 500, request, env);
  }
  if (!ctx) return json({ ok: false, error: "prospect_not_found" }, 404, request, env);

  // Cache check
  if (!force) {
    try {
      const cached = await env.LEADS_DB.prepare(`
        SELECT payload_json, created_at FROM opportunity_events
        WHERE prospect_id = ? AND event_type = 'deep_analyze'
        ORDER BY created_at DESC LIMIT 1
      `).bind(id).first();
      if (cached && Date.now() - new Date(cached.created_at).getTime() < 12 * 3600 * 1000) {
        const parsed = safeJson(cached.payload_json, null);
        if (parsed) return json({ ok: true, analysis: parsed, cached: true, cached_at: cached.created_at }, 200, request, env);
      }
    } catch {}
  }

  // Build prompt
  const sysPrompt = buildSystemPrompt();
  const usrMsg = buildUserPrompt(ctx);

  let llmResp;
  try {
    llmResp = await chatJson({ env, messages: [
      { role: "system", content: sysPrompt },
      { role: "user", content: usrMsg },
    ], max_tokens: 4000, temperature: 0.4 });
  } catch (e) {
    return json({ ok: false, error: "llm_call_failed", details: String(e?.message || e) }, 500, request, env);
  }
  if (!llmResp?.ok) {
    return json({ ok: false, error: "llm_unavailable", details: llmResp?.error || "no_response" }, 502, request, env);
  }

  // Parse + sanitize
  let analysis;
  try {
    analysis = typeof llmResp.json === "object" ? llmResp.json : JSON.parse(llmResp.text || "{}");
  } catch {
    return json({ ok: false, error: "llm_parse_failed", raw: llmResp.text?.slice(0, 500) }, 502, request, env);
  }
  analysis = sanitizeAnalysis(analysis, ctx);

  // Persist
  const now = new Date().toISOString();
  try {
    await env.LEADS_DB.prepare(`
      INSERT INTO opportunity_events (id, kind, prospect_id, event_type, payload_json, actor, created_at)
      VALUES (?, 'prospect', ?, 'deep_analyze', ?, 'owner', ?)
    `).bind(crypto.randomUUID(), id, JSON.stringify(analysis).slice(0, 24000), now).run();
  } catch (e) {
    // Non-fatal — still return the analysis
    // eslint-disable-next-line no-console
    console.error("[deep-analyze] persist failed:", e);
  }

  return json({
    ok: true,
    analysis,
    used_llm: true,
    model: llmResp.model || null,
    usage: llmResp.usage || null,
  }, 200, request, env);
}

// ─── PUT /chat-apply — persist a user-refined version ──────────────────────

export async function onRequestPut({ request, env, params }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const id = params.id;
  if (!id) return json({ ok: false, error: "missing_id" }, 400, request, env);

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const analysis = body?.analysis;
  if (!analysis || typeof analysis !== "object") return json({ ok: false, error: "analysis_required" }, 400, request, env);

  const sanitized = sanitizeAnalysis(analysis);
  const now = new Date().toISOString();
  try {
    await env.LEADS_DB.prepare(`
      INSERT INTO opportunity_events (id, kind, prospect_id, event_type, payload_json, actor, created_at)
      VALUES (?, 'prospect', ?, 'deep_analyze', ?, 'owner', ?)
    `).bind(crypto.randomUUID(), id, JSON.stringify({ ...sanitized, _refined: true, _refined_at: now }).slice(0, 24000), now).run();
  } catch (e) {
    return json({ ok: false, error: "persist_failed", details: String(e?.message || e) }, 500, request, env);
  }
  return json({ ok: true, analysis: { ...sanitized, _refined: true, _refined_at: now } }, 200, request, env);
}

// ─── helpers ───────────────────────────────────────────────────────────────

async function loadProspectContext(env, id) {
  const p = await env.LEADS_DB.prepare(`
    SELECT id, business_name, root_domain, website, email, phone, vertical, city, country,
           status, stage, source, source_ref, meta_json, last_scanned_at,
           created_at, updated_at
    FROM prospects WHERE id = ? LIMIT 1
  `).bind(id).first().catch(() => null);
  if (!p) return null;

  const sig = await env.LEADS_DB.prepare(`
    SELECT has_ssl, has_booking_cta, has_phone_click_to_call, has_form_action, has_email_link,
           has_address, page_weight_kb, load_time_ms, detected_platform, detected_cms_hints,
           leak_signals_json, leak_score, title, status_code, scanned_at
    FROM prospect_signals WHERE prospect_id = ? ORDER BY scanned_at DESC LIMIT 1
  `).bind(id).first().catch(() => null);

  const lastEval = await env.LEADS_DB.prepare(`
    SELECT payload_json, created_at FROM opportunity_events
    WHERE prospect_id = ? AND event_type = 'deep_evaluate'
    ORDER BY created_at DESC LIMIT 1
  `).bind(id).first().catch(() => null);

  return {
    prospect: {
      ...p,
      meta: safeJson(p.meta_json, {}),
    },
    signals: sig ? {
      ...sig,
      leak_signals: safeJson(sig.leak_signals_json, []),
      detected_cms_hints: safeJson(sig.detected_cms_hints, []),
    } : null,
    last_evaluate: lastEval ? safeJson(lastEval.payload_json, null) : null,
  };
}

function buildSystemPrompt() {
  return `You are a senior solutions engineer at MehyarSoft LLC, a Brooklyn NY small software agency. You produce detailed business intelligence + concrete project proposals for prospective B2B clients.

Today's date: ${new Date().toISOString().slice(0, 10)}

PRICING MODEL — 2026 MehyarSoft c2c (consultant-to-client) market rate, Brooklyn NY:
- Junior engineer (1-3y):  $135/hr   (~$108k/yr loaded)
- Senior engineer (5-10y): $210/hr   (~$168k/yr loaded)
- Principal engineer:      $280/hr   (~$224k/yr loaded)
- Designer (UI/UX):        $150/hr
- PM/Strategist:           $145/hr
- Average blended rate:    ~$175/hr

TIER RULES (binding — must respect these price ranges):
- Starter:  $3,500–$8,000 one-time + $150–$300/mo    (≤ ~40 hrs)
- Growth:   $8,000–$22,000 one-time + $600–$1,400/mo (80–120 hrs)
- Premium:  $28,000–$80,000 one-time + $1,800–$5,500/mo (180–400 hrs)

You MUST return STRICT JSON only — no markdown fences — matching this exact shape:
{
  "verdict": "🟢 strong fit" | "🟡 evaluate further" | "🔴 not a fit",
  "fit_score": integer 0-100,
  "confidence": "high" | "medium" | "low",
  "business_intelligence": {
    "what_they_do": string ≤ 240,
    "target_market": string ≤ 200,
    "likely_revenue_band": string ≤ 120,         // e.g. "$500k–$2M"
    "likely_team_size": string ≤ 80,              // e.g. "2–5 people"
    "tech_stack_signals": [string ≤ 80],          // inferred from detected_platform, has_ssl, etc.
    "business_model_signals": [string ≤ 120]
  },
  "pain_points": [
    {
      "title": string ≤ 100,
      "severity": "critical" | "high" | "medium" | "low",
      "evidence": string ≤ 200,                  // what signals prove this
      "fix_summary": string ≤ 200,
      "estimated_hours": number
    }
    // 3-6 pain points
  ],
  "proposed_services": [
    {
      "name": string ≤ 80,
      "icon": emoji,
      "description": string ≤ 280,
      "deliverables": [string ≤ 100],            // 3-6 concrete outputs
      "estimated_hours": number,
      "blended_hourly_rate": number              // 135-280 USD/hr, justify below
    }
    // exactly 3 services
  ],
  "pricing_tiers": [
    {
      "tier": "Starter" | "Growth" | "Premium",
      "rationale": string ≤ 200,                 // why this tier suits them
      "scope": [string ≤ 100],                   // 4-8 items
      "one_time_min": integer USD,
      "one_time_max": integer USD,
      "monthly_min": integer USD,
      "monthly_max": integer USD,
      "estimated_total_hours": number,
      "estimated_completion_weeks": integer
    }
    // exactly 3 tiers
  ],
  "execution_plan": [
    {
      "week": integer (1-N),
      "phase": string ≤ 80,                      // e.g. "Discovery", "Build", "Launch", "Retainer"
      "milestones": [string ≤ 120],              // 2-4 per week
      "estimated_hours": number
    }
    // 4-12 weeks
  ],
  "risk_flags": [
    { "risk": string ≤ 120, "severity": "high" | "medium" | "low", "mitigation": string ≤ 160 }
    // 0-5 risks
  ],
  "outreach_angle": {
    "subject_line": string ≤ 80,
    "hook": string ≤ 280,                        // first paragraph, pain-point led
    "call_to_action": string ≤ 140              // e.g. "15-min audit of your booking flow this week?"
  },
  "next_action": string ≤ 200,
  "reasoning_summary": string ≤ 600             // 3-5 sentences: why this fit/pricing/approach
}

CRITICAL PRICING RULES:
- All numeric prices (one_time_*, monthly_*) MUST be inside the tier ranges above. No exceptions.
- Estimated hours × blended rate must roughly equal the one_time price.
- If you can't justify the price within the range, lower the scope or move down a tier.
- Default to Growth tier as the recommendation unless signals clearly suggest Starter or Premium.

CRITICAL OUTPUT RULES:
- JSON only. No markdown. No prose before/after.
- Keep all string lengths within the stated limits.
- Use concrete, specific deliverables ("Click-to-call button on mobile hero" not "improve UX").
- Outreach hook must reference something real about the prospect — not generic.`;
}

function buildUserPrompt(ctx) {
  return [
    "## Prospect",
    JSON.stringify({
      business_name: ctx.prospect.business_name,
      root_domain: ctx.prospect.root_domain,
      website: ctx.prospect.website,
      vertical: ctx.prospect.vertical,
      city: ctx.prospect.city,
      country: ctx.prospect.country,
      email: ctx.prospect.email,
      phone: ctx.prospect.phone,
      source: ctx.prospect.source,
      source_ref: ctx.prospect.source_ref,
      meta: ctx.prospect.meta,
    }, null, 2).slice(0, 6000),
    "",
    "## Scan signals (from most recent site crawl)",
    JSON.stringify(ctx.signals, null, 2).slice(0, 4000) || "(no scan yet — note that and reduce confidence accordingly)",
    "",
    "## Previous deep-evaluate (if any)",
    JSON.stringify(ctx.last_evaluate, null, 2).slice(0, 4000) || "(none — produce a fresh analysis)",
    "",
    "Produce the full analysis JSON.",
  ].join("\n");
}

function sanitizeAnalysis(a, ctx) {
  if (!a || typeof a !== "object") a = {};
  a.verdict = String(a.verdict || "🟡 evaluate further").slice(0, 80);
  a.fit_score = clamp(Number(a.fit_score || 0), 0, 100);
  a.confidence = ["high","medium","low"].includes(a.confidence) ? a.confidence : "medium";
  a.business_intelligence = a.business_intelligence || {};
  a.business_intelligence.what_they_do = String(a.business_intelligence.what_they_do || "").slice(0, 240);
  a.business_intelligence.target_market = String(a.business_intelligence.target_market || "").slice(0, 200);
  a.business_intelligence.likely_revenue_band = String(a.business_intelligence.likely_revenue_band || "").slice(0, 120);
  a.business_intelligence.likely_team_size = String(a.business_intelligence.likely_team_size || "").slice(0, 80);
  a.business_intelligence.tech_stack_signals = Array.isArray(a.business_intelligence.tech_stack_signals)
    ? a.business_intelligence.tech_stack_signals.slice(0, 8).map(String) : [];
  a.business_intelligence.business_model_signals = Array.isArray(a.business_intelligence.business_model_signals)
    ? a.business_intelligence.business_model_signals.slice(0, 6).map(String) : [];

  // Pain points (3-6)
  a.pain_points = (Array.isArray(a.pain_points) ? a.pain_points : [])
    .slice(0, 6)
    .map((p) => ({
      title: String(p.title || "").slice(0, 100),
      severity: ["critical","high","medium","low"].includes(p.severity) ? p.severity : "medium",
      evidence: String(p.evidence || "").slice(0, 200),
      fix_summary: String(p.fix_summary || "").slice(0, 200),
      estimated_hours: clamp(Math.round(Number(p.estimated_hours) || 0), 1, 200),
    }));

  // Proposed services (exactly 3)
  a.proposed_services = (Array.isArray(a.proposed_services) ? a.proposed_services : [])
    .slice(0, 3)
    .map((s) => ({
      name: String(s.name || "").slice(0, 80),
      icon: String(s.icon || "🛠").slice(0, 4),
      description: String(s.description || "").slice(0, 280),
      deliverables: (Array.isArray(s.deliverables) ? s.deliverables : []).slice(0, 6).map((d) => String(d).slice(0, 100)),
      estimated_hours: clamp(Math.round(Number(s.estimated_hours) || 0), 1, 400),
      blended_hourly_rate: clamp(Math.round(Number(s.blended_hourly_rate) || 175), 100, 400),
    }));
  while (a.proposed_services.length < 3) {
    a.proposed_services.push({
      name: "Custom deliverable", icon: "🛠", description: "",
      deliverables: [], estimated_hours: 8, blended_hourly_rate: 175,
    });
  }

  // Pricing tiers (exactly 3) — clamp to ranges
  const TIER_RANGES = {
    Starter: { ot: [3500, 8000], mo: [150, 300], hrs: [10, 40] },
    Growth:  { ot: [8000, 22000], mo: [600, 1400], hrs: [80, 120] },
    Premium: { ot: [28000, 80000], mo: [1800, 5500], hrs: [180, 400] },
  };
  a.pricing_tiers = (Array.isArray(a.pricing_tiers) ? a.pricing_tiers : [])
    .slice(0, 3)
    .map((t, i) => {
      const tierName = ["Starter","Growth","Premium"][i] || String(t.tier || "Growth").replace(/[^A-Za-z]/g,"").slice(0, 10) || "Growth";
      const range = TIER_RANGES[tierName] || TIER_RANGES.Growth;
      const ot_min = clamp(Math.round(Number(t.one_time_min) || range.ot[0]), range.ot[0], range.ot[1]);
      const ot_max = clamp(Math.round(Number(t.one_time_max) || range.ot[1]), range.ot[0], range.ot[1]);
      const mo_min = clamp(Math.round(Number(t.monthly_min) || range.mo[0]), range.mo[0], range.mo[1]);
      const mo_max = clamp(Math.round(Number(t.monthly_max) || range.mo[1]), range.mo[0], range.mo[1]);
      const hours = clamp(Math.round(Number(t.estimated_total_hours) || range.hrs[0]), range.hrs[0], range.hrs[1]);
      return {
        tier: tierName,
        rationale: String(t.rationale || "").slice(0, 200),
        scope: (Array.isArray(t.scope) ? t.scope : []).slice(0, 8).map((s) => String(s).slice(0, 100)),
        one_time_min: Math.min(ot_min, ot_max),
        one_time_max: Math.max(ot_min, ot_max),
        monthly_min: Math.min(mo_min, mo_max),
        monthly_max: Math.max(mo_min, mo_max),
        estimated_total_hours: hours,
        estimated_completion_weeks: clamp(Math.round(Number(t.estimated_completion_weeks) || 4), 1, 24),
      };
    });
  while (a.pricing_tiers.length < 3) {
    const t = ["Starter","Growth","Premium"][a.pricing_tiers.length];
    const range = TIER_RANGES[t];
    a.pricing_tiers.push({
      tier: t, rationale: "", scope: [],
      one_time_min: range.ot[0], one_time_max: range.ot[1],
      monthly_min: range.mo[0], monthly_max: range.mo[1],
      estimated_total_hours: range.hrs[0], estimated_completion_weeks: 4,
    });
  }

  // Execution plan (4-12 weeks)
  a.execution_plan = (Array.isArray(a.execution_plan) ? a.execution_plan : [])
    .slice(0, 12)
    .map((p) => ({
      week: clamp(Math.round(Number(p.week) || 1), 1, 24),
      phase: String(p.phase || "").slice(0, 80),
      milestones: (Array.isArray(p.milestones) ? p.milestones : []).slice(0, 4).map(String),
      estimated_hours: clamp(Math.round(Number(p.estimated_hours) || 0), 1, 80),
    }));

  // Risk flags (0-5)
  a.risk_flags = (Array.isArray(a.risk_flags) ? a.risk_flags : [])
    .slice(0, 5)
    .map((r) => ({
      risk: String(r.risk || "").slice(0, 120),
      severity: ["high","medium","low"].includes(r.severity) ? r.severity : "medium",
      mitigation: String(r.mitigation || "").slice(0, 160),
    }));

  // Outreach angle
  a.outreach_angle = a.outreach_angle || {};
  a.outreach_angle.subject_line = String(a.outreach_angle.subject_line || "").slice(0, 80);
  a.outreach_angle.hook = String(a.outreach_angle.hook || "").slice(0, 280);
  a.outreach_angle.call_to_action = String(a.outreach_angle.call_to_action || "").slice(0, 140);

  a.next_action = String(a.next_action || "").slice(0, 200);
  a.reasoning_summary = String(a.reasoning_summary || "").slice(0, 600);

  a._generated_at = new Date().toISOString();
  if (ctx?.prospect) a._prospect_id = ctx.prospect.id;
  return a;
}

function clamp(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function safeJson(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}