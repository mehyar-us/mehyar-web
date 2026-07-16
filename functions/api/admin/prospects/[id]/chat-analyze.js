// POST /api/admin/prospects/<id>/chat-analyze
//
// Conversational refinement of a saved deep_analyze document. Like chat-eval,
// but works on the full analysis (pain_points, proposed_services, pricing_tiers,
// execution_plan, risk_flags, outreach_angle) — not just services/tiers.
//
// Each user message returns:
//   - reply: conversational answer
//   - patch: optional structured change (add/remove/edit any field)
//   - new_analysis_preview: the merged analysis if you applied the patch
//
// Patches supported:
//   - set.verdict / set.fit_score / set.confidence
//   - set.next_action / set.reasoning_summary
//   - add_pain_points / remove_pain_points (by title)
//   - add_services / remove_services (by name)
//   - edit_services (by name)
//   - add_tiers / remove_tiers (by tier name) / edit_tiers
//   - add_plan_weeks / remove_plan_weeks / edit_plan_weeks
//   - add_risks / remove_risks / edit_risks
//   - set_outreach_subject / set_outreach_hook / set_outreach_cta
//
// Pricing tier edits are clamped to the MehyarSoft 2026 c2c ranges.
// Owner-only.

import { verifyAdminToken, json, corsHeaders } from "../../../_shared/adminAuth.js";
import { chatJson } from "../../../_shared/llmChat.js";

const MAX_MESSAGE_LEN = 4000;
const MAX_HISTORY_TURNS = 16;
const TIER_RANGES = {
  Starter: { ot: [3500, 8000], mo: [150, 300], hrs: [10, 40] },
  Growth:  { ot: [8000, 22000], mo: [600, 1400], hrs: [80, 120] },
  Premium: { ot: [28000, 80000], mo: [1800, 5500], hrs: [180, 400] },
};

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const id = params.id;
  if (!id) return json({ ok: false, error: "missing_id" }, 400, request, env);

  let body;
  try { body = await request.json(); } catch { body = {}; }

  const message = String(body?.message || "").trim();
  if (!message) return json({ ok: false, error: "message_required" }, 400, request, env);
  if (message.length > MAX_MESSAGE_LEN) return json({ ok: false, error: "message_too_long" }, 400, request, env);

  // Load latest analysis (or accept from client)
  let analysis = body?.current_analysis;
  if (!analysis || typeof analysis !== "object") {
    try {
      const row = await env.LEADS_DB.prepare(`
        SELECT payload_json FROM opportunity_events
        WHERE prospect_id = ? AND event_type = 'deep_analyze'
        ORDER BY created_at DESC LIMIT 1
      `).bind(id).first().catch(() => null);
      if (row?.payload_json) analysis = safeJson(row.payload_json, null);
    } catch {}
  }
  if (!analysis) return json({ ok: false, error: "no_analysis_to_chat_about" }, 400, request, env);

  // Load history for multi-turn context
  let history = [];
  try {
    const rows = await env.LEADS_DB.prepare(`
      SELECT payload_json FROM opportunity_events
      WHERE prospect_id = ? AND event_type = 'analyze_chat'
      ORDER BY created_at DESC LIMIT ?
    `).bind(id, MAX_HISTORY_TURNS).all();
    history = (rows?.results || []).reverse().map((r) => safeJson(r.payload_json, {})).filter(Boolean);
  } catch {}

  const sysPrompt = buildSystemPrompt();
  const usrMsg = [
    "## Current saved analysis",
    JSON.stringify(analysis, null, 2).slice(0, 14000),
    "",
    "## New user message",
    message,
    "",
    "Return strict JSON matching the schema in your system prompt.",
  ].join("\n");

  const messages = [
    { role: "system", content: sysPrompt },
    ...history.map((t) => ({ role: t.role, content: String(t.content || "").slice(0, 4000) })),
    { role: "user", content: usrMsg },
  ];

  let llmResp;
  try {
    llmResp = await chatJson({ env, messages, max_tokens: 2200, temperature: 0.4 });
  } catch (e) {
    return json({ ok: false, error: "llm_call_failed", details: String(e?.message || e) }, 500, request, env);
  }
  if (!llmResp?.ok) {
    return json({ ok: false, error: "llm_unavailable", details: llmResp?.error || "no_response" }, 502, request, env);
  }

  let parsed;
  try {
    parsed = typeof llmResp.json === "object" ? llmResp.json : JSON.parse(llmResp.text || "{}");
  } catch {
    parsed = { reply: llmResp.text || "(empty)", patch: null };
  }
  const reply = String(parsed.reply || "").trim();
  let patch = parsed.patch || null;

  let new_analysis_preview = null;
  if (patch) {
    try {
      patch = sanitizePatch(patch);
      new_analysis_preview = applyPatch(analysis, patch);
    } catch (e) {
      return json({ ok: false, error: "patch_failed", details: String(e?.message || e) }, 500, request, env);
    }
  }

  // Persist both turns (user + assistant) for next-turn context
  const now = new Date().toISOString();
  try {
    await env.LEADS_DB.prepare(`
      INSERT INTO opportunity_events (id, kind, prospect_id, event_type, payload_json, actor, created_at)
      VALUES (?, 'prospect', ?, 'analyze_chat', ?, 'owner', ?)
    `).bind(crypto.randomUUID(), id, JSON.stringify({ role: "user", content: message }), now).run();
    await env.LEADS_DB.prepare(`
      INSERT INTO opportunity_events (id, kind, prospect_id, event_type, payload_json, actor, created_at)
      VALUES (?, 'prospect', ?, 'analyze_chat', ?, 'owner', ?)
    `).bind(crypto.randomUUID(), id, JSON.stringify({
      role: "assistant", content: reply, patch: patch || null, model: llmResp.model || null,
    }), now).run();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[chat-analyze] persist failed:", e);
  }

  return json({
    ok: true,
    reply,
    patch: patch || null,
    new_analysis_preview,
    model: llmResp.model || null,
    used_llm: true,
  }, 200, request, env);
}

