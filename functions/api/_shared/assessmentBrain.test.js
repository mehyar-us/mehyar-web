// Unit tests for assessmentBrain.js — state machine, decide() fail-closed,
// reply safety net, persona edge cases.
// Run: node functions/api/_shared/assessmentBrain.test.js
// No network, no LLM — chat/decide/diagnose are stubbed. Exit non-zero on failure.

import {
  newSession, respond, simulateTurn, scoreFindings, closeReadiness, minutesIn,
} from "./assessmentBrain.js";
import { STAGES, FORBIDDEN_PHRASES } from "./assessmentPersona.js";

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

// ── stubs ───────────────────────────────────────────────────────────────────
const FIXTURE_FINDINGS = [
  { id: "no_https", severity: "high", title: "Site not on HTTPS", observation: "Your site loads over plain HTTP.", evidence: "final URL uses http" },
  { id: "no_meta_description", severity: "medium", title: "No meta description", observation: "No meta description on the homepage.", evidence: "meta absent" },
  { id: "no_viewport", severity: "medium", title: "Not mobile-ready", observation: "No mobile viewport tag.", evidence: "viewport absent" },
  { id: "no_schema", severity: "low", title: "No structured data", observation: "No structured data on the page.", evidence: "no ld+json" },
];

// chat stub: canned line per stage; records that it was called.
function stubChat(lines = {}) {
  const fn = async (env, messages) => {
    fn.calls.push(messages);
    const sys = messages[0]?.content || "";
    const m = sys.match(/Current stage: (\w+)/);
    const stage = m ? m[1] : "unknown";
    return { text: lines[stage] || `Canned ${stage} line.` };
  };
  fn.calls = [];
  return fn;
}
// decide stub: transport failure by default (fail-closed path).
const decideDown = async () => ({ ok: false });
const diagnoseStub = async (url) => ({
  ok: true,
  signals: { finalUrl: url, https: false, loadMs: 900, title: "", wordCount: 120 },
  findings: FIXTURE_FINDINGS.map((f) => ({ ...f })),
});
const clockAt = (session, min) => () => Date.parse(session.startedAt) + min * 60000;
const deps = (session, min = 2, chatLines) => ({
  chatFn: stubChat(chatLines), decideFn: decideDown, diagnoseFn: diagnoseStub, nowMs: clockAt(session, min),
});

function fresh() { return newSession(); }

// ── consent gate ────────────────────────────────────────────────────────────
{
  const s = fresh();
  const r = await simulateTurn(s, "yes, that's fine", deps(s));
  eq(s.stage, STAGES.OPEN, "explicit yes → open");
  ok(s.consentGiven, "consent recorded");
  ok(r.replyText.length > 0 && r.replyText.length <= 450, "framing reply short");
}
{
  const s = fresh();
  const r = await simulateTurn(s, "no", deps(s));
  eq(s.outcome, "declined", "no → declined");
  ok(r.actions.some((a) => a.type === "endCall"), "no → endCall action");
  ok(!s.consentGiven, "no consent recorded");
}
{
  const s = fresh();
  await simulateTurn(s, "hmm, what do you mean", deps(s)); // ambiguous → re-ask
  eq(s.stage, STAGES.CONSENT, "ambiguous → still consent");
  const r = await simulateTurn(s, "uhh not sure", deps(s)); // 2nd ambiguous → end
  ok(r.actions.some((a) => a.type === "endCall"), "2x ambiguous → endCall (fail closed: no consent = no call)");
  eq(s.outcome, "declined", "ambiguous consent → declined");
}

