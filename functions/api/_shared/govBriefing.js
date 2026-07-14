// AI-powered gov opportunity brief generator.
// Produces a 1-page exec-readiness summary for a single opportunity, stored in
// gov_opportunity_briefs. Uses llmChat.chatJson (OpenAI-compatible) with a
// strict JSON response_format. Falls back to a deterministic template if the
// LLM is missing or fails.
//
// Scoring inputs we pass to the LLM:
//   - title, agency, description (truncated)
//   - naics, set_aside, deadline, estimated_value
//   - the deterministic fit_score from scoreGovOpportunity() as a prior
//   - the company capability statement (resolved from env or default)

import { chatJson, safeJsonParse, resolveLlmConfig } from "./llmChat.js";

const COMPANY_PROFILE = {
  name: "MehyarSoft LLC",
  location: "Brooklyn, NY",
  small_business: true,
  certifications: ["none — check SAM.gov entity for current set-aside registrations"],
  core_services: [
    "custom software / web application development",
    "website modernization",
    "workflow automation",
    "CRM implementation and integration",
    "data dashboards / business intelligence",
    "cloud migration (Workers, Pages, D1, R2, KV)",
    "API integration / systems integration",
    "case management and intake portals",
    "help desk / email automation",
  ],
  primary_naics: ["541511", "541512", "541519", "541611", "541612"],
  secondary_naics: ["541618", "541990", "511210", "541715"],
  past_performance_summary:
    "Founder-led, recent engagements include a healthcare-misrouted-call remediation (90s CRM follow-up + Twilio), a regulated-industry intake portal, and a service-business AI-agent for missed-call/text lead capture.",
  sweet_spot: "small ($5k–$250k) federal/state/city software + automation contracts for agencies that need a senior technical owner to ship the smallest useful fix end-to-end.",
};

export function resolveCapabilityProfile(env = {}) {
  // Allow override via env; default to the profile above.
  return {
    ...COMPANY_PROFILE,
    set_asides: env.GOV_SET_ASIDES?.split(",").map((s) => s.trim()).filter(Boolean) || COMPANY_PROFILE.certifications,
    naics: env.GOV_NAICS?.split(",").map((s) => s.trim()).filter(Boolean) || COMPANY_PROFILE.primary_naics,
  };
}

const SYSTEM_PROMPT = `You are an expert capture manager for MehyarSoft LLC, a Brooklyn NY small business that bids on federal/state/city software and automation contracts.

Given a raw opportunity, produce a STRICT JSON object with these fields (no extra prose, no markdown fences):

{
  "executive_summary": "2-3 sentence plain-English summary of what the agency wants and why",
  "why_we_fit": "1-2 sentence bullet-style summary of where MehyarSoft's services match the scope",
  "why_we_dont_fit": "1-2 sentence summary of gaps (NAICS mismatch, set-aside we don't hold, capacity, scope mismatch)",
  "capability_match": { "naics": true/false, "set_aside": true/false, "capacity": true/false, "past_performance": true/false },
  "bid_decision": "go" | "no-go" | "watch",
  "estimated_effort_hours": <integer 4-400>,
  "estimated_value_usd": <number or null>,
  "missing_artifacts": ["CPARS", "past performance narrative", "team resumes", ...] | [],
  "risk_flags": ["deadline < 7 days", "scope vague", ...] | [],
  "next_step": "request RFI clarification" | "submit proposal" | "set reminder" | "archive" | "triage",
  "sources_cited": ["https://sam.gov/opp/...", ...]
}

Rules:
- bid_decision = "go" only if: capability_match is true in at least 3 of 4 fields AND the deterministic fit_score prior >= 70 AND deadline is at least 7 days away.
- bid_decision = "no-go" if: any capability_match field is false AND the gap is unfixable in time, OR if past_performance is false AND the agency explicitly requires it.
- Otherwise "watch".
- estimated_effort_hours: < 8 = quick turn-around; 8-40 = small engagement; 40-120 = mid-size; >120 = significant.
- Be honest about gaps. MehyarSoft is a single-founder firm; capacity is the most common dealbreaker.
- Use ONLY the JSON object as your response. No leading or trailing prose.`;

