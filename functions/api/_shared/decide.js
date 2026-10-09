// /functions/api/_shared/decide.js
//
// Shared decision-model helper for the mehyar.us ecosystem.
// Canonical source — other workers/repos vendor this exact file (see header
// note at the bottom). One logic, not per-pipeline copies.
//
// What it does: turns "ask an LLM to read X and output JSON, then parse it"
// into a typed decision call. You send a state (text / JSON / images) plus
// typed questions; you get back machine-usable answers with probabilities.
// No text generation, no JSON parsing, no regex salvage.
//
// Backend: Cloudflare Clef-flash (@cf/cloudflare/clef-flash, 9B, ~39ms median,
// $0.09/1M input tokens, output free) on Workers AI. Speaks Jev's
// /v1/systemone wire format (verified live 2026-10-09):
//   POST /accounts/{acct}/ai/run/@cf/cloudflare/clef-flash
//   { model:"clef-flash", state, questions:{ id:{type,instructions,criteria} } }
// Transport: env.AI binding when bound (Workers), else Workers AI REST with
// the legacy X-Auth-Email + X-Auth-Key flow (same as llmChat.js). If neither
// works, decide() returns { ok:false } and the caller keeps its old path.
//
// Question types:
//   noul   — yes/no statement.  ask:"This message is spam"
//            → decision:boolean, confidence = max(p, 1-p)
//   choice — pick one label.    ask:"What does the sender want?",
//            options:{ booking:"wants to book", cancel:"wants to cancel" }
//            → decision:label, confidence = P(winner)
//   score  — rate on levels.   ask:"How likely is dismissal?",
//            levels:["Very unlikely","Unlikely","Toss-up","Likely","Very likely"]
//            → decision:0-100 (normalized), confidence = max level P
//
// Up to 64 questions per request — decide() chunks automatically.
//
// Usage:
//   import { decide, verdict } from "./_shared/decide.js";
//   const r = await decide(env, { text: msg }, {
//     intent: { type:"choice", ask:"What does the sender want?",
//               options:{ booking:"wants to book", cancel:"wants to cancel",
//                         price:"asking about price", spam:"unsolicited junk" } },
//     urgent: { type:"noul", ask:"The sender conveys urgency or time sensitivity" },
//   });
//   if (!r.ok) return legacyPath();            // decision backend down → old path
//   const v = verdict(r.answers.intent);       // "auto" | "review" | "fail"
//   if (v === "auto") return route(r.answers.intent.decision);
//   if (v === "review") return humanQueue(r);
//   return legacyPath();                       // low confidence → old path
//
// Audit/privacy: decide() NEVER logs state text (may hold PII). The audit
// entry carries question ids + decisions + confidences + usage only. Pass a
// hashed correlation id inside state if you need to join later (the
// ecosystem's hash-only convention for emails).

export const DECIDE_MODEL = "@cf/cloudflare/clef-flash";
export const DECIDE_MODEL_SHORT = "clef-flash";
export const DECIDE_MAX_QUESTIONS = 64;