// ── discovery → background diagnosis (R3) ───────────────────────────────────
async function driveToDiagnosis() {
  const s = fresh();
  const d = deps(s);
  await simulateTurn(s, "yes", d);                    // consent → open (framing + Q1)
  await simulateTurn(s, "ok", d);                     // open → discovery (ack, not slotted) → Q2
  await simulateTurn(s, "plumbing company", d);       // → Q3 (url)
  // Voice URL capture ("dot com" speech) → background analysis fires, call continues
  const r = await simulateTurn(s, "acmeplumbing dot com", d);
  return { s, r, d };
}
{
  const { s, r } = await driveToDiagnosis();
  eq(s.url, "https://acmeplumbing.com/", "voice URL captured + normalized");
  eq(s.diagnosisStatus, "ready", "background analysis completed inline (simulation)");
  ok(r.actions.some((a) => a.type === "diagnoseUrl"), "diagnoseUrl action emitted (route fires it via waitUntil)");
  eq(s.findings.length, 4, "fixture findings scored in background");
  ok(s.findings.every((f) => f.severitySource === "deterministic"), "decide down → deterministic severity (fail closed)");
  ok((s.bgEvents || []).some((e) => e.kind === "diagnosis"), "diagnosis bg event logged");
  eq(s.stage, STAGES.DISCOVERY, "url turn: analysis runs in background, discovery continues");
  eq(s.diagnosisStatus, "ready", "background analysis completed inline (simulation)");
  ok((s.bgEvents || []).some((e) => e.kind === "diagnosis"), "diagnosis bg event logged");
  // Next turn: findings ready → weave straight to diagnosis, no interrogation
  const d = deps(s);
  const r2 = await simulateTurn(s, "go on", d);
  eq(s.stage, STAGES.DIAGNOSIS, "weave: findings ready → diagnosis with finding #1");
  eq(s.findingsPresented, 1, "weave presents the first finding immediately");
  ok(/while you were talking/i.test(r2.replyText) || /Canned/i.test(r2.replyText),
    "first finding weaves in with background framing");
  // Second finding on the next turn, then the pitch lands on proof (2 findings)
  const r3 = await simulateTurn(s, "go on", d);
  eq(s.findingsPresented, 2, "second finding presented");
  const r4 = await simulateTurn(s, "go on", d);
  eq(s.stage, STAGES.PITCH, "two findings shown → pitch (proof before prescription)");
  ok(s.pitchDelivered, "pitch marked delivered");
}

// ── scoreFindings: decide adopts on auto, keeps deterministic on review ─────
{
  const autoDecide = async (env, state, questions) => {
    const answers = {};
    for (const id of Object.keys(questions)) {
      if (id.startsWith("sev_")) answers[id] = { decision: "low", confidence: 0.97, ok: true };
      else answers[id] = { decision: true, confidence: 0.96, ok: true };
    }
    return { ok: true, answers };
  };
  const out = await scoreFindings(null, FIXTURE_FINDINGS.map((f) => ({ ...f })), autoDecide);
  ok(out.every((f) => f.severity === "low" && f.severitySource === "decide"), "decide auto → severity adopted");
}
{
  const reviewDecide = async (env, state, questions) => {
    const answers = {};
    for (const id of Object.keys(questions)) answers[id] = { decision: "medium", confidence: 0.55, ok: true };
    return { ok: true, answers };
  };
  const out = await scoreFindings(null, FIXTURE_FINDINGS.map((f) => ({ ...f })), reviewDecide);
  ok(out[0].severity === "high" && out[0].needsReview, "low-confidence → deterministic kept + needsReview flag");
}
{
  const out = await scoreFindings(null, FIXTURE_FINDINGS.map((f) => ({ ...f })), decideDown);
  ok(out[0].severity === "high" && out[0].severitySource === "deterministic", "transport down → deterministic severity stamped (fail closed)");
}
{
  const throwing = async () => { throw new Error("net down"); };
  const out = await scoreFindings(null, FIXTURE_FINDINGS.map((f) => ({ ...f })), throwing);
  ok(out.length === 4, "decide throws → findings pass through unchanged");
}

// ── closeReadiness fail-closed ──────────────────────────────────────────────
{
  const s = fresh();
  const cr = await closeReadiness(null, s, "sounds good", decideDown);
  eq(cr, { closeReady: false, objection: "none", engagement: 50, persona: "neutral", source: "deterministic" }, "closeReadiness fail-closed defaults");
}

