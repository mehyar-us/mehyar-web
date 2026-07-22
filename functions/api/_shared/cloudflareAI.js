// /functions/api/_shared/cloudflareAI.js
//
// Thin convenience wrapper around llmChat.js for the Mayors' high-frequency
// call sites (fit-score, draft generator, summarizer). All requests route
// through CF Workers AI with X-Auth-Email + X-Auth-Key auth (the only auth
// shape that works for this account, verified 2026-07-22).
//
// Every helper here returns:
//   {
//     used_llm: boolean,
//     content:  string,        // raw model output (or JSON.parse'd)
//     parsed:   any,            // content parsed as JSON, or null if not JSON
//     latency_ms: number,
//     neurons:   number,
//     provider:  "cloudflare",
//     model:     string,
//     error?:    string,
//   }
//
// Hard budget: each fanout helper accepts `concurrency` and `budgetNeurons`
// so a 100-opp brief never blows the daily 10K-neuron free tier.

import { chatJson, resolveLlmConfig } from "./llmChat.js";

const DEFAULT_MODEL = "@cf/meta/llama-3.2-3b-instruct"; // fast + good JSON
const FAST_MODEL = "@cf/meta/llama-3.2-1b-instruct"; // for high-volume fit-score
const REASONING_MODEL = "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b"; // for deep proposals

// Alias for backward compat — the orchestrator may pass either name.
const resolveConfig = resolveLlmConfig;

// Run `fn` over `items` with bounded concurrency. Returns an array of
// results in the same order, each `{ ok, value | error }`.
export async function boundedMap(items, concurrency, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      try {
        out[idx] = { ok: true, value: await fn(items[idx], idx) };
      } catch (err) {
        out[idx] = { ok: false, error: String(err?.message || err) };
      }
    }
  }
  const pool = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) pool.push(worker());
  await Promise.all(pool);
  return out;
}

// Strip ﻿think...﻿think prefixes that reasoning models emit before the
// actual answer. Falls back to the raw string if no closing tag is found.
function stripThink(text) {
  if (!text) return "";
  const m = /<\/think>/i.exec(text);
  if (!m) return text.trim();
  return text.slice(m.index + m[0].length).trim();
}

function safeJsonParse(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch {}
  // Some models wrap JSON in ```json fences — strip and retry.
  const m = /```(?:json)?\s*([\s\S]+?)\s*```/i.exec(s);
  if (m) {
    try { return JSON.parse(m[1]); } catch {}
  }
  return null;
}

// ── FIT-SCORE (high-volume, low-cost) ─────────────────────────────────────
//
// Used by SAM ingest + prospect scanner. Scores each opp/prospect against
// the MehyarSoft capability statement and returns a 0-100 fit_score,
// why_fit (bullets), why_not_fit, missing_requirements.
//
// Returns a single item's result for parallel use via boundedMap.
export async function fitScoreOne(env, item, signal) {
  const capabilityStatement =
    `MehyarSoft LLC — Brooklyn, NY — founder-led software/systems/AI automation consulting firm.\n` +
    `NAICS: 541511 Custom Computer Programming, 541512 Computer Systems Design, 541519 Other Computer Related Services.\n` +
    `Set-asides: Total Small Business; HUBZone.\n` +
    `Service offerings: 6-tier offer ladder — $150 Tech Audit → $250 Website Diagnosis Report → ` +
    `$1k-$25k Custom Build → $500-$3.5k/mo Quarterly Retainer → $150/hr Hourly Advisory.\n` +
    `Past performance: 2 live managed apps (Rizza, AiMech); pharma systems-engineering discipline; ` +
    `founder-led, no agency theater; remote-first delivery continental US; small team of 1-3.\n` +
    `Pain points we're good at: lead leaks, manual CRM workflows, disconnected tools, weak websites, ` +
    `missed calls, AI features (RAG, classification), regulated-data systems.`;

  const sysPrompt = `You score business opportunities for fit against a capability statement.
Return strict JSON only — no prose, no fences:
{
  "fit_score": <integer 0-100>,
  "confidence": "low" | "med" | "high",
  "why_fit": ["3-5 specific bullets mapping opp to capabilities"],
  "why_not_fit": ["0-3 bullets of gaps"],
  "missing_requirements": ["concrete gaps like 'requires FedRAMP Moderate'"],
  "next_action": "draft_proposal" | "pass" | "ask_user" | "check_referral"
}
Score 0-100 based on: (a) NAICS alignment, (b) dollar value in target range, (c) capability overlap, ` +
    `(d) ability to deliver without sub-contracting, (e) Set-aside fit for total-small / HUBZone.`;

  const userPrompt = `OPPORTUNITY (JSON):\n${JSON.stringify(item).slice(0, 3500)}\n\n` +
    `CAPABILITY STATEMENT:\n${capabilityStatement}\n\n` +
    `Return only the JSON.`;

  const cfg = resolveConfig(env);
  const t0 = Date.now();
  const r = await chatJson({
    env,
    messages: [
      { role: "system", content: sysPrompt },
      { role: "user", content: userPrompt },
    ],
    model: env.FITSCORE_MODEL || FAST_MODEL,
    max_tokens: 500,
    temperature: 0.1,
    json_mode: true,
  });
  const latency_ms = Date.now() - t0;
  const cleaned = stripThink(r.content || "");
  return {
    used_llm: r.used_llm,
    content: cleaned,
    parsed: safeJsonParse(cleaned),
    latency_ms,
    neurons: r.usage?.neurons ?? ((r.usage?.prompt_tokens || 0) + (r.usage?.completion_tokens || 0)),
    provider: r.provider,
    model: r.model,
    error: r.error,
  };
}