// ── wire-format adapter seam ─────────────────────────────────────────────
// Default speaks Jev/systemone to Workers AI. Swap via opts.transport for
// tests or if the wire format ever changes — decide() itself never changes.
async function defaultTransport(env, wireBody, { timeoutMs = 30000 } = {}) {
  // 1) Workers AI binding (Workers; e.g. the mayor worker binds AI).
  if (env && env.AI && typeof env.AI.run === "function") {
    const t0 = Date.now();
    const raw = await env.AI.run(DECIDE_MODEL, wireBody);
    return { raw: raw && raw.result ? raw.result : raw, latencyMs: Date.now() - t0, via: "binding" };
  }
  // 2) Workers AI REST with legacy auth (Pages Functions; same as llmChat.js).
  const accountId = env.CLOUDFLARE_ACCOUNT_ID || "";
  const email = env.CLOUDFLARE_EMAIL || env.CF_EMAIL || "";
  const key = env.CLOUDFLARE_API_KEY || env.CF_API_KEY || env.CLOUDFLARE_GLOBAL_API_KEY || "";
  if (!accountId || !email || !key) {
    throw new Error("decide_no_transport");
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${DECIDE_MODEL}`;
  const t0 = Date.now();
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Auth-Email": email,
      "X-Auth-Key": key,
      "User-Agent": "Mozilla/5.0 (compatible; mehyar-decide/1.0)",
    },
    body: JSON.stringify(wireBody),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const latencyMs = Date.now() - t0;
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`decide_http_${resp.status}:${body.slice(0, 200)}`);
  }
  const json = await resp.json();
  if (!json || json.success !== true) {
    throw new Error(`decide_api_error:${JSON.stringify(json && json.errors).slice(0, 200)}`);
  }
  return { raw: json.result, latencyMs, via: "rest" };
}

// ── question → wire translation ──────────────────────────────────────────
function toWireQuestion(q) {
  if (!q || typeof q.ask !== "string" || !q.ask.trim()) {
    throw new Error("decide_bad_question:missing_ask");
  }
  const type = q.type;
  if (type === "noul") {
    return { type: "noul", instructions: q.ask };
  }
  if (type === "choice") {
    const options = q.options;
    if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).length === 0) {
      throw new Error("decide_bad_question:choice_needs_options_object");
    }
    return { type: "choice", instructions: q.ask, criteria: options };
  }
  if (type === "score") {
    const levels = q.levels;
    if (!Array.isArray(levels) || levels.length < 2) {
      throw new Error("decide_bad_question:score_needs_levels_array");
    }
    return { type: "score", instructions: q.ask, criteria: levels };
  }
  throw new Error(`decide_bad_question:unknown_type:${type}`);
}

// ── answer normalization ─────────────────────────────────────────────────
function maxProb(dist) {
  let best = 0;
  if (dist && typeof dist === "object") {
    for (const k of Object.keys(dist)) {
      const p = Number(dist[k]);
      if (Number.isFinite(p) && p > best) best = p;
    }
  }
  return best;
}

function normalizeAnswer(id, raw) {
  if (!raw || typeof raw !== "object" || typeof raw.type !== "string") {
    return { id, type: "unknown", ok: false, error: "missing_answer", raw };
  }
  if (raw.type === "noul") {
    const p = Number(raw.noul);
    if (!Number.isFinite(p) || p < 0 || p > 1) return { id, type: "noul", ok: false, error: "bad_noul", raw };
    const decision = p >= 0.5;
    return { id, type: "noul", ok: true, decision, confidence: Math.max(p, 1 - p), p, raw };
  }
  if (raw.type === "choice") {
    const label = raw.choice;
    const dist = raw.probabilities || {};
    if (typeof label !== "string" || !(label in dist)) {
      return { id, type: "choice", ok: false, error: "bad_choice", raw };
    }
    return {
      id, type: "choice", ok: true, decision: label,
      confidence: Number(dist[label]) || 0, probabilities: dist, raw,
    };
  }
  if (raw.type === "score") {
    const s = Number(raw.score);
    const legend = raw.legend || {};
    const n = Object.keys(legend).length;
    const dist = raw.probabilities || {};
    if (!Number.isFinite(s) || n < 2) return { id, type: "score", ok: false, error: "bad_score", raw };
    // Model returns s on the level-index scale 0..n-1 (may be fractional).
    const clamped = Math.max(0, Math.min(n - 1, s));
    const decision = Math.round((clamped / (n - 1)) * 100);
    return {
      id, type: "score", ok: true, decision, confidence: maxProb(dist),
      rawScore: s, levels: n, probabilities: dist, legend, raw,
    };
  }
  return { id, type: raw.type, ok: false, error: "unknown_type", raw };
}

// ── main entry ───────────────────────────────────────────────────────────
//
// decide(env, state, questions, opts)
//   state:     string | object | array of {type:"text"|"image_url",...} parts
//   questions: { [id]: { type, ask, options?|levels? } }
//   opts:      { model?, timeoutMs?, transport?, audit?, tag? }
//
// Returns { ok, answers:{id:answer}, model, latency_ms, usage, via, error? }
export async function decide(env, state, questions, opts = {}) {
  const t0 = Date.now();
  const ids = questions && typeof questions === "object" ? Object.keys(questions) : [];
  if (ids.length === 0) {
    return { ok: false, error: "decide_no_questions", answers: {}, latency_ms: 0 };
  }
  if (state === undefined || state === null || (typeof state === "string" && !state.trim())) {
    return { ok: false, error: "decide_empty_state", answers: {}, latency_ms: 0 };
  }

  let wire;
  try {
    wire = {};
    for (const id of ids) wire[id] = toWireQuestion(questions[id]);
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), answers: {}, latency_ms: Date.now() - t0 };
  }

  const transport = opts.transport || defaultTransport;
  const modelShort = opts.modelShort || DECIDE_MODEL_SHORT;
  const answers = {};
  let usage = { input_tokens: 0, output_tokens: 0 };
  let via = null;
  let failed = null;

  // Chunk at 64 questions/request; states are shared per chunk.
  for (let i = 0; i < ids.length; i += DECIDE_MAX_QUESTIONS) {
    const chunkIds = ids.slice(i, i + DECIDE_MAX_QUESTIONS);
    const chunkWire = {};
    for (const id of chunkIds) chunkWire[id] = wire[id];
    const wireBody = { model: modelShort, state, questions: chunkWire };
    try {
      const { raw, latencyMs, via: v } = await transport(env, wireBody, opts);
      via = via || v;
      const rawAnswers = (raw && raw.answers) || {};
      if (raw && raw.usage) {
        usage.input_tokens += Number(raw.usage.input_tokens) || 0;
        usage.output_tokens += Number(raw.usage.output_tokens) || 0;
      }
      for (const id of chunkIds) {
        answers[id] = normalizeAnswer(id, rawAnswers[id]);
      }
      void latencyMs;
    } catch (e) {
      failed = String((e && e.message) || e);
      for (const id of chunkIds) {
        answers[id] = { id, type: (questions[id] && questions[id].type) || "unknown", ok: false, error: failed };
      }
    }
  }

  const latency_ms = Date.now() - t0;
  const result = {
    ok: !failed,
    answers,
    model: DECIDE_MODEL,
    latency_ms,
    usage,
    via,
    ...(failed ? { error: failed, fallback: true } : {}),
  };

  // Audit: question ids + decisions + confidences only. NEVER state text.
  try {
    const entry = {
      ts: new Date().toISOString(),
      tag: opts.tag || null,
      model: DECIDE_MODEL,
      via,
      questions: ids.map((id) => {
        const a = answers[id];
        return { id, type: a.type, ok: a.ok, decision: a.ok ? a.decision : null, confidence: a.ok ? round3(a.confidence) : null };
      }),
      latency_ms,
      usage,
      ...(failed ? { error: String(failed).slice(0, 120) } : {}),
    };
    if (typeof opts.audit === "function") {
      await opts.audit(entry);
    } else {
      console.log("[decide]", JSON.stringify(entry));
    }
  } catch {
    // Audit must never break the decision path.
  }

  return result;
}

function round3(n) {
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n * 1000) / 1000 : n;
}

// ── act-vs-escalate convention ────────────────────────────────────────────
//
// verdict(answer, { autoAt, reviewAt })
//   "auto"   — confidence >= autoAt:   act on answer.decision
//   "review" — confidence >= reviewAt: queue for human / deeper model
//   "fail"   — below reviewAt or answer not ok: run the caller's legacy path
//
// Defaults: autoAt 0.8, reviewAt 0.5. Domains override per question via
// opts or their own constants (see DECIDE_THRESHOLDS below). Consequential
// actions (sending money mail, publishing, charging) must NEVER auto-act
// below their domain threshold — fail closed to the previous path/human.
export function verdict(answer, { autoAt = 0.8, reviewAt = 0.5 } = {}) {
  if (!answer || !answer.ok) return "fail";
  const c = Number(answer.confidence);
  if (!Number.isFinite(c)) return "fail";
  if (c >= autoAt) return "auto";
  if (c >= reviewAt) return "review";
  return "fail";
}

// Domain threshold presets. Tune from measured outcomes; these are the
// starting conventions, not tuned constants.
export const DECIDE_THRESHOLDS = {
  // TicketBeat winnability → auto-send dismissal letters above 0.85 only.
  ticketbeat_winnable: { autoAt: 0.85, reviewAt: 0.6 },
  // Email classification (bounce/complaint/unsub): misfiling is cheap.
  email_classify: { autoAt: 0.75, reviewAt: 0.5 },
  // Mayor inbound intent routing: wrong routes annoy paying customers.
  mayor_intent: { autoAt: 0.8, reviewAt: 0.55 },
  // Missed-call urgency: over-texting is worse than a slow reply.
  mayor_urgency: { autoAt: 0.8, reviewAt: 0.55 },
  // Bug bounty severity/duplicate: money-adjacent, stay conservative.
  bounty_triage: { autoAt: 0.85, reviewAt: 0.6 },
  // AI Mechanic pre-triage: cheap first pass, low stakes.
  aimech_triage: { autoAt: 0.7, reviewAt: 0.45 },
  // Twiluna QC gates: false passes ship bad video; false fails waste render.
  twiluna_qc: { autoAt: 0.8, reviewAt: 0.55 },
  // Affiliate/DM intent: sending a link to the wrong person is spammy.
  affiliate_intent: { autoAt: 0.8, reviewAt: 0.55 },
  // Campaign judge panel: advisory scores, not actions.
  campaign_judge: { autoAt: 0.7, reviewAt: 0.4 },
  // Audit My Business findings: a stated finding is a paid claim about the
  // buyer's business — auto-state only at high confidence; anything lower is
  // labeled "Needs review", never stated as fact. (Added 2026-10-09 for the
  // audit-business pipeline; canonical preset, not a fork.)
  audit_finding: { autoAt: 0.8, reviewAt: 0.55 },
};

// Convenience: build a text+images multimodal state part list.
export function stateParts(text, imageUrls = []) {
  const parts = [];
  if (text) parts.push({ type: "text", text: String(text) });
  for (const u of imageUrls.slice(0, 4)) {
    parts.push({ type: "image_url", image_url: { url: u } });
  }
  return parts;
}

// ── vendoring note ───────────────────────────────────────────────────────
// Workers in OTHER repos (not mehyar-web) that need decide(): copy this file
// verbatim into your repo's shared lib and keep this header. Canonical
// source of truth: mehyar-us/mehyar-web repo,
//   functions/api/_shared/decide.js
// Sync by copying the file; do not fork the logic.
