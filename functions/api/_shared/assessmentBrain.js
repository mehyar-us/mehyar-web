// functions/api/_shared/assessmentBrain.js
//
// Conversation engine for the assessment call. Owns the state machine; the
// infra crew's turn-taking loop calls respond() once per caller utterance.
//
//   respond(env, userText, session, deps) -> { replyText, actions, session }
//   simulateTurn(session, userText, deps) -> same, for red-team text simulation
//
// actions: { type:"endCall" } | { type:"captureEmail", email } |
//          { type:"bookAudit", url } | { type:"followupQueued" } |
//          { type:"transition", to } (informational — session.stage already set)
//
// deps (all injectable for tests; production defaults hit the real backends):
//   { chatFn, decideFn, diagnoseFn, nowMs }
//   chatFn(env, messages) -> { text }            default: llmChat.chat (Workers AI)
//   decideFn(env, state, questions, opts)        default: decide.js decide()
//   diagnoseFn(url) -> { ok, signals, findings } default: assessmentDiagnose.diagnoseUrl
//   nowMs() -> epoch ms                         default: Date.now
//
// decide() integration (fail closed — on { ok:false } the deterministic path runs):
//   (a) scoreFindings: per-finding severity refinement {low,medium,high} +
//       factual-check noul. Low-confidence ("review") keeps the deterministic
//       severity and flags needsReview. Never stated as AI fact to the caller.
//   (b) closeReadiness: per-turn in PITCH/DEPTH — closeReady noul, objection
//       choice {none,price,skepticism,timing,authority}, engagement score.
//       Drives when to push the pitch vs. keep diagnosing/closing.

import { decide, verdict } from "./decide.js";
import { chat } from "./llmChat.js";
import { diagnoseUrl, diagnosisSummary, spokenUrlToUrl } from "./assessmentDiagnose.js";
import {
  STAGES, PITCH_BY_MINUTE, PITCH_EARLIEST_MINUTE,
  DISCOVERY_QUESTIONS, STAGE_STEER, CALLER_PERSONAS,
  CONSENT_SCRIPT, CONSENT_DECLINED_SCRIPT, FRAMING_SCRIPT,
  DIAGNOSIS_INTRO_SCRIPT, DIAGNOSIS_FETCH_FAILED_SCRIPT, SPELL_OUT_SCRIPT,
  EMAIL_CAPTURE_SCRIPT, FOLLOWUP_CONSENT_SCRIPT, PRICE_SCRIPT,
  WRAP_BOOKED_SCRIPT, WRAP_FOLLOWUP_SCRIPT, WRAP_DECLINED_SCRIPT, DECLINED_EMAIL_SCRIPT,
  buildSystemPrompt, FORBIDDEN_PHRASES, PRODUCT_PRICE,
} from "./assessmentPersona.js";

const EMAIL_RE = /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i;
const REPLY_CHAR_CAP = 450;