function buildUserPrompt(opp, profile, fitPrior) {
  return `Opportunity:
- title: ${opp.title || "—"}
- agency: ${opp.agency || "—"}
- office: ${opp.office || "—"}
- source: ${opp.source || "—"}
- source_url: ${opp.source_url || "—"}
- type: ${opp.opportunity_type || "—"}
- set_aside: ${opp.set_aside || "—"}
- naics_codes: ${(opp.naics_codes || []).join(", ") || "—"}
- posted_date: ${opp.posted_date || "—"}
- response_deadline: ${opp.response_deadline || "—"}
- estimated_value_usd: ${opp.estimated_value_usd ?? opp.estimated_value ?? "—"}
- description (first 1500 chars): ${(opp.description || "").slice(0, 1500) || "—"}
- summary (first 500 chars): ${(opp.summary || "").slice(0, 500) || "—"}

MehyarSoft capability profile:
- name: ${profile.name}
- location: ${profile.location}
- small_business: ${profile.small_business}
- set_asides_held: ${(profile.set_asides || []).join(", ") || "(none)"}
- primary_naics: ${(profile.naics || []).join(", ")}
- core_services: ${(profile.core_services || []).join(", ")}
- past_performance_summary: ${profile.past_performance_summary}
- sweet_spot: ${profile.sweet_spot}

Deterministic fit_score prior (keyword-based): ${fitPrior.score}/100, confidence=${fitPrior.confidence}.
Deterministic why_fit: ${fitPrior.why_fit}
Deterministic why_not_fit: ${fitPrior.why_not_fit}

Generate the JSON brief now.`;
}

export async function generateGovOpportunityBrief({ env, opportunity, deterministicFit }) {
  const profile = resolveCapabilityProfile(env);
  const fitPrior = deterministicFit || { score: 50, confidence: "low", why_fit: "", why_not_fit: "" };
  const prompt = buildUserPrompt(opportunity, profile, fitPrior);

  const result = await chatJson({
    env,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    max_tokens: 700,
    temperature: 0.1,
    json_mode: true,
  });

  if (result.used_llm) {
    console.log("[gov-brief-debug] LLM model:", result.model, "content-len:", (result.content||"").length, "content[:500]:", String(result.content || "").slice(0, 500));
    const parsed = safeJsonParse(result.content, {});
    console.log("[gov-brief-debug] parsed keys:", Object.keys(parsed || {}), "bid_decision:", parsed?.bid_decision);
    const valid =
      parsed.executive_summary && parsed.bid_decision &&
      ["go", "no-go", "watch"].includes(parsed.bid_decision);
    if (valid) {
      return {
        used_llm: true,
        generated_by: result.model || "unknown",
        brief: normalize(parsed, opportunity),
      };
    }
    // Fall through to template.
  }
  // Template fallback: derive a brief from the deterministic fit + the raw opp.
  return {
    used_llm: false,
    generated_by: "template-fallback",
    brief: normalize(templateBrief(opportunity, fitPrior), opportunity),
  };
}

function normalize(brief, opp) {
  return {
    executive_summary: String(brief.executive_summary || opp.title || "(no summary)").slice(0, 1000),
    why_we_fit: String(brief.why_we_fit || "").slice(0, 800),
    why_we_dont_fit: String(brief.why_we_dont_fit || "").slice(0, 800),
    capability_match: {
      naics: Boolean(brief.capability_match?.naics),
      set_aside: Boolean(brief.capability_match?.set_aside),
      capacity: Boolean(brief.capability_match?.capacity),
      past_performance: Boolean(brief.capability_match?.past_performance),
    },
    bid_decision: ["go", "no-go", "watch"].includes(brief.bid_decision) ? brief.bid_decision : "watch",
    estimated_effort_hours: clampInt(brief.estimated_effort_hours, 4, 400, 40),
    estimated_value_usd: Number(brief.estimated_value_usd) || null,
    missing_artifacts: Array.isArray(brief.missing_artifacts) ? brief.missing_artifacts.slice(0, 20) : [],
    risk_flags: Array.isArray(brief.risk_flags) ? brief.risk_flags.slice(0, 20) : [],
    next_step: String(brief.next_step || "review").slice(0, 80),
    sources_cited: Array.isArray(brief.sources_cited) ? brief.sources_cited.slice(0, 10) : [],
  };
}