// ─── PUT /chat-analyze/apply — persist the merged analysis ──────────────────

export async function onRequestPut({ request, env, params }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const id = params.id;
  if (!id) return json({ ok: false, error: "missing_id" }, 400, request, env);

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const newAnalysis = body?.new_analysis;
  const reason = String(body?.reason || "Chat refinement").slice(0, 240);
  if (!newAnalysis || typeof newAnalysis !== "object") return json({ ok: false, error: "new_analysis_required" }, 400, request, env);

  const now = new Date().toISOString();
  try {
    await env.LEADS_DB.prepare(`
      INSERT INTO opportunity_events (id, kind, prospect_id, event_type, payload_json, actor, created_at)
      VALUES (?, 'prospect', ?, 'deep_analyze', ?, 'owner', ?)
    `).bind(crypto.randomUUID(), id, JSON.stringify({ ...newAnalysis, _applied_reason: reason, _applied_at: now }).slice(0, 24000), now).run();
  } catch (e) {
    return json({ ok: false, error: "persist_failed", details: String(e?.message || e) }, 500, request, env);
  }
  return json({ ok: true, saved_at: now }, 200, request, env);
}

// ─── helpers ───────────────────────────────────────────────────────────────

function buildSystemPrompt() {
  return `You are a senior solutions engineer at MehyarSoft LLC (Brooklyn NY small software agency). You are chatting with the founder about a saved analysis of a prospective client. Your job:

1. Answer the user's question/comment in plain English.
2. If the user asks you to CHANGE the analysis, propose a structured JSON patch the UI will preview and offer to apply.

Return STRICT JSON only (no markdown) matching this exact shape:
{
  "reply": string ≤ 1200 chars,
  "patch": null | {
    "reason": string ≤ 240 chars,
    "set": {
      "verdict"?: "🟢 strong fit" | "🟡 evaluate further" | "🔴 not a fit",
      "fit_score"?: integer 0-100,
      "confidence"?: "high" | "medium" | "low",
      "next_action"?: string,
      "reasoning_summary"?: string
    },
    "add_pain_points"?: [ { title, severity, evidence, fix_summary, estimated_hours } ],
    "remove_pain_points"?: [ string ],     // match by title (case-insensitive)
    "add_services"?: [ { name, icon, description, deliverables, estimated_hours, blended_hourly_rate } ],
    "remove_services"?: [ string ],
    "edit_services"?: [ { match_name, name?, description?, deliverables?, estimated_hours?, blended_hourly_rate? } ],
    "add_tiers"?: [ { tier, rationale, scope, one_time_min, one_time_max, monthly_min, monthly_max, estimated_total_hours, estimated_completion_weeks } ],
    "remove_tiers"?: [ string ],
    "edit_tiers"?: [ { match_tier, rationale?, scope?, one_time_min?, one_time_max?, monthly_min?, monthly_max?, estimated_total_hours?, estimated_completion_weeks? } ],
    "add_plan_weeks"?: [ { week, phase, milestones, estimated_hours } ],
    "remove_plan_weeks"?: [ integer ],      // match by week number
    "edit_plan_weeks"?: [ { match_week, phase?, milestones?, estimated_hours? } ],
    "add_risks"?: [ { risk, severity, mitigation } ],
    "remove_risks"?: [ string ],            // match by risk text
    "edit_risks"?: [ { match_risk, severity?, mitigation? } ],
    "set_outreach"?: { subject_line?, hook?, call_to_action? }
  }
}

PRICING CONSTRAINTS (binding — server enforces on apply):
- Starter: one_time $3,500–$8,000 + monthly $150–$300, 10–40 hrs
- Growth:  one_time $8,000–$22,000 + monthly $600–$1,400, 80–120 hrs
- Premium: one_time $28,000–$80,000 + monthly $1,800–$5,500, 180–400 hrs

If the user asks for prices outside these ranges, explain in \`reply\` why you're proposing a different tier or scope instead.

RULES:
- Keep the patch minimal — change only what the user asked for.
- If user asks a question (not a change), set patch: null.
- If you disagree with a change, still return patch: null and explain in reply.`;
}

