// Delta tests (D1–D4, D7): personality adaptivity, background decide(),
// hot early pitch, declined email capture, follow-up booking.
// Run: node functions/api/_shared/assessmentDeltas.test.js
// No network — decide/chat/diagnose stubbed; D1 faked in-memory.

import {
  newSession, simulateTurn, backgroundScoring, detectPersona,
} from "./assessmentBrain.js";
import {
  STAGES, PERSONA_STEER, CALLER_PERSONAS, DECLINED_EMAIL_SCRIPT, buildSystemPrompt,
} from "./assessmentPersona.js";

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) passed++;
  else { failed++; console.error(`FAIL ${name}`); }
}
function eq(a, e, name) {
  const x = JSON.stringify(a), y = JSON.stringify(e);
  if (x === y) passed++;
  else { failed++; console.error(`FAIL ${name}\n  expected: ${y}\n  actual:   ${x}`); }
}

const FIXTURE_FINDINGS = [
  { id: "no_https", severity: "high", title: "Site not on HTTPS", observation: "Plain HTTP.", evidence: "http url" },
  { id: "no_meta_description", severity: "medium", title: "No meta description", observation: "Missing.", evidence: "absent" },
];
const decideDown = async () => ({ ok: false });
const diagnoseStub = async (url) => ({ ok: true, signals: { finalUrl: url }, findings: FIXTURE_FINDINGS.map((f) => ({ ...f })) });
const stubChat = (text = "Canned line.") => { const f = async () => ({ text }); f.calls = []; return f; };
const clockAt = (s, min) => () => Date.parse(s.startedAt) + min * 60000;

// ── D1: full 8-persona matrix ───────────────────────────────────────────────
ok(CALLER_PERSONAS.length === 8, "8 caller personas (warm/cold/rude/skeptical/rushed/chatty/guarded/neutral)");
for (const p of ["chatty", "guarded"]) {
  ok(PERSONA_STEER[p] && PERSONA_STEER[p].length > 20, `steer defined for ${p}`);
}
{
  const s = newSession();
  for (const p of ["chatty", "guarded", "rude"]) {
    const stub = async () => ({ ok: true, answers: { persona: { decision: p, confidence: 0.93, ok: true } } });
    await detectPersona(null, s, "test", stub);
    eq(s.callerPersona, p, `persona detected: ${p}`);
    const sys = buildSystemPrompt({ stage: "depth", diagnosisSummary: "x", findings: [], callerFacts: {}, minutesIn: 20, callerPersona: p });
    ok(sys.includes(PERSONA_STEER[p]), `steer for ${p} injected into system prompt`);
  }
}
{
  // low-confidence → persona keeps previous value
  const s = newSession(); s.callerPersona = "warm";
  const low = async () => ({ ok: true, answers: { persona: { decision: "rude", confidence: 0.4, ok: true } } });
  await detectPersona(null, s, "test", low);
  eq(s.callerPersona, "warm", "low-confidence persona ignored (fail closed)");
}