// ── pitch timing: proof (2 findings) then pitch; minute-15 backstop ─────────
{
  const { s } = await driveToDiagnosis(); // url turn done, analysis ready in bg
  const d0 = deps(s);
  await simulateTurn(s, "go on", d0);      // weave: finding #1
  await simulateTurn(s, "go on", d0);      // finding #2
  const r = await simulateTurn(s, "go on", d0);
  eq(s.stage, STAGES.PITCH, "two findings shown → pitch without waiting for minute 15");
  ok(s.pitchDelivered, "pitch marked delivered");
}
{
  // Backstop: the deadline still fires when proof is slow (no findings yet).
  const s = fresh();
  s.stage = STAGES.DIAGNOSIS; s.consentGiven = true;
  s.diagnosisStatus = "ready"; s.findings = [];
  s.startedAt = new Date(Date.now() - 16 * 60000).toISOString(); // 16 min in
  // LLM throws → canned pitch fallback (the real $330 pitch copy)
  const d = { chatFn: async () => { throw new Error("llm down"); }, decideFn: decideDown, diagnoseFn: diagnoseStub, nowMs: clockAt(s, 16) };
  const r = await simulateTurn(s, "go on", d);
  eq(s.stage, STAGES.PITCH, "minute 16 → pitch (deadline enforced)");
  ok(s.pitchDelivered, "pitch marked delivered");
  ok(/330/.test(r.replyText), "pitch states $330");
}

// ── objection routing: price ────────────────────────────────────────────────
{
  const s = fresh();
  const priceDecide = async (env, state, questions) => {
    if (questions.closeReady) {
      return { ok: true, answers: {
        closeReady: { decision: false, confidence: 0.9, ok: true },
        objection: { decision: "price", confidence: 0.92, ok: true },
        engagement: { decision: 60, confidence: 0.8, ok: true },
        persona: { decision: "neutral", confidence: 0.9, ok: true },
      }};
    }
    return { ok: false };
  };
  const d = { chatFn: stubChat({ pitch: "Canned pitch line.", depth: "Canned depth line." }), decideFn: priceDecide, diagnoseFn: diagnoseStub, nowMs: clockAt(s, 11) };
  s.stage = STAGES.PITCH; s.consentGiven = true; s.findings = FIXTURE_FINDINGS.map((f) => ({ ...f }));
  const r = await simulateTurn(s, "three thirty is too expensive for me", d);
  ok(s.objections.includes("price"), "price objection recorded");
  ok(/330/.test(r.replyText) || r.replyText.includes("Canned"), "price pushback answered");
}

// ── email capture → booked / followup ───────────────────────────────────────
{
  const s = fresh();
  const d = deps(s);
  s.stage = STAGES.PITCH; s.consentGiven = true; s.findings = FIXTURE_FINDINGS.map((f) => ({ ...f }));
  const r = await simulateTurn(s, "ok, my email is bob@acmeplumbing.com", d);
  eq(s.email, "bob@acmeplumbing.com", "email captured + lowercased");
  ok(r.actions.some((a) => a.type === "captureEmail"), "captureEmail action emitted");
  ok(r.actions.some((a) => a.type === "bookAudit"), "bookAudit action emitted");
  eq(s.outcome, "booked", "email at pitch → booked");
}
{
  const s = fresh();
  // chat throws on the capture turn → canned "Got it. <follow-up consent>" copy
  const d = { chatFn: async () => { throw new Error("llm down"); }, decideFn: decideDown, diagnoseFn: diagnoseStub, nowMs: clockAt(s, 20) };
  s.stage = STAGES.DEPTH; s.consentGiven = true;
  const r1 = await simulateTurn(s, "send it to bob@acmeplumbing.com", d);
  ok(r1.actions.some((a) => a.type === "captureEmail"), "depth email capture");
  ok(/follow-up/i.test(r1.replyText) || /stop/i.test(r1.replyText), "follow-up consent asked after capture");
  const r2 = await simulateTurn(s, "yes", d);
  ok(s.followupConsent, "follow-up consent recorded");
  ok(r2.actions.some((a) => a.type === "followupQueued"), "followupQueued action");
  eq(s.stage, STAGES.WRAP, "consent yes → wrap");
  const r3 = await simulateTurn(s, "thanks bye", d);
  ok(r3.actions.some((a) => a.type === "endCall"), "wrap → endCall");
}