function sanitizePatch(p) {
  if (!p || typeof p !== "object") return null;
  const out = { reason: clampStr(p.reason, 240) || "LLM-suggested change" };

  if (p.set && typeof p.set === "object") {
    const set = {};
    if (p.set.verdict != null) set.verdict = clampStr(p.set.verdict, 80);
    if (p.set.fit_score != null) {
      const n = Number(p.set.fit_score);
      if (Number.isFinite(n)) set.fit_score = clamp(Math.round(n), 0, 100);
    }
    if (p.set.confidence != null) set.confidence = ["high","medium","low"].includes(p.set.confidence) ? p.set.confidence : "medium";
    if (p.set.next_action != null) set.next_action = clampStr(p.set.next_action, 200);
    if (p.set.reasoning_summary != null) set.reasoning_summary = clampStr(p.set.reasoning_summary, 600);
    if (Object.keys(set).length) out.set = set;
  }

  if (Array.isArray(p.add_pain_points)) out.add_pain_points = p.add_pain_points.slice(0, 5).map(sanitizePainPoint);
  if (Array.isArray(p.remove_pain_points)) out.remove_pain_points = p.remove_pain_points.slice(0, 6).map((s) => clampStr(s, 100));
  if (Array.isArray(p.add_services)) out.add_services = p.add_services.slice(0, 4).map(sanitizeService);
  if (Array.isArray(p.remove_services)) out.remove_services = p.remove_services.slice(0, 6).map((s) => clampStr(s, 80));
  if (Array.isArray(p.edit_services)) out.edit_services = p.edit_services.slice(0, 6).map(sanitizeEditService);
  if (Array.isArray(p.add_tiers)) out.add_tiers = p.add_tiers.slice(0, 3).map((t) => sanitizeTier(t, /* clampToRange= */ true));
  if (Array.isArray(p.remove_tiers)) out.remove_tiers = p.remove_tiers.slice(0, 3).map((s) => clampStr(s, 40));
  if (Array.isArray(p.edit_tiers)) out.edit_tiers = p.edit_tiers.slice(0, 3).map(sanitizeEditTier);
  if (Array.isArray(p.add_plan_weeks)) out.add_plan_weeks = p.add_plan_weeks.slice(0, 6).map(sanitizePlanWeek);
  if (Array.isArray(p.remove_plan_weeks)) out.remove_plan_weeks = p.remove_plan_weeks.slice(0, 6).map((n) => clamp(Math.round(Number(n) || 0), 1, 24));
  if (Array.isArray(p.edit_plan_weeks)) out.edit_plan_weeks = p.edit_plan_weeks.slice(0, 6).map(sanitizeEditPlanWeek);
  if (Array.isArray(p.add_risks)) out.add_risks = p.add_risks.slice(0, 4).map(sanitizeRisk);
  if (Array.isArray(p.remove_risks)) out.remove_risks = p.remove_risks.slice(0, 4).map((s) => clampStr(s, 120));
  if (Array.isArray(p.edit_risks)) out.edit_risks = p.edit_risks.slice(0, 4).map(sanitizeEditRisk);
  if (p.set_outreach && typeof p.set_outreach === "object") {
    const o = {};
    if (p.set_outreach.subject_line != null) o.subject_line = clampStr(p.set_outreach.subject_line, 80);
    if (p.set_outreach.hook != null) o.hook = clampStr(p.set_outreach.hook, 280);
    if (p.set_outreach.call_to_action != null) o.call_to_action = clampStr(p.set_outreach.call_to_action, 140);
    if (Object.keys(o).length) out.set_outreach = o;
  }
  return out;
}