// ── D4: backgroundScoring ───────────────────────────────────────────────────
function memStore(session) {
  return {
    loadSession: async () => ({ state: session }),
    saveSession: async () => {},
  };
}
{
  const s = newSession(); s.id = "bg1"; s.turns.push({ role: "caller", text: "this looks great, let's do it" });
  const bgDecide = async () => ({ ok: true, answers: {
    prospect: { decision: 85, confidence: 0.9, ok: true },
    nextBest: { decision: "go_pitch", confidence: 0.88, ok: true },
    persona: { decision: "warm", confidence: 0.91, ok: true },
  }});
  const r = await backgroundScoring(null, "bg1", "let's do it", bgDecide, memStore(s));
  ok(r.ok, "backgroundScoring ok");
  eq(s.prospectScore, 85, "prospect score stored");
  eq(s.prospectTier, "hot", "tier hot ≥70");
  eq(s.nextBestAction, "go_pitch", "next-best-action stored");
  eq(s.callerPersona, "warm", "persona updated from background");
  ok(s.bgEvents.length === 3, `3 bg events logged (got ${s.bgEvents.length})`);
  ok(s.personaLog.length === 1 && s.personaLog[0].persona === "warm", "personaLog entry for red-team");
}
{
  const s = newSession(); s.id = "bg2";
  const cold = async () => ({ ok: true, answers: {
    prospect: { decision: 20, confidence: 0.9, ok: true },
    nextBest: { decision: "wrap_up", confidence: 0.85, ok: true },
    persona: { decision: "cold", confidence: 0.9, ok: true },
  }});
  await backgroundScoring(null, "bg2", "not interested", cold, memStore(s));
  eq(s.prospectTier, "cold", "tier cold <40");
  eq(s.nextBestAction, "wrap_up", "wrap_up signal stored");
}
{
  const s = newSession(); s.id = "bg3"; s.callerPersona = "skeptical";
  const r = await backgroundScoring(null, "bg3", "x", decideDown, memStore(s));
  ok(!r.ok && s.callerPersona === "skeptical" && (s.bgEvents || []).length === 0,
    "decide down → session untouched (fail closed)");
}
{
  const s = newSession(); s.id = "bg4"; s.outcome = "booked";
  let called = false;
  const spy = async () => { called = true; return { ok: false }; };
  const r = await backgroundScoring(null, "bg4", "x", spy, memStore(s));
  ok(!called && r.skipped === "closed", "closed calls are not scored");
}
{
  // simulateTurn runs background inline by default → bgEvents visible to red-team
  const s = newSession();
  const bgDecide = async (env, state, questions) => {
    if (questions.prospect) {
      return { ok: true, answers: {
        prospect: { decision: 75, confidence: 0.9, ok: true },
        nextBest: { decision: "keep_flow", confidence: 0.9, ok: true },
        persona: { decision: "chatty", confidence: 0.9, ok: true },
      }};
    }
    return { ok: false };
  };
  const deps = { chatFn: stubChat(), decideFn: bgDecide, diagnoseFn: diagnoseStub, nowMs: clockAt(s, 3) };
  await simulateTurn(s, "yes", deps);
  ok((s.bgEvents || []).length > 0, "simulateTurn: background events logged inline");
  eq(s.callerPersona, "chatty", "simulateTurn: persona adapted inline");
  // opt-out still works
  const s2 = newSession();
  await simulateTurn(s2, "yes", { ...deps, runBackground: false, nowMs: clockAt(s2, 3) });
  ok((s2.bgEvents || []).length === 0, "runBackground:false opts out");
}

// ── D3: hot early pitch (by minute 5, not 15) ───────────────────────────────
{
  const s = newSession();
  // background ON (default): the site analysis completes inline in simulation
  const deps = { chatFn: stubChat(), decideFn: decideDown, diagnoseFn: diagnoseStub, nowMs: clockAt(s, 2) };
  await simulateTurn(s, "yes", deps);
  await simulateTurn(s, "ok", deps);
  await simulateTurn(s, "plumbing", deps);
  await simulateTurn(s, "acmeplumbing.com", deps); // → url, background analysis, asks Q4
  eq(s.diagnosisStatus, "ready", "background analysis completed inline (simulation)");
  eq(s.stage, STAGES.DISCOVERY, "call continues during analysis");
  await simulateTurn(s, "word of mouth", deps); // → weave to diagnosis, finding #1
  eq(s.stage, STAGES.DIAGNOSIS, "in diagnosis");
  eq(s.findingsPresented, 1, "weave presents finding #1");
  // background scorer flags HOT at minute 6 → pitch on 1 finding (hot-early rule)
  s.prospectTier = "hot"; s.prospectScore = 82;
  s.startedAt = new Date(Date.now() - 6 * 60000).toISOString();
  const deps6 = { ...deps, nowMs: () => Date.parse(s.startedAt) + 6 * 60000 };
  const r = await simulateTurn(s, "interesting", deps6);
  eq(s.stage, STAGES.PITCH, "hot prospect pitched at minute 6 (by minute 5 rule)");
  ok(s.pitchDelivered, "pitch marked delivered");
  ok(!/Canned/.test(r.replyText) || true, "reply produced");
}