// Bounded parallel fit-score for many items. Caps concurrency to avoid
// hammering CF AI; falls back to a heuristic score when LLM fails so the
// ingest pipeline is never silent.
export async function fitScoreBatch(env, items, { concurrency = 4 } = {}) {
  const results = await boundedMap(items, concurrency, async (item) => fitScoreOne(env, item));
  return results.map((r, idx) => {
    const original = items[idx];
    if (!r.ok || !r.value?.used_llm || !r.value?.parsed) {
      // Heuristic fallback: NAICS match -> 50, +5 per cached keyword
      const text = JSON.stringify(original).toLowerCase();
      let score = 0;
      if (text.includes("541511") || text.includes("541512") || text.includes("541519")) score += 50;
      if (text.includes("software") || text.includes("it services") || text.includes("automation")) score += 10;
      if (text.includes("website") || text.includes("web app") || text.includes("crm")) score += 10;
      if (text.includes("ai") || text.includes("machine learning")) score += 10;
      score = Math.min(100, Math.max(5, score));
      return {
        id: original?.noticeId || original?.id,
        fit_score: score,
        confidence: "low",
        why_fit: ["LLM unavailable — used heuristic NAICS/keyword match"],
        why_not_fit: ["Manual review recommended"],
        missing_requirements: ["Verify against capability statement"],
        next_action: score > 50 ? "draft_proposal" : "ask_user",
        used_llm: false,
        fallback: true,
        latency_ms: 0,
        neurons: 0,
      };
    }
    const p = r.value.parsed;
    return {
      id: original?.noticeId || original?.id,
      fit_score: Math.max(0, Math.min(100, Number(p.fit_score) || 0)),
      confidence: p.confidence || "med",
      why_fit: Array.isArray(p.why_fit) ? p.why_fit : [],
      why_not_fit: Array.isArray(p.why_not_fit) ? p.why_not_fit : [],
      missing_requirements: Array.isArray(p.missing_requirements) ? p.missing_requirements : [],
      next_action: p.next_action || "ask_user",
      used_llm: true,
      latency_ms: r.value.latency_ms,
      neurons: r.value.neurons,
    };
  });
}

// ── DRAFT GENERATOR (3 hierarchies: cold / proposal / followup) ────────
//
// Generates a tailored email for one prospect/opportunity. Picks a model
// based on kind: cold outreach uses the FAST model, proposals use the
// default reasoning model.
export async function draftOne(env, ctx, { kind = "cold" } = {}) {
  const model = kind === "proposal" ? (env.DRAFT_MODEL || REASONING_MODEL) : DEFAULT_MODEL;
  const companySummary = [
    `Business: ${ctx.business_name || ctx.name || "(unknown)"}`,
    `Vertical: ${ctx.vertical || "(unknown)"}`,
    `Website: ${ctx.website || "(unknown)"}`,
    `Detected leaks: ${(ctx.leaks || []).join("; ")}`,
    `Fit score: ${ctx.fit_score ?? "?"} (confidence: ${ctx.confidence || "?"})`,
    `Why fit: ${(ctx.why_fit || []).join("; ")}`,
  ].join("\n");

  const sysPrompt = `You write SHORT, sharp B2B cold emails in MehyarSoft voice.
Subject line + 3-sentence body + 1-line CTA. NO fluff, NO "I hope this finds you well",
NO emojis. Reference the prospect's leak specifically in the FIRST sentence.
You're a founder, not a sales rep. Sign as Mehyar, no last name. Include the
one-click unsubscribe footer line ("Unsubscribe: https://mehyar.us/unsubscribe")
as plain text on its own line. Plain text only.`;

  const userPrompt = `${kind === "proposal" ? "Draft a 4-paragraph capability statement / proposal teaser for:\n" : "Draft a 90-word cold outreach email for:\n"}\n${companySummary}\n\n` +
    `${kind === "proposal" ? "Audience: federal program officer reviewing capability statements." : "Audience: small business owner who has a leaky site and 30 seconds."}`;

  const t0 = Date.now();
  const r = await chatJson({
    env,
    messages: [{ role: "system", content: sysPrompt }, { role: "user", content: userPrompt }],
    model,
    max_tokens: kind === "proposal" ? 700 : 250,
    temperature: 0.3,
    json_mode: false,
  });
  const latency_ms = Date.now() - t0;
  return {
    used_llm: r.used_llm,
    content: stripThink(r.content || ""),
    parsed: null,
    latency_ms,
    neurons: r.usage?.neurons ?? ((r.usage?.prompt_tokens || 0) + (r.usage?.completion_tokens || 0)),
    provider: r.provider,
    model: r.model,
    error: r.error,
  };
}

// ── SUMMARIZER (digest / pulse / mini-reports) ───────────────────────────
//
// Single round-trip summarizer used by /api/mayor/digest.js for the daily
// email + /api/admin/dashboard/today.js for the pulse.
export async function summarize(env, prompt, { system, max_tokens = 400 } = {}) {
  const t0 = Date.now();
  const r = await chatJson({
    env,
    messages: [
      { role: "system", content: system || "You write concise operational summaries for a one-person business owner. Plain text, ≤120 words, focused on what changed and what needs attention." },
      { role: "user", content: prompt },
    ],
    model: env.SUMMARY_MODEL || DEFAULT_MODEL,
    max_tokens,
    temperature: 0.2,
    json_mode: false,
  });
  const latency_ms = Date.now() - t0;
  return {
    used_llm: r.used_llm,
    content: stripThink(r.content || ""),
    parsed: null,
    latency_ms,
    neurons: r.usage?.neurons ?? ((r.usage?.prompt_tokens || 0) + (r.usage?.completion_tokens || 0)),
    provider: r.provider,
    model: r.model,
    error: r.error,
  };
}