function sanitizePainPoint(p) {
  return {
    title: clampStr(p.title, 100),
    severity: ["critical","high","medium","low"].includes(p.severity) ? p.severity : "medium",
    evidence: clampStr(p.evidence, 200),
    fix_summary: clampStr(p.fix_summary, 200),
    estimated_hours: clamp(Math.round(Number(p.estimated_hours) || 0), 1, 200),
  };
}
function sanitizeService(s) {
  return {
    name: clampStr(s.name, 80),
    icon: clampStr(s.icon || "🛠", 4),
    description: clampStr(s.description, 280),
    deliverables: Array.isArray(s.deliverables) ? s.deliverables.slice(0, 6).map((d) => clampStr(d, 100)) : [],
    estimated_hours: clamp(Math.round(Number(s.estimated_hours) || 0), 1, 400),
    blended_hourly_rate: clamp(Math.round(Number(s.blended_hourly_rate) || 175), 100, 400),
  };
}
function sanitizeEditService(s) {
  const out = { match_name: clampStr(s.match_name, 80) };
  if (s.name != null) out.name = clampStr(s.name, 80);
  if (s.description != null) out.description = clampStr(s.description, 280);
  if (Array.isArray(s.deliverables)) out.deliverables = s.deliverables.slice(0, 6).map((d) => clampStr(d, 100));
  if (s.estimated_hours != null) out.estimated_hours = clamp(Math.round(Number(s.estimated_hours) || 0), 1, 400);
  if (s.blended_hourly_rate != null) out.blended_hourly_rate = clamp(Math.round(Number(s.blended_hourly_rate) || 175), 100, 400);
  return out;
}
function sanitizeTier(t, clampToRange) {
  const tierName = ["Starter","Growth","Premium"].includes(t.tier) ? t.tier : "Growth";
  const range = TIER_RANGES[tierName];
  let ot_min = Math.round(Number(t.one_time_min) || range.ot[0]);
  let ot_max = Math.round(Number(t.one_time_max) || range.ot[1]);
  let mo_min = Math.round(Number(t.monthly_min) || range.mo[0]);
  let mo_max = Math.round(Number(t.monthly_max) || range.mo[1]);
  let hours = Math.round(Number(t.estimated_total_hours) || range.hrs[0]);
  if (clampToRange) {
    ot_min = clamp(ot_min, range.ot[0], range.ot[1]);
    ot_max = clamp(ot_max, range.ot[0], range.ot[1]);
    mo_min = clamp(mo_min, range.mo[0], range.mo[1]);
    mo_max = clamp(mo_max, range.mo[0], range.mo[1]);
    hours = clamp(hours, range.hrs[0], range.hrs[1]);
  }
  return {
    tier: tierName,
    rationale: clampStr(t.rationale, 200),
    scope: Array.isArray(t.scope) ? t.scope.slice(0, 8).map((s) => clampStr(s, 100)) : [],
    one_time_min: Math.min(ot_min, ot_max),
    one_time_max: Math.max(ot_min, ot_max),
    monthly_min: Math.min(mo_min, mo_max),
    monthly_max: Math.max(mo_min, mo_max),
    estimated_total_hours: hours,
    estimated_completion_weeks: clamp(Math.round(Number(t.estimated_completion_weeks) || 4), 1, 24),
  };
}
function sanitizeEditTier(t) {
  const out = { match_tier: clampStr(t.match_tier, 40) };
  if (t.rationale != null) out.rationale = clampStr(t.rationale, 200);
  if (Array.isArray(t.scope)) out.scope = t.scope.slice(0, 8).map((s) => clampStr(s, 100));
  if (t.one_time_min != null) out.one_time_min = Math.round(Number(t.one_time_min));
  if (t.one_time_max != null) out.one_time_max = Math.round(Number(t.one_time_max));
  if (t.monthly_min != null) out.monthly_min = Math.round(Number(t.monthly_min));
  if (t.monthly_max != null) out.monthly_max = Math.round(Number(t.monthly_max));
  if (t.estimated_total_hours != null) out.estimated_total_hours = Math.round(Number(t.estimated_total_hours));
  if (t.estimated_completion_weeks != null) out.estimated_completion_weeks = clamp(Math.round(Number(t.estimated_completion_weeks) || 4), 1, 24);
  return out;
}
function sanitizePlanWeek(p) {
  return {
    week: clamp(Math.round(Number(p.week) || 1), 1, 24),
    phase: clampStr(p.phase, 80),
    milestones: Array.isArray(p.milestones) ? p.milestones.slice(0, 4).map((s) => clampStr(s, 120)) : [],
    estimated_hours: clamp(Math.round(Number(p.estimated_hours) || 0), 1, 80),
  };
}
function sanitizeEditPlanWeek(p) {
  const out = { match_week: clamp(Math.round(Number(p.match_week) || 0), 1, 24) };
  if (p.phase != null) out.phase = clampStr(p.phase, 80);
  if (Array.isArray(p.milestones)) out.milestones = p.milestones.slice(0, 4).map((s) => clampStr(s, 120));
  if (p.estimated_hours != null) out.estimated_hours = clamp(Math.round(Number(p.estimated_hours) || 0), 1, 80);
  return out;
}
function sanitizeRisk(r) {
  return {
    risk: clampStr(r.risk, 120),
    severity: ["high","medium","low"].includes(r.severity) ? r.severity : "medium",
    mitigation: clampStr(r.mitigation, 160),
  };
}
function sanitizeEditRisk(r) {
  const out = { match_risk: clampStr(r.match_risk, 120) };
  if (r.severity != null) out.severity = ["high","medium","low"].includes(r.severity) ? r.severity : "medium";
  if (r.mitigation != null) out.mitigation = clampStr(r.mitigation, 160);
  return out;
}