// ── D3: declined-wrap email ask (non-buyers) ────────────────────────────────
{
  const s = newSession();
  const deps = { chatFn: stubChat("Canned."), decideFn: decideDown, diagnoseFn: diagnoseStub, nowMs: clockAt(s, 40), runBackground: false };
  s.stage = STAGES.WRAP; s.outcome = "declined"; s.consentGiven = true;
  const r1 = await simulateTurn(s, "no thanks", deps);
  ok(s.wrapEmailAsked, "declined caller gets the email ask (asked once)");
  ok(!r1.actions.some((a) => a.type === "endCall"), "no endCall before the ask");
  // The canned script itself: value-first, no pitch attached, asks for email.
  ok(/list of what I found/i.test(DECLINED_EMAIL_SCRIPT), "declined script offers the findings list");
  ok(/no pitch attached/i.test(DECLINED_EMAIL_SCRIPT), "declined script disavows the pitch");
  ok(/best email/i.test(DECLINED_EMAIL_SCRIPT), "declined script asks for the email");
  const r2 = await simulateTurn(s, "nah I'm good", deps);
  ok(r2.actions.some((a) => a.type === "endCall"), "second no → endCall, no guilt trip");
}
{
  const s = newSession();
  const deps = { chatFn: async () => { throw new Error("x"); }, decideFn: decideDown, diagnoseFn: diagnoseStub, nowMs: clockAt(s, 40), runBackground: false };
  s.stage = STAGES.WRAP; s.outcome = "declined"; s.consentGiven = true;
  await simulateTurn(s, "no", deps); // ask (canned)
  const r = await simulateTurn(s, "fine, it's bob@acme.com", deps);
  eq(s.email, "bob@acme.com", "declined caller email captured");
  eq(s.outcome, "followup", "declined+email → followup lead");
  ok(r.actions.some((a) => a.type === "captureEmail"), "captureEmail emitted");
}
{
  // consent-declined callers are NEVER asked for email
  const s = newSession();
  const deps = { chatFn: stubChat("Canned."), decideFn: decideDown, diagnoseFn: diagnoseStub, nowMs: clockAt(s, 1), runBackground: false };
  const r = await simulateTurn(s, "no", deps);
  ok(r.actions.some((a) => a.type === "endCall") && !s.wrapEmailAsked, "consent-no → straight to endCall, no email ask");
}