function clampInt(v, lo, hi, fallback) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function templateBrief(opp, fitPrior) {
  const score = fitPrior.score;
  const decision = score >= 70 ? "go" : score <= 35 ? "no-go" : "watch";
  const sources = [];
  if (opp.source_url) sources.push(opp.source_url);
  if (opp.noticeId) sources.push(`https://sam.gov/opp/${opp.noticeId}/view`);
  return {
    executive_summary: `${opp.title || "Untitled opportunity"} — ${opp.agency || "agency"} is seeking ${opp.opportunity_type || "services"}. ${opp.summary ? opp.summary.slice(0, 200) : "Description unavailable."}`,
    why_we_fit: fitPrior.why_fit || "Limited explicit service-match evidence; manual review recommended.",
    why_we_dont_fit: fitPrior.why_not_fit || "No major mismatch detected from available metadata.",
    capability_match: { naics: (opp.naics_codes || []).some((c) => (COMPANY_PROFILE.primary_naics).includes(String(c))), set_aside: false, capacity: false, past_performance: false },
    bid_decision: decision,
    estimated_effort_hours: decision === "go" ? 60 : decision === "watch" ? 20 : 8,
    estimated_value_usd: opp.estimated_value || opp.estimated_value_usd || null,
    missing_artifacts: ["Past performance narrative (≥3 federal projects)", "Team resumes", "Set-aside registration (check SAM.gov entity)"],
    risk_flags: score <= 35 ? ["Low deterministic fit score"] : [],
    next_step: decision === "go" ? "submit proposal" : decision === "watch" ? "set reminder" : "archive",
    sources_cited: sources,
  };
}

export async function upsertGovOpportunityBrief(db, opportunityId, brief, generatedBy) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const existing = await db.prepare("SELECT id FROM gov_opportunity_briefs WHERE opportunity_id = ? LIMIT 1").bind(opportunityId).first();
  if (existing) {
    await db.prepare(`UPDATE gov_opportunity_briefs SET
      executive_summary = ?, why_we_fit = ?, why_we_dont_fit = ?,
      capability_match_json = ?, bid_decision = ?, estimated_effort_hours = ?,
      estimated_value_usd = ?, missing_artifacts_json = ?, risk_flags_json = ?,
      next_step = ?, sources_cited_json = ?, generated_by = ?, updated_at = ?
    WHERE opportunity_id = ?`).bind(
      brief.executive_summary, brief.why_we_fit, brief.why_we_dont_fit,
      JSON.stringify(brief.capability_match), brief.bid_decision, brief.estimated_effort_hours,
      brief.estimated_value_usd, JSON.stringify(brief.missing_artifacts), JSON.stringify(brief.risk_flags),
      brief.next_step, JSON.stringify(brief.sources_cited), generatedBy, now,
      opportunityId,
    ).run();
    return { id: existing.id, action: "updated" };
  }
  await db.prepare(`INSERT INTO gov_opportunity_briefs (
    id, opportunity_id, executive_summary, why_we_fit, why_we_dont_fit,
    capability_match_json, bid_decision, estimated_effort_hours, estimated_value_usd,
    missing_artifacts_json, risk_flags_json, next_step, sources_cited_json,
    generated_by, generated_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    id, opportunityId, brief.executive_summary, brief.why_we_fit, brief.why_we_dont_fit,
    JSON.stringify(brief.capability_match), brief.bid_decision, brief.estimated_effort_hours, brief.estimated_value_usd,
    JSON.stringify(brief.missing_artifacts), JSON.stringify(brief.risk_flags), brief.next_step,
    JSON.stringify(brief.sources_cited), generatedBy, now, now,
  ).run();
  return { id, action: "inserted" };
}

export async function getGovOpportunityBrief(db, opportunityId) {
  return db.prepare("SELECT * FROM gov_opportunity_briefs WHERE opportunity_id = ? LIMIT 1").bind(opportunityId).first();
}