function applyPatch(analysis, patch) {
  const out = JSON.parse(JSON.stringify(analysis));

  if (patch.set) {
    for (const k of Object.keys(patch.set)) out[k] = patch.set[k];
  }

  if (Array.isArray(patch.remove_pain_points) && patch.remove_pain_points.length) {
    const lower = patch.remove_pain_points.map((s) => String(s).toLowerCase());
    out.pain_points = (out.pain_points || []).filter((p) => !lower.includes(String(p.title || "").toLowerCase()));
  }
  if (Array.isArray(patch.add_pain_points)) out.pain_points = (out.pain_points || []).concat(patch.add_pain_points);

  if (Array.isArray(patch.remove_services) && patch.remove_services.length) {
    const lower = patch.remove_services.map((s) => String(s).toLowerCase());
    out.proposed_services = (out.proposed_services || []).filter((s) => !lower.includes(String(s.name || "").toLowerCase()));
  }
  if (Array.isArray(patch.add_services)) out.proposed_services = (out.proposed_services || []).concat(patch.add_services);
  if (Array.isArray(patch.edit_services)) {
    for (const e of patch.edit_services) {
      const lower = String(e.match_name || "").toLowerCase();
      const t = (out.proposed_services || []).find((x) => String(x.name || "").toLowerCase() === lower);
      if (t) Object.assign(t, e);
    }
  }

  if (Array.isArray(patch.remove_tiers) && patch.remove_tiers.length) {
    const lower = patch.remove_tiers.map((s) => String(s).toLowerCase());
    out.pricing_tiers = (out.pricing_tiers || []).filter((t) => !lower.includes(String(t.tier || t.name || "").toLowerCase()));
  }
  if (Array.isArray(patch.add_tiers)) out.pricing_tiers = (out.pricing_tiers || []).concat(patch.add_tiers);
  if (Array.isArray(patch.edit_tiers)) {
    for (const e of patch.edit_tiers) {
      const lower = String(e.match_tier || "").toLowerCase();
      const t = (out.pricing_tiers || []).find((x) => String(x.tier || x.name || "").toLowerCase() === lower);
      if (t) Object.assign(t, e);
    }
  }

  if (Array.isArray(patch.remove_plan_weeks) && patch.remove_plan_weeks.length) {
    out.execution_plan = (out.execution_plan || []).filter((w) => !patch.remove_plan_weeks.includes(Number(w.week)));
  }
  if (Array.isArray(patch.add_plan_weeks)) out.execution_plan = (out.execution_plan || []).concat(patch.add_plan_weeks);
  if (Array.isArray(patch.edit_plan_weeks)) {
    for (const e of patch.edit_plan_weeks) {
      const w = (out.execution_plan || []).find((x) => Number(x.week) === Number(e.match_week));
      if (w) Object.assign(w, e);
    }
  }

  if (Array.isArray(patch.remove_risks) && patch.remove_risks.length) {
    const lower = patch.remove_risks.map((s) => String(s).toLowerCase());
    out.risk_flags = (out.risk_flags || []).filter((r) => !lower.includes(String(r.risk || "").toLowerCase()));
  }
  if (Array.isArray(patch.add_risks)) out.risk_flags = (out.risk_flags || []).concat(patch.add_risks);
  if (Array.isArray(patch.edit_risks)) {
    for (const e of patch.edit_risks) {
      const lower = String(e.match_risk || "").toLowerCase();
      const r = (out.risk_flags || []).find((x) => String(x.risk || "").toLowerCase() === lower);
      if (r) Object.assign(r, e);
    }
  }

  if (patch.set_outreach) {
    out.outreach_angle = out.outreach_angle || {};
    for (const k of Object.keys(patch.set_outreach)) out.outreach_angle[k] = patch.set_outreach[k];
  }

  out._last_patched_at = new Date().toISOString();
  return out;
}

function clampStr(v, max) {
  return String(v || "").slice(0, max);
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