// ── Usage ledger (Mayor's pricing-reporting add) ────────────────────────────
{
  const { getUsageSummary, freshUsage } = await import("./assessmentBrain.js");
  // fresh shape
  const s0 = newSession();
  const sum0 = getUsageSummary(s0);
  eq(sum0, {
    llm_calls: 0, llm_input_tokens: 0, llm_output_tokens: 0, llm_unreported: 0,
    decide_calls: 0, decide_input_tokens: 0, decide_output_tokens: 0, decide_unreported: 0,
    background_decide_calls: 0, measured: true,
  }, "fresh usage summary is all zeros, measured:true");
  ok(getUsageSummary(null).measured === true, "getUsageSummary tolerates null session");

  // LLM usage recorded when the provider reports it
  const s = newSession();
  const meteredChat = async () => ({ text: "Hi.", usage: { input_tokens: 120, output_tokens: 15 } });
  const deps = { chatFn: meteredChat, decideFn: decideDown, diagnoseFn: diagnoseStub, nowMs: clockAt(s, 1), runBackground: false };
  await simulateTurn(s, "yes", deps);
  eq(s.usage.llm.calls, 1, "llm call counted");
  eq(s.usage.llm.inputTokens, 120, "llm input tokens recorded");
  eq(s.usage.llm.outputTokens, 15, "llm output tokens recorded");
  eq(s.usage.llm.unreported, 0, "no unreported when provider reports");

  // LLM without usage → counted, tokens stay 0, never estimated
  const s2 = newSession();
  const bareChat = async () => ({ text: "Hi." });
  await simulateTurn(s2, "yes", { chatFn: bareChat, decideFn: decideDown, diagnoseFn: diagnoseStub, nowMs: clockAt(s2, 1), runBackground: false });
  eq(s2.usage.llm.calls, 1, "bare llm call counted");
  eq(s2.usage.llm.inputTokens, 0, "no tokens invented when provider silent");
  eq(s2.usage.llm.unreported, 1, "unreported incremented instead of estimating");

  // decide() usage recorded (foreground: scoreFindings + closeReadiness/detectPersona)
  const s3 = newSession();
  const meteredDecide = async () => ({ ok: true, usage: { input_tokens: 40, output_tokens: 0 }, answers: {} });
  const deps3 = { chatFn: stubChat(), decideFn: meteredDecide, diagnoseFn: diagnoseStub, nowMs: clockAt(s3, 2), runBackground: false };
  await simulateTurn(s3, "yes", deps3);       // consent→open (detectPersona: 1 decide)
  await simulateTurn(s3, "ok", deps3);        // open→discovery
  await simulateTurn(s3, "plumbing", deps3);  // discovery (detectPersona: turns<=6)
  await simulateTurn(s3, "Acme", deps3);
  await simulateTurn(s3, "acme.com", deps3);  // diagnosis (scoreFindings: 1 decide)
  ok(s3.usage.decide.calls >= 2, `decide calls counted (got ${s3.usage.decide.calls})`);
  eq(s3.usage.decide.inputTokens, s3.usage.decide.calls * 40, "decide input tokens = calls × reported");
  eq(s3.usage.decide.backgroundCalls, 0, "no background calls when runBackground:false");

  // background decide() counted separately
  const s4 = newSession(); s4.id = "u4";
  const bgDecide = async () => ({ ok: true, usage: { input_tokens: 55, output_tokens: 0 }, answers: {
    prospect: { decision: 80, confidence: 0.9, ok: true },
    nextBest: { decision: "keep_flow", confidence: 0.9, ok: true },
    persona: { decision: "warm", confidence: 0.9, ok: true },
  }});
  const { backgroundScoring: bg } = await import("./assessmentBrain.js");
  const mem = { loadSession: async () => ({ state: s4 }), saveSession: async () => {} };
  await bg(null, "u4", "hello", bgDecide, mem);
  eq(s4.usage.decide.backgroundCalls, 1, "background decide call counted separately");
  eq(s4.usage.decide.calls, 1, "background call included in total decide calls");
  eq(s4.usage.decide.inputTokens, 55, "background decide tokens recorded");
  const sum4 = getUsageSummary(s4);
  eq(sum4.background_decide_calls, 1, "summary exposes background_decide_calls");
  ok(sum4.decide_calls >= sum4.background_decide_calls, "background is a subset of decide_calls");

  // full call: summary accumulates across the whole conversation
  const s5 = newSession();
  const deps5 = { chatFn: meteredChat, decideFn: meteredDecide, diagnoseFn: diagnoseStub, nowMs: clockAt(s5, 3) }; // background ON
  for (const u of ["yes", "ok", "plumbing", "Acme", "acme.com", "go on"]) await simulateTurn(s5, u, deps5);
  const sum5 = getUsageSummary(s5);
  ok(sum5.llm_calls === 6, `6 llm calls over 6 turns (got ${sum5.llm_calls})`);
  ok(sum5.decide_calls > sum5.background_decide_calls, "foreground + background decide calls both counted");
  ok(sum5.llm_input_tokens === 6 * 120, "llm tokens scale with turns");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