const YES_RE = /^(yes|yeah|yep|yup|sure|okay|ok|fine|go ahead|that's fine|thats fine|sounds good|absolutely|definitely)/i;
const NO_RE = /^(no|nope|not really|i don'?t|dont|rather not|no thanks)/i;

// Hard-no detection (D3): "stop" = immediate clean exit, never another ask.
// Other hard nos ("no", "leave me alone", …) get one graceful landing; the
// second one exits. The avatar stays unflappable and never begs.
function hardNo(text) {
  const t = String(text || "").trim().toLowerCase();
  if (/^stop\b/.test(t)) return "stop";
  if (/^(no|nope|leave me alone|fuck|enough|i'?m done|done|go away)\b/.test(t)) return "no";
  return null;
}

// ── session ─────────────────────────────────────────────────────────────────
// Per-call usage ledger (Mayor's pricing-reporting add, 2026-10-09): MEASURED
// numbers only — tokens as reported by the providers. When a provider doesn't
// report usage for a call, tokens stay 0 and `unreported` increments; we never
// estimate or model. getUsageSummary() exposes the agreed rollup object.
export function freshUsage() {
  return {
    llm: { calls: 0, inputTokens: 0, outputTokens: 0, unreported: 0 },
    decide: { calls: 0, inputTokens: 0, outputTokens: 0, backgroundCalls: 0, unreported: 0 },
  };
}

export function newSession() {
  return {
    stage: STAGES.CONSENT,
    usage: freshUsage(),
    consentGiven: false,
    consentRetries: 0,
    askedDiscovery: [],
    businessName: "",
    category: "",
    url: "",
    acquisition: "",
    contactName: "",
    email: "",
    emailCaptured: false,
    followupConsent: false,
    followupAsked: false,
    findings: [],
    findingsPresented: 0,
    diagnosisOk: false,
    diagnosisError: "",
    pitchDelivered: false,
    outcome: "",          // booked | followup | declined | ""
    objections: [],
    closeReady: false,
    callerPersona: "neutral", // live-detected: warm|cold|rude|skeptical|rushed|chatty|guarded|neutral
    // R3 proactive agency — background site analysis state machine:
    // idle → analyzing → ready | failed → (spell-out retry) → ready | interview
    diagnosisStatus: "idle",
    diagnosisAttempts: 0,
    diagnosisError: "",
    pendingDiagnosisUrl: "",
    spelloutAsked: false,
    spelloutMode: false,
    urlRetried: false,
    interviewQuestions: 0,
    turns: [],
    startedAt: new Date().toISOString(),
    prefillToken: "",
  };
}

export function minutesIn(session, nowMs) {
  const t0 = Date.parse(session.startedAt || new Date().toISOString());
  return Math.max(0, (nowMs - t0) / 60000);
}

function ensureUsage(session) {
  if (!session.usage) session.usage = freshUsage();
  return session.usage;
}

function addLlmUsage(session, r) {
  const u = ensureUsage(session).llm;
  u.calls++;
  const inp = Number(r?.usage?.input_tokens), out = Number(r?.usage?.output_tokens);
  if (Number.isFinite(inp) && Number.isFinite(out)) { u.inputTokens += inp; u.outputTokens += out; }
  else u.unreported++;
}

function addDecideUsage(session, r, { background = false } = {}) {
  const u = ensureUsage(session).decide;
  u.calls++;
  if (background) u.backgroundCalls++;
  const inp = Number(r?.usage?.input_tokens), out = Number(r?.usage?.output_tokens);
  if (Number.isFinite(inp) && Number.isFinite(out)) { u.inputTokens += inp; u.outputTokens += out; }
  else u.unreported++;
}

// Per-call usage summary — the agreed rollup object for the infra crew's
// session-record cost rollup (field names frozen; see docs/assessment-call-contract.md).
// Measured only: tokens are provider-reported; *_unreported counts calls where
// the provider returned no usage (tokens stay 0, never estimated).
export function getUsageSummary(session) {
  const u = (session && session.usage) || freshUsage();
  return {
    llm_calls: u.llm.calls,
    llm_input_tokens: u.llm.inputTokens,
    llm_output_tokens: u.llm.outputTokens,
    llm_unreported: u.llm.unreported,
    decide_calls: u.decide.calls,
    decide_input_tokens: u.decide.inputTokens,
    decide_output_tokens: u.decide.outputTokens,
    decide_unreported: u.decide.unreported,
    background_decide_calls: u.decide.backgroundCalls, // subset of decide_calls
    measured: true,
  };
}

// ── decide() integration ────────────────────────────────────────────────────

// (a) Finding-severity scoring. Batch all findings into ONE decide() call.
// Fail closed: transport failure or low confidence → deterministic severity.
export async function scoreFindings(env, findings, decideFn = decide, session = null, { background = false } = {}) {
  if (!findings || !findings.length) return [];
  const questions = {};
  findings.forEach((f, i) => {
    questions[`sev_${i}`] = {
      type: "choice",
      ask: `How severe is this website flaw for a small business losing customers: "${f.title} — ${f.observation}"`,
      options: {
        low: "minor polish, unlikely to cost customers",
        medium: "real friction that likely costs some customers",
        high: "critical flaw that directly loses customers or trust",
      },
    };
    questions[`fact_${i}`] = {
      type: "noul",
      ask: `This finding is a directly measured fact, not an interpretation: "${f.title} — ${f.evidence}"`,
    };
  });
  try {
    const r = await decideFn(env, { text: JSON.stringify(findings.map((f) => ({ title: f.title, observation: f.observation }))) }, questions);
    if (session) addDecideUsage(session, r, { background });
    if (!r || !r.ok) return findings.map((f) => ({ ...f, severitySource: "deterministic" })); // transport failure → deterministic
    return findings.map((f, i) => {
      const sev = r.answers?.[`sev_${i}`];
      const fact = r.answers?.[`fact_${i}`];
      const out = { ...f };
      if (sev && verdict(sev) === "auto" && ["low", "medium", "high"].includes(sev.decision)) {
        out.severity = sev.decision;
        out.severitySource = "decide";
      } else {
        out.severitySource = "deterministic";
        if (sev && verdict(sev) === "review") out.needsReview = true;
      }
      if (fact && verdict(fact) !== "auto") out.needsReview = true;
      return out;
    });
  } catch {
    return findings.map((f) => ({ ...f, severitySource: "deterministic" })); // fail closed
  }
}

// (b) Per-turn close-readiness in PITCH/DEPTH — plus live caller-persona
// detection (Mayor's 11:47 ET spec: match energy — warm/cold/rude/skeptical/
// rushed). One batched decide() call, four questions. Fail closed →
// deterministic defaults; persona keeps its previous value on low confidence.
export async function closeReadiness(env, session, userText, decideFn = decide) {
  const fallback = { closeReady: false, objection: "none", engagement: 50, persona: session.callerPersona || "neutral", source: "deterministic" };
  const history = (session.turns || []).slice(-6).map((t) => `${t.role}: ${t.text}`).join("\n");
  try {
    const r = await decideFn(env, { text: `${history}\ncaller: ${userText}` }, {
      closeReady: { type: "noul", ask: "The caller is ready to be offered the $330 audit now" },
      objection: {
        type: "choice",
        ask: "What is the caller's current stance",
        options: {
          none: "no objection, open or positive",
          price: "pushing back on the $330 price",
          skepticism: "burned before, distrusts agencies or audits",
          timing: "interested but not now",
          authority: "needs to check with someone else",
        },
      },
      engagement: {
        type: "score",
        ask: "How engaged is the caller in this conversation",
        levels: ["Checked out", "Polite", "Curious", "Engaged", "Eager"],
      },
      persona: {
        type: "choice",
        ask: "What best describes the caller's persona on this call",
        options: {
          warm: "friendly, open, receptive",
          cold: "terse, frosty, minimal answers",
          rude: "abrasive, dismissive, hostile",
          skeptical: "doubting, challenging, burned-before energy",
          rushed: "impatient, wants this over fast",
          chatty: "talkative, storytelling, hard to steer",
          guarded: "evasive, withholding, won't share details",
          neutral: "businesslike, none of the above strongly",
        },
      },
    });
    addDecideUsage(session, r); // every invocation counts; tokens only when reported
    if (!r || !r.ok) return fallback;
    const cr = r.answers?.closeReady, ob = r.answers?.objection, en = r.answers?.engagement, pe = r.answers?.persona;
    let persona = fallback.persona;
    if (pe && verdict(pe) === "auto" && pe.decision && CALLER_PERSONAS.includes(pe.decision)) {
      persona = pe.decision;
      session.callerPersona = persona;
    }
    return {
      closeReady: cr && verdict(cr) === "auto" ? !!cr.decision : false,
      objection: ob && verdict(ob) === "auto" && ob.decision ? ob.decision : "none",
      engagement: en && typeof en.decision === "number" ? Math.round(en.decision) : 50,
      persona,
      source: "decide",
    };
  } catch {
    return fallback;
  }
}

// (c) Lightweight persona detection for DISCOVERY/DIAGNOSIS — every 3rd turn,
// so the avatar matches energy before the pitch. Fail closed: keep "neutral".
export async function detectPersona(env, session, userText, decideFn = decide) {
  try {
    const history = (session.turns || []).slice(-4).map((t) => `${t.role}: ${t.text}`).join("\n");
    const r = await decideFn(env, { text: `${history}\ncaller: ${userText}` }, {
      persona: {
        type: "choice",
        ask: "What best describes the caller's persona on this call",
        options: {
          warm: "friendly, open, receptive",
          cold: "terse, frosty, minimal answers",
          rude: "abrasive, dismissive, hostile",
          skeptical: "doubting, challenging, burned-before energy",
          rushed: "impatient, wants this over fast",
          chatty: "talkative, storytelling, hard to steer",
          guarded: "evasive, withholding, won't share details",
          neutral: "businesslike, none of the above strongly",
        },
      },
    });
    const pe = r?.answers?.persona;
    addDecideUsage(session, r); // every invocation counts; tokens only when reported
    if (r?.ok && pe && verdict(pe) === "auto" && pe.decision && CALLER_PERSONAS.includes(pe.decision)) {
      session.callerPersona = pe.decision;
    }
  } catch { /* fail closed: persona stays */ }
  return session.callerPersona || "neutral";
}

// ── reply generation ────────────────────────────────────────────────────────
// LLM drafts the spoken reply inside the guardrailed prompt. Post-generation
// enforcement: length cap, forbidden-phrase scan, no raw URLs. Any violation →
// fail closed to the canned stage script (never emit the bad reply).

function enforceReply(text, fallback) {
  let t = String(text || "").trim().replace(/\s+/g, " ");
  if (!t) return fallback;
  const low = t.toLowerCase();
  if (FORBIDDEN_PHRASES.some((p) => low.includes(p))) return fallback;
  if (/https?:\/\//i.test(t)) return fallback; // never spell URLs on a voice call
  if (t.length > REPLY_CHAR_CAP) {
    const cut = t.slice(0, REPLY_CHAR_CAP);
    const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    t = (lastStop > 120 ? cut.slice(0, lastStop + 1) : cut).trim();
  }
  return t;
}

export async function draftReply(env, session, userText, steer, cannedFallback, deps) {
  const callerFacts = {
    business: session.businessName, category: session.category,
    website: session.url, acquisition: session.acquisition, name: session.contactName,
  };
  const messages = [
    { role: "system", content: buildSystemPrompt({
      stage: session.stage,
      diagnosisSummary: diagnosisSummary(session.signals),
      findings: session.findings,
      callerFacts,
      minutesIn: Math.round(minutesIn(session, deps.nowMs())),
      callerPersona: session.callerPersona || "neutral",
    })},
    ...(session.turns || []).slice(-8).map((t) => ({ role: t.role === "caller" ? "user" : "assistant", content: t.text })),
    { role: "user", content: `Caller just said: "${userText}"\n\nSteer: ${steer}\n\nReply in one or two short spoken sentences. Do not repeat the steer.` },
  ];
  try {
    const r = await deps.chatFn(env, messages);
    addLlmUsage(session, r);
    if (r && r.text) return enforceReply(r.text, cannedFallback);
  } catch { /* fall through to canned */ }
  return cannedFallback;
}

// ── discovery ───────────────────────────────────────────────────────────────
function nextDiscoveryQuestion(session) {
  const answered = {
    category: !!session.category, businessName: !!session.businessName,
    url: !!session.url, acquisition: !!session.acquisition,
  };
  for (const q of DISCOVERY_QUESTIONS) {
    if (!answered[q.key] && !session.askedDiscovery.includes(q.key)) return q;
  }
  return null;
}

// Naive but honest slot-filling from the caller's own words. The URL is the
// only slot parsed structurally — via spokenUrlToUrl (R3: handles "dot com"
// voice speech and letter spell-outs); the rest ride on turn order (the question
// just asked determines the slot). The LLM is never trusted to invent facts.
function fillDiscovery(session, userText) {
  const spoken = spokenUrlToUrl(userText, { spellout: session.spelloutMode });
  if (spoken && !session.url) {
    session.url = spoken;
    if (!session.askedDiscovery.includes("url")) session.askedDiscovery.push("url");
    return "url";
  }
  const lastAsked = session.askedDiscovery[session.askedDiscovery.length - 1];
  const t = userText.trim();
  if (lastAsked === "category" && !session.category && t.length < 80) { session.category = t; return "category"; }
  if (lastAsked === "businessName" && !session.businessName && t.length < 80) { session.businessName = t; return "businessName"; }
  if (lastAsked === "acquisition" && !session.acquisition && t.length < 120) { session.acquisition = t; return "acquisition"; }
  // Fallback: first substantive answer becomes the category if still empty.
  if (!session.category && t.length < 80 && !session.askedDiscovery.includes("category")) {
    session.category = t;
    session.askedDiscovery.push("category");
    return "category";
  }
  return null;
}

// ── R3: proactive mid-call agency — background site analysis ────────────────
// backgroundDiagnose(env, sessionId, url, deps): the avatar takes the business
// URL by voice, then this runs the multi-task analysis live in the background
// WHILE the conversation continues — site fetch (browser UA), signal
// extraction, decide() severity scoring — and injects the findings into the
// session. The next turn's respond() weaves them into the dialogue ("while you
// were talking I had a look at your site…"). Fire-and-forget via waitUntil in
// turn.js; inline (awaited) in simulateTurn. Never blocks the audio path.
// Fail closed: fetch failure → diagnosisStatus="failed" (spell-out fallback,
// then interview mode) — the call NEVER dead-ends.
export async function backgroundDiagnose(env, sessionId, url, deps = {}) {
  const decideFn = deps.decideFn || decide;
  const diagnoseFn = deps.diagnoseFn || diagnoseUrl;
  try {
    const store = deps.store || await import("./assessmentStore.js");
    const loaded = await store.loadSession(env, sessionId);
    if (!loaded || !loaded.state) return { ok: false, error: "session_not_found" };
    const session = loaded.state;
    if (session.outcome || session.diagnosisStatus === "ready") {
      return { ok: true, skipped: true }; // closed call or already diagnosed
    }
    const diag = await diagnoseFn(url);
    session.diagnosisAttempts = (session.diagnosisAttempts || 0) + 1;
    if (diag.ok) {
      session.signals = diag.signals;
      session.findings = await scoreFindings(env, diag.findings, decideFn, session, { background: true });
      session.diagnosisStatus = "ready";
      session.findingsPresented = 0;
      session.pendingDiagnosisUrl = "";
    } else {
      session.diagnosisStatus = "failed";
      session.diagnosisError = diag.error;
    }
    session.bgEvents = session.bgEvents || [];
    session.bgEvents.push({
      at: new Date().toISOString(), kind: "diagnosis",
      summary: diag.ok
        ? `diagnosis_ready:${(session.findings || []).length} findings for ${url}`
        : `diagnosis_failed:${diag.error || "fetch_failed"} (attempt ${session.diagnosisAttempts})`,
    });
    await store.saveSession(env, session);
    return { ok: diag.ok };
  } catch (e) {
    return { ok: false, error: e?.message || "background_diagnose_failed" };
  }
}

// ── D4: real-time background decide() ───────────────────────────────────────
// backgroundScoring(env, sessionId, userText, decideFn, store): fire-and-forget.
// NEVER blocks the audio path: the turn route fires it via waitUntil AFTER the
// reply is sent. It re-loads the session, runs ONE batched decide() call
// (prospect score + next-best-action + persona), merges the results into the
// session, and saves. The NEXT turn's respond() reads them.
// Fail closed: any failure leaves the session untouched.
// Red-team: await this directly, or pass deps.runBackground !== false to
// simulateTurn to run it inline; inspect session.bgEvents for the event log.
export async function backgroundScoring(env, sessionId, userText, decideFn = decide, store = null) {
  const log = (kind, summary) => ({ at: new Date().toISOString(), kind, summary });
  try {
    const st = store || await import("./assessmentStore.js");
    const loaded = await st.loadSession(env, sessionId);
    if (!loaded || !loaded.state) return { ok: false, error: "session_not_found" };
    const session = loaded.state;
    if (session.outcome) return { ok: true, skipped: "closed" }; // call over — nothing to score
    const history = (session.turns || []).slice(-8).map((t) => `${t.role}: ${t.text}`).join("\n");
    const r = await decideFn(env, {
      text: `${history}\ncaller: ${String(userText || "").slice(0, 500)}\n` +
        `facts: ${session.category || "?"} / ${session.businessName || "?"} / findings: ${(session.findings || []).length}`,
    }, {
      prospect: {
        type: "score",
        ask: "How likely is this caller to buy the $330 one-time business audit",
        levels: ["No chance", "Unlikely", "Maybe", "Likely", "Very likely"],
      },
      nextBest: {
        type: "choice",
        ask: "What should the avatar do on the next turn to maximize the chance of selling the audit",
        options: {
          ask_url: "get their website URL now — the live diagnosis is the strongest weapon",
          keep_flow: "continue the current stage normally",
          diagnose_deeper: "surface another measured flaw — they are engaged",
          go_pitch: "pitch the $330 audit NOW — they are hot",
          capture_email: "ask for the email now — lock in the follow-up",
          wrap_up: "they are done — wrap the call cleanly",
        },
      },
      persona: {
        type: "choice",
        ask: "What best describes the caller's persona on this call",
        options: {
          warm: "friendly, open, receptive",
          cold: "terse, frosty, minimal answers",
          rude: "abrasive, dismissive, hostile",
          skeptical: "doubting, challenging, burned-before energy",
          rushed: "impatient, wants this over fast",
          chatty: "talkative, storytelling, hard to steer",
          guarded: "evasive, withholding, won't share details",
          neutral: "businesslike, none of the above strongly",
        },
      },
    });
    addDecideUsage(session, r, { background: true }); // every invocation counts, even failed
    if (!r || !r.ok) return { ok: false, error: "decide_down" };
    const events = [];
    const pr = r.answers?.prospect;
    if (pr && verdict(pr) === "auto" && typeof pr.decision === "number") {
      session.prospectScore = Math.round(pr.decision);
      session.prospectTier = pr.decision >= 70 ? "hot" : pr.decision >= 40 ? "warm" : "cold";
      events.push(log("prospect_scored", `score=${session.prospectScore} tier=${session.prospectTier}`));
    }
    const nb = r.answers?.nextBest;
    if (nb && verdict(nb) === "auto" && nb.decision) {
      session.nextBestAction = nb.decision;
      events.push(log("next_best", nb.decision));
    }
    const pe = r.answers?.persona;
    if (pe && verdict(pe) === "auto" && pe.decision && CALLER_PERSONAS.includes(pe.decision)) {
      if (pe.decision !== session.callerPersona) {
        events.push(log("persona_shift", `${session.callerPersona}→${pe.decision}`));
      }
      session.callerPersona = pe.decision;
    }
    session.personaLog = session.personaLog || [];
    session.personaLog.push({ at: new Date().toISOString(), persona: session.callerPersona, score: session.prospectScore ?? null });
    session.bgEvents = session.bgEvents || [];
    session.bgEvents.push(...events);
    await st.saveSession(env, session);
    return { ok: true, events: events.map((e) => e.summary) };
  } catch (e) {
    return { ok: false, error: e?.message || "background_failed" };
  }
}
export async function respond(env, userText, session, deps = {}) {
  const d = {
    chatFn: deps.chatFn || ((e, messages) => chat({ env: e, messages, max_tokens: 220, temperature: 0.5 })),
    decideFn: deps.decideFn || decide,
    diagnoseFn: deps.diagnoseFn || diagnoseUrl,
    nowMs: deps.nowMs || (() => Date.now()),
  };
  const text = String(userText || "").trim();
  const mins = minutesIn(session, d.nowMs());
  const reply = { replyText: "", actions: [], session };
  session.turns.push({ role: "caller", text: text.slice(0, 500) });

  const say = async (steer, canned) => {
    reply.replyText = await draftReply(env, session, text, steer, canned, d);
    session.turns.push({ role: "avatar", text: reply.replyText });
    return reply;
  };
  const go = (stage) => { session.stage = stage; reply.actions.push({ type: "transition", to: stage }); };

  // Shared objection router (DIAGNOSIS pitch-transition + PITCH): never pitch
  // OVER a live objection — record it, answer it with straight talk, then keep
  // the close moving. Returns the reply when it handled the turn, null when not.
  const routeObjection = async (objection) => {
    if (!objection || objection === "none") return null;
    if (!session.objections.includes(objection)) session.objections.push(objection);
    if (objection === "price") {
      // The price answer IS the pitch (states the $330 offer) — move to PITCH
      // so the email turn books instead of looping.
      go(STAGES.PITCH);
      session.pitchDelivered = true;
      return say("Price objection. Straight talk: name what the audit costs vs. what one lost customer costs them. Restate $330 one-time, all sales final, no subscription. Then ask for the email.",
        PRICE_SCRIPT + " One lost customer costs you more than that. What's the best email — I'll send your personal booking link.");
    }
    if (objection === "skepticism") {
      go(STAGES.PITCH);
      session.pitchDelivered = true;
      return say("They've been burned by agencies. Validate it hard — most agencies sell reports nobody reads. Your edge: you diagnosed their site LIVE in front of them, on this call, for free. That's the proof. Then ask for the email.",
        "I get it — most agencies sell you a PDF nobody reads. Difference is, I just diagnosed your site live, in front of you, for free. That's the product. Give me your email and I'll send the booking link.");
    }
    if (objection === "timing" || objection === "authority") {
      session.outcome = "followup";
      go(STAGES.DEPTH);
      return say("They're not buying today. Don't push — pivot to the follow-up: capture the email for the personal prefilled link, good for 7 days.",
        EMAIL_CAPTURE_SCRIPT);
    }
    return null;
  };

  switch (session.stage) {
    case STAGES.CONSENT: {
      if (YES_RE.test(text)) {
        session.consentGiven = true;
        go(STAGES.OPEN);
        return say("They consented. Deliver the framing script warmly, then ask what kind of business they run.",
          FRAMING_SCRIPT + " So — what kind of business are we talking about?");
      }
      if (NO_RE.test(text) || session.consentRetries >= 1) {
        session.outcome = "declined";
        go(STAGES.WRAP);
        reply.actions.push({ type: "endCall" });
        reply.replyText = CONSENT_DECLINED_SCRIPT;
        session.turns.push({ role: "avatar", text: reply.replyText });
        return reply;
      }
      session.consentRetries++;
      return say("They didn't give a clear yes or no on recording consent. Ask once more, plainly and warmly — you need an explicit yes to continue.",
        "I need a clear yes or no on this one — is it okay if I record and transcribe the call so I can build your assessment? Say yes to continue, or no and we'll wrap up.");
    }

    case STAGES.OPEN: {
      if (session.turns.length <= 6) await detectPersona(env, session, text, d.decideFn);
      go(STAGES.DISCOVERY);
      const q = DISCOVERY_QUESTIONS[0];
      session.askedDiscovery.push(q.key);
      return say("Move into discovery. Ask the first question conversationally.", q.prompt);
    }

    case STAGES.DISCOVERY: {
      const filled = fillDiscovery(session, text);
      // D1: persona detection live in the first 1-2 minutes (awaited, fast),
      // then every 3rd turn; backgroundScoring covers the rest off the audio path.
      if (session.turns.length <= 6 || session.turns.length % 3 === 0) {
        await detectPersona(env, session, text, d.decideFn);
      }
      const emailM = text.match(EMAIL_RE);
      if (emailM && !session.email) { session.email = emailM[1].toLowerCase(); session.emailCaptured = true; }
      // R3: URL captured by voice → fire background analysis and KEEP TALKING.
      // Never block the audio path on the fetch; findings weave in when ready.
      if (filled === "url" && session.diagnosisStatus === "idle") {
        session.diagnosisStatus = "analyzing";
        session.pendingDiagnosisUrl = session.url;
        reply.actions.push({ type: "diagnoseUrl", url: session.url });
      }
      // D4: background next-best-action — the live diagnosis is the strongest
      // weapon, so prioritize getting the URL when the scorer says so.
      let q = nextDiscoveryQuestion(session);
      if (session.nextBestAction === "prioritize_url" && !session.url
          && !session.askedDiscovery.includes("url")) {
        q = DISCOVERY_QUESTIONS.find((qq) => qq.key === "url");
        session.nextBestAction = "keep_flow"; // consumed
      }
      if (q) {
        session.askedDiscovery.push(q.key);
        const steer = filled === "url"
          ? "They just gave their website. Acknowledge it naturally — you're pulling it up in the background while you talk — then ask the next discovery question."
          : `Ask the next discovery question conversationally: ${q.key}.`;
        const canned = filled === "url"
          ? `Got it — I'm pulling up ${session.url.replace(/^https?:\/\//, "").replace(/\/$/, "")} in the background while we talk. ${q.prompt}`
          : q.prompt;
        return say(steer, canned);
      }
      // Discovery exhausted — move to diagnosis (findings may still be analyzing).
      go(STAGES.DIAGNOSIS);
      if (!session.url) session.diagnosisError = "no_url";
      return say("Discovery done. If the site analysis is still running, say so naturally and keep them talking; if there's no URL, diagnose from conversation.",
        session.url
          ? "While my system finishes pulling up your site, tell me this: what's the one thing about getting customers that keeps you up at night?"
          : "No site to pull up — no problem. Tell me this: what's the one thing about getting customers that keeps you up at night?");
    }

    case STAGES.DIAGNOSIS: {
      if (session.turns.length <= 6 || session.turns.length % 3 === 0) {
        await detectPersona(env, session, text, d.decideFn);
      }
      const emailM = text.match(EMAIL_RE);
      if (emailM && !session.email) { session.email = emailM[1].toLowerCase(); session.emailCaptured = true; }

      // R3: spell-out retry — they spelled the domain after a failed fetch.
      if (session.spelloutMode) {
        session.spelloutMode = false;
        const spelled = spokenUrlToUrl(text, { spellout: true }) || spokenUrlToUrl(text);
        if (spelled) { // spelled confirmation counts as a legit retry, even if identical
          session.url = spelled;
          session.urlRetried = true;
          session.diagnosisStatus = "analyzing";
          session.pendingDiagnosisUrl = spelled;
          reply.actions.push({ type: "diagnoseUrl", url: spelled });
          return say("They spelled the domain. Acknowledge warmly — you're pulling it up in the background now — and keep them talking.",
            "Got it, thank you — pulling that up in the background now. While it loads: how are most of your customers finding you these days?");
        }
        // Unparseable spelling → interview mode. Never a dead end.
        session.diagnosisStatus = "interview";
      }

      const dstat = session.diagnosisStatus || "idle";

      // R3: fetch failed → spell-it-out (once), then interview mode.
      if (dstat === "failed") {
        if (!session.spelloutAsked) {
          session.spelloutAsked = true;
          session.spelloutMode = true;
          return say("The site fetch failed. Ask them to spell the domain letter by letter — warm, zero frustration, no tech jargon.",
            SPELL_OUT_SCRIPT);
        }
        session.diagnosisStatus = "interview"; // second failure → interview
      }

      // R3: analysis still running in the background → keep the conversation
      // alive, never stall. After minute 20, stop waiting and interview.
      if ((session.diagnosisStatus || "idle") === "analyzing" && mins < 20) {
        return say("The background site analysis is still running. Keep them talking with a real business question — do NOT mention findings you don't have yet.",
          "My system's still pulling up your site in the background — while it works, paint me a picture: when someone's ready to buy, what's the actual next step they take with you?");
      }
      if (session.diagnosisStatus === "analyzing") session.diagnosisStatus = "interview"; // gave it long enough

      // R3: interview mode — no site, no invented flaws. Diagnose from what
      // they SAY: two sharp funnel questions, then the pitch track.
      if (session.diagnosisStatus === "interview" || (!session.url && (session.diagnosisStatus || "idle") === "idle")) {
        session.interviewQuestions = (session.interviewQuestions || 0) + 1;
        if (session.interviewQuestions >= 3 || mins >= PITCH_BY_MINUTE) {
          go(STAGES.PITCH);
          session.pitchDelivered = true;
          const canned = `So here's the prescription. From everything you've told me, the gaps are in how customers find you and what happens when they do — and that's exactly what our Audit My Business covers: a one-time $${PRODUCT_PRICE} deep dive over your whole funnel, your competitors, and where AI fits in your business. You get a ranked fix list, you own it. No subscription, no retainer, no upsell ambush — all sales final. Want me to lock that in for you?`;
          return say("Interview-mode pitch: tie the $330 audit to what THEY told you (never invented site flaws). Assumptive close.",
            canned);
        }
        const iqs = [
          "When someone's ready to buy — what's the actual next step they take? Call, form, walk in?",
          "And after that first contact — do you follow up, or does it live and die on that one touch?",
          "Last one: do you know, roughly, where your best customers heard about you?",
        ];
        const iq = iqs[Math.min(session.interviewQuestions - 1, iqs.length - 1)];
        return say("Interview mode: one sharp funnel question, conversational. You're diagnosing from their answers, not their site.", iq);
      }

      const remaining = session.findings.slice(session.findingsPresented);
      // R3: weave — findings landed mid-conversation. First one gets the
      // "while you were talking" framing; the rest flow as normal findings.
      const justReady = session.diagnosisStatus === "ready" && session.findingsPresented === 0 && remaining.length > 0;
      // D3: HOT callers get pitched by minute 5 — the background scorer's
      // prospect tier / go_pitch signal short-circuits the finding cadence.
      const hotEarly = (session.prospectTier === "hot" || session.nextBestAction === "go_pitch")
        && mins >= PITCH_EARLIEST_MINUTE && session.findingsPresented >= 1;
      if (hotEarly) session.nextBestAction = "keep_flow"; // consumed
      const pitchDue = hotEarly || mins >= PITCH_BY_MINUTE || session.findingsPresented >= 3;
      if (pitchDue || remaining.length === 0) {
        // Never pitch OVER a live objection: check close-readiness on the
        // transition turn and route the objection first (same as PITCH).
        const cr = await closeReadiness(env, session, text, d.decideFn);
        session.closeReady = cr.closeReady;
        const routed = await routeObjection(cr.objection);
        if (routed) return routed;
        go(STAGES.PITCH);
        session.pitchDelivered = true;
        const top = session.findings.slice(0, 3).map((f) => f.title.toLowerCase()).join(", ");
        const canned = `So here's the prescription. ${top ? `What I just showed you — ${top} — ` : ""}is exactly what our Audit My Business covers: a one-time $${PRODUCT_PRICE} deep dive over your whole funnel, your competitors, and where AI fits in your business. You get a ranked fix list, you own it. No subscription, no retainer, no upsell ambush — all sales final. Want me to lock that in for you?`;
        return say("Deliver the pitch. Tie it directly to the flaws you just diagnosed — the audit is the prescription. State $330 plainly. Then the assumptive close: ask for the email to lock it in.",
          canned);
      }
      const f = remaining[0];
      session.findingsPresented++;
      const weavePrefix = justReady ? "While you were talking I had a look at your site in the background — and something jumped out right away. " : "";
      const canned = `${weavePrefix}${f.observation} ${session.findingsPresented < Math.min(3, session.findings.length) ? "And there's more —" : "Now here's what that means for you —"}`;
      return say(`Present this ONE finding in your own spoken words, one breath: ${f.title}. ${f.observation} Then a light question to keep them talking.`,
        canned);
    }

    case STAGES.PITCH: {
      const hn = hardNo(text);
      if (hn) {
        session.outcome = "declined";
        session.wrapEmailAsked = true; // never pitch email to a caller who said stop/no
        go(STAGES.WRAP);
        reply.actions.push({ type: "endCall" });
        reply.replyText = WRAP_DECLINED_SCRIPT;
        session.turns.push({ role: "avatar", text: reply.replyText });
        return reply;
      }
      const emailM = text.match(EMAIL_RE);
      if (emailM) {
        session.email = emailM[1].toLowerCase();
        session.emailCaptured = true;
        session.outcome = "booked";
        go(STAGES.WRAP);
        reply.actions.push({ type: "captureEmail", email: session.email });
        reply.actions.push({ type: "bookAudit" });
        return say("They're in. Confirm warmly, tell them the booking link is on its way to their email, and wrap.",
          WRAP_BOOKED_SCRIPT);
      }
      const cr = await closeReadiness(env, session, text, d.decideFn);
      session.closeReady = cr.closeReady;
      // Objection handling with straight talk, then back to the close.
      const routed = await routeObjection(cr.objection);
      if (routed) return routed;
      go(STAGES.DEPTH);
      return say("No hard objection. Keep momentum — restate the prescription in one line and ask for the email to lock it in.",
        EMAIL_CAPTURE_SCRIPT);
    }

    case STAGES.DEPTH: {
      const emailM = text.match(EMAIL_RE);
      if (emailM && !session.emailCaptured) {
        session.email = emailM[1].toLowerCase();
        session.emailCaptured = true;
        if (!session.outcome) session.outcome = "followup";
        reply.actions.push({ type: "captureEmail", email: session.email });
        if (!session.followupAsked) {
          session.followupAsked = true;
          return say("Email captured. Now ask the one-question follow-up consent for a single nudge email, with stop anytime.",
            "Got it. " + FOLLOWUP_CONSENT_SCRIPT);
        }
        go(STAGES.WRAP);
        reply.actions.push({ type: "followupQueued" });
        return say("Wrap cleanly — their personal link is on its way, good for 7 days. State what happens next.",
          WRAP_FOLLOWUP_SCRIPT);
      }
      // Follow-up consent answer right after we asked.
      if (session.followupAsked && !session.followupConsent && YES_RE.test(text)) {
        session.followupConsent = true;
        go(STAGES.WRAP);
        reply.actions.push({ type: "followupQueued" });
        return say("They agreed to one follow-up. Wrap cleanly.", WRAP_FOLLOWUP_SCRIPT);
      }
      if (session.followupAsked && !session.followupConsent && NO_RE.test(text)) {
        session.followupConsent = false;
        go(STAGES.WRAP);
        reply.actions.push({ type: "followupQueued" });
        return say("They declined the follow-up — respect it instantly, no guilt. Wrap with just the link email.", WRAP_FOLLOWUP_SCRIPT);
      }
      // Hard-no handling (D3): "stop" exits immediately; other hard nos get one
      // graceful landing, the second one exits. Never begs, never mirrors hostility.
      if (!emailM) {
        const hn = hardNo(text);
        if (hn === "stop" || (hn === "no" && (session.hardNoCount || 0) >= 1)) {
          session.outcome = "declined";
          session.wrapEmailAsked = true; // no email pitch to a caller who said stop/no twice
          go(STAGES.WRAP);
          reply.actions.push({ type: "endCall" });
          reply.replyText = WRAP_DECLINED_SCRIPT;
          session.turns.push({ role: "avatar", text: reply.replyText });
          return reply;
        }
        if (hn === "no") {
          session.hardNoCount = (session.hardNoCount || 0) + 1;
          return say("First hard no. Graceful, zero push — the only soft landing is the free findings email.",
            DECLINED_EMAIL_SCRIPT);
        }
      }
      const cr = await closeReadiness(env, session, text, d.decideFn);
      if (cr.objection && cr.objection !== "none" && !session.objections.includes(cr.objection)) {
        session.objections.push(cr.objection);
      }
      if (cr.objection === "price") {
        return say("Price objection again. One line of straight talk, restate $330 one-time, ask for the email.", PRICE_SCRIPT + " What's the best email for your booking link?");
      }
      if (cr.objection === "skepticism") {
        return say("Skepticism again. Your proof is the live diagnosis — point at one specific flaw you found and how the audit fixes it. Ask for the email.",
          "Look — I found real flaws on your site in about two minutes, live. Imagine what the full audit finds. Email?");
      }
      if (cr.objection === "timing" || cr.objection === "authority") {
        // Not buying today — pivot to the follow-up, never push.
        if (!session.emailCaptured) {
          return say("Timing/authority objection in depth. Don't push — pivot to the follow-up email capture for the personal prefilled link.",
            EMAIL_CAPTURE_SCRIPT);
        }
        session.outcome = "followup";
        go(STAGES.WRAP);
        reply.actions.push({ type: "followupQueued" });
        return say("They're a follow-up — email already in hand. Wrap cleanly.", WRAP_FOLLOWUP_SCRIPT);
      }
      if (/book|yes|let'?s do|sign me up|okay do it/i.test(text) && session.emailCaptured) {
        session.outcome = "booked";
        go(STAGES.WRAP);
        reply.actions.push({ type: "bookAudit" });
        return say("They're booking. Confirm and wrap.", WRAP_BOOKED_SCRIPT);
      }
      // Still talking: one more real finding if any remain, else assumptive close.
      const remaining = session.findings.slice(session.findingsPresented);
      if (remaining.length > 0 && cr.engagement >= 50) {
        const f = remaining[0];
        session.findingsPresented++;
        return say(`Diagnose one more real flaw, spoken: ${f.title}. ${f.observation} Then tie it to the audit and ask for the email.`,
          `${f.observation} The audit maps every one of these and ranks the fixes. What's the best email for your link?`);
      }
      if (session.emailCaptured) {
        session.outcome = "followup";
        go(STAGES.WRAP);
        reply.actions.push({ type: "followupQueued" });
        return say("Wrap it. Their link is coming.", WRAP_FOLLOWUP_SCRIPT);
      }
      return say("Assumptive close — the audit is the obvious next step. Ask for the email.", EMAIL_CAPTURE_SCRIPT);
    }

    case STAGES.WRAP: {
      // D3: email capture ON the call even from non-buyers — value-first ask,
      // part of the sale arc. Only when consent was given (never after a
      // consent decline) and only once; a "no" ends it immediately.
      const wrapEmailM = text.match(EMAIL_RE);
      if (wrapEmailM && !session.emailCaptured) {
        session.email = wrapEmailM[1].toLowerCase();
        session.emailCaptured = true;
        if (session.outcome === "declined") session.outcome = "followup"; // declined+email = follow-up lead
        reply.actions.push({ type: "captureEmail", email: session.email });
        reply.actions.push({ type: "followupQueued" });
        reply.replyText = WRAP_FOLLOWUP_SCRIPT;
        session.turns.push({ role: "avatar", text: reply.replyText });
        return reply;
      }
      if (session.outcome === "declined" && session.consentGiven
          && !session.emailCaptured && !session.wrapEmailAsked) {
        session.wrapEmailAsked = true;
        return say("They declined the audit but the call was civil. Make the soft value-first email ask — free findings list, no pitch attached. If they say no, end warmly.",
          DECLINED_EMAIL_SCRIPT);
      }
      reply.actions.push({ type: "endCall" });
      const canned = session.outcome === "booked" ? WRAP_BOOKED_SCRIPT
        : session.outcome === "declined" ? WRAP_DECLINED_SCRIPT
        : WRAP_FOLLOWUP_SCRIPT;
      reply.replyText = canned;
      session.turns.push({ role: "avatar", text: canned });
      return reply;
    }

    default: {
      go(STAGES.CONSENT);
      reply.replyText = CONSENT_SCRIPT;
      session.turns.push({ role: "avatar", text: CONSENT_SCRIPT });
      return reply;
    }
  }
}

// ── red-team entry point ────────────────────────────────────────────────────
// simulateTurn(session, userText, deps): identical to respond() but without env.
// The red-team crew drives full text conversations through this — stub chatFn,
// decideFn, diagnoseFn, and nowMs in deps for deterministic runs.
//
// Background scoring (D4): in simulation, backgroundScoring runs INLINE (awaited)
// after each turn unless deps.runBackground === false, using an in-memory store
// (no D1). Inspect session.bgEvents for the background decide() event log and
// session.personaLog for the per-call persona classification the red-team needs.
export async function simulateTurn(session, userText, deps = {}) {
  const r = await respond(null, userText, session, deps);
  if (deps.runBackground !== false && typeof deps.decideFn === "function") {
    const memStore = {
      loadSession: async () => ({ state: session }),
      saveSession: async () => {},
    };
    try {
      await backgroundScoring(null, session.id || "sim", userText, deps.decideFn, memStore);
    } catch { /* background never breaks the turn */ }
    // R3: inline the background site analysis too — the next turn weaves it.
    try {
      const diagAction = (r.actions || []).find((a) => a.type === "diagnoseUrl" && a.url);
      if (diagAction) {
        await backgroundDiagnose(null, session.id || "sim", diagAction.url, {
          decideFn: deps.decideFn,
          diagnoseFn: deps.diagnoseFn,
          store: memStore,
        });
      }
    } catch { /* background never breaks the turn */ }
  }
  return r;
}