// ── reply safety net ────────────────────────────────────────────────────────
{
  const s = fresh();
  const badChat = async () => ({ text: "This is a LIMITED TIME OFFER, act now! Our clients saw huge gains, guaranteed results!" });
  const d = { ...deps(s), chatFn: badChat };
  s.stage = STAGES.DEPTH; s.consentGiven = true;
  const r = await simulateTurn(s, "tell me more", d);
  const low = r.replyText.toLowerCase();
  ok(!FORBIDDEN_PHRASES.some((p) => low.includes(p)), "forbidden phrases never emitted (fail closed to canned)");
}
{
  const s = fresh();
  const urlChat = async () => ({ text: "Go to https://mehyar.us/audit right now to book." });
  const d = { ...deps(s), chatFn: urlChat };
  s.stage = STAGES.DEPTH; s.consentGiven = true;
  const r = await simulateTurn(s, "where do I go", d);
  ok(!/https?:\/\//.test(r.replyText), "raw URLs never spoken (fail closed)");
}
{
  const s = fresh();
  const longChat = async () => ({ text: "Word. ".repeat(200) });
  const d = { ...deps(s), chatFn: longChat };
  s.stage = STAGES.DEPTH; s.consentGiven = true;
  const r = await simulateTurn(s, "go on", d);
  ok(r.replyText.length <= 450, `reply capped at 450 chars (got ${r.replyText.length})`);
}
{
  const s = fresh();
  const deadChat = async () => { throw new Error("llm down"); };
  const d = { ...deps(s), chatFn: deadChat };
  s.stage = STAGES.DEPTH; s.consentGiven = true;
  const r = await simulateTurn(s, "hello?", d);
  ok(r.replyText.length > 10, "LLM down → canned fallback, never silent");
}

// ── diagnosis fetch failure: spell-out → never invent, never dead-end ────────
{
  const s = fresh();
  const failDiag = async () => ({ ok: false, error: "fetch_failed" });
  const d = { ...deps(s), chatFn: async () => { throw new Error("llm down"); }, decideFn: decideDown, diagnoseFn: failDiag };
  await simulateTurn(s, "yes", d);
  await simulateTurn(s, "go", d);
  await simulateTurn(s, "plumbing", d);
  await simulateTurn(s, "Acme", d);
  const rSpell = await simulateTurn(s, "acmeplumbing dot com", d);   // voice URL → bg fails
  eq(s.diagnosisStatus, "failed", "fetch failure recorded, not hidden");
  eq(s.diagnosisAttempts, 1, "attempt counted");
  eq(s.findings.length, 0, "no findings invented on fetch failure");
  eq(s.stage, STAGES.DIAGNOSIS, "fetch failed → diagnosis, no stall");
  // They spell it unprompted; retry succeeds
  const d2 = { ...d, diagnoseFn: diagnoseStub };
  const r2 = await simulateTurn(s, "a c m e p l u m b i n g dot com", d2);
  eq(s.diagnosisStatus, "ready", "spelled URL retried in background → ready");
  ok(r2.actions.some((a) => a.type === "diagnoseUrl"), "retry fires background analysis");
  ok(!s.spelloutMode, "spellout mode cleared");
}
{
  // Spell-out refused → interview mode → pitch (they've invested; never stalls)
  const s = fresh();
  const failDiag = async () => ({ ok: false, error: "fetch_failed" });
  const d = { ...deps(s), chatFn: async () => { throw new Error("llm down"); }, decideFn: decideDown, diagnoseFn: failDiag };
  await simulateTurn(s, "yes", d);
  await simulateTurn(s, "go", d);
  await simulateTurn(s, "plumbing", d);
  await simulateTurn(s, "Acme", d);
  await simulateTurn(s, "acmeplumbing dot com", d);   // → bg fails
  const rAsk = await simulateTurn(s, "word of mouth", d);  // → spell-out ask (failed, didn't spell)
  ok(s.spelloutAsked && s.spelloutMode, "spell-out fallback triggered once");
  ok(/spell/i.test(rAsk.replyText), "avatar asks them to spell the domain");
  const r = await simulateTurn(s, "I'd rather not spell it", d);
  eq(s.diagnosisStatus, "interview", "refused spelling → interview mode");
  eq(s.stage, STAGES.PITCH, "interview after spell-out → pitch, never stalls");
  ok(s.pitchDelivered, "interview pitch delivered");
  ok(!/traffic|revenue|ranking/i.test(r.replyText), "interview never invents site metrics");
}
{
  // Pure interview (no URL ever): two funnel questions, then the pitch
  const s = fresh();
  const d = { ...deps(s), chatFn: async () => { throw new Error("llm down"); } };
  s.stage = STAGES.DIAGNOSIS; s.consentGiven = true; // no url, idle → interview
  const r1 = await simulateTurn(s, "phone calls", d);
  ok(/ready to buy|next step/i.test(r1.replyText), "interview question 1 asked");
  eq(s.stage, STAGES.DIAGNOSIS, "still diagnosing after one answer");
  const r2 = await simulateTurn(s, "my assistant follows up", d);
  eq(s.stage, STAGES.PITCH, "two interview questions → pitch");
  ok(s.pitchDelivered, "pitch delivered");
  ok(!/traffic|revenue|ranking/i.test(r2.replyText), "interview never invents site metrics");
}

// ── simulateTurn does not need env ──────────────────────────────────────────
{
  const s = fresh();
  const r = await simulateTurn(s, "yes", { chatFn: stubChat(), decideFn: decideDown, diagnoseFn: diagnoseStub, nowMs: () => Date.now() });
  ok(r.session === s && typeof r.replyText === "string" && Array.isArray(r.actions), "simulateTurn shape { replyText, actions, session }");
}

// ── minutesIn ───────────────────────────────────────────────────────────────
{
  const s = fresh();
  s.startedAt = new Date(Date.now() - 10 * 60000).toISOString();
  const m = minutesIn(s, Date.now());
  ok(m >= 9.9 && m <= 10.5, `minutesIn ≈ 10 (got ${m.toFixed(2)})`);
}

// ── caller-persona adaptivity (Mayor's 11:47 ET spec) ────────────────────────
{
  const { detectPersona } = await import("./assessmentBrain.js");
  const { buildSystemPrompt, PERSONA_STEER, FORBIDDEN_PHRASES: FP } = await import("./assessmentPersona.js");
  const s = fresh();
  const rushedDecide = async () => ({ ok: true, answers: { persona: { decision: "rushed", confidence: 0.93, ok: true } } });
  const p = await detectPersona(null, s, "yeah yeah let's make this quick I gotta run", rushedDecide);
  eq(p, "rushed", "rushed caller detected");
  eq(s.callerPersona, "rushed", "persona stored on session");
  const p2 = await detectPersona(null, s, "whatever", decideDown);
  eq(p2, "rushed", "decide down → persona keeps previous value (fail closed)");
  const s2 = fresh();
  const p3 = await detectPersona(null, s2, "whatever", decideDown);
  eq(p3, "neutral", "decide down with no prior → neutral");
  const sys = buildSystemPrompt({ stage: "depth", diagnosisSummary: "x", findings: [], callerFacts: {}, minutesIn: 20, callerPersona: "rushed" });
  ok(sys.includes("You are the Mayor"), "identity is the Mayor");
  ok(!/chief of staff/i.test(sys), "chief-of-staff identity removed");
  ok(sys.includes(PERSONA_STEER.rushed), "persona steer injected into prompt");
  for (const phrase of ["as an AI", "i'm an ai", "artificial intelligence", "language model", "ai assistant"]) {
    ok(FP.includes(phrase), `forbidden phrase listed: ${phrase}`);
  }
  ok(sys.includes("NEVER MENTION AI"), "guardrail: never mention AI");
  ok(!/you are an (ai|artificial intelligence|language model)/i.test(sys),
    "system prompt never presents the avatar as AI (guardrail mentions are meta-instructions, not identity)");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
