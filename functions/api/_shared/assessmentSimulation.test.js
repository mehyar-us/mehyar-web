// Integration: full simulated text conversations via simulateTurn().
// Three skeptical business-owner personas, driven turn by turn like the
// red-team crew will. Asserts: consent gate, live diagnosis of REAL findings,
// pitch by minute 15, short speakable replies, no forbidden phrases, no
// invented business metrics, email capture, persona adaptivity logged.
// Run: node functions/api/_shared/assessmentSimulation.test.js

import { newSession, simulateTurn } from "./assessmentBrain.js";
import { STAGES, FORBIDDEN_PHRASES } from "./assessmentPersona.js";

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) passed++;
  else { failed++; console.error(`FAIL ${name}`); }
}

const INVENTED_METRICS = /\b(your|their) (traffic|revenue|rankings?|sales (are|dropped)|conversion rate is)\b/i;

const FIXTURE_FINDINGS = [
  { id: "no_https", severity: "high", title: "Site not on HTTPS", observation: "Your site loads over plain HTTP, not HTTPS.", evidence: "final URL uses http" },
  { id: "no_meta_description", severity: "medium", title: "No meta description", observation: "No meta description on the homepage.", evidence: "meta absent" },
  { id: "no_contact", severity: "high", title: "No way to reach you", observation: "No phone, contact page, or form found.", evidence: "0 contact signals" },
  { id: "no_viewport", severity: "medium", title: "Not mobile-ready", observation: "No mobile viewport tag.", evidence: "viewport absent" },
];

// Scripted stub chat: stage-aware canned lines (short, speakable). The point of
// this test is the STATE MACHINE + safety nets, not LLM quality.
function scriptedChat() {
  const lines = {
    consent: "Canned consent line.",
    open: "Canned framing line.",
    discovery: "Canned discovery line.",
    diagnosis: "Canned diagnosis line.",
    pitch: "Canned pitch line for the $330 audit.",
    depth: "Canned depth line.",
    wrap: "Canned wrap line.",
  };
  const fn = async (env, messages) => {
    const sys = messages[0]?.content || "";
    const m = sys.match(/Current stage: (\w+)/);
    fn.stages.push(m ? m[1] : "?");
    return { text: lines[m?.[1]] || "Canned." };
  };
  fn.stages = [];
  return fn;
}

// decide stub with persona-aware answers driven by keyword triggers.
// IMPORTANT: triggers scan ONLY the caller's latest line — the avatar's own
// history (e.g. its "$330" pitch line) must never trip the objection triggers.
function personaDecide(persona, objection = "none") {
  return async (env, state, questions) => {
    const lastCaller = (state?.text || "").toLowerCase().split("\n")
      .filter((l) => l.startsWith("caller:")).pop() || "";
    const answers = {};
    for (const qid of Object.keys(questions)) {
      if (qid === "persona") answers[qid] = { decision: persona, confidence: 0.93, ok: true };
      else if (qid === "prospect") answers[qid] = { decision: 78, confidence: 0.9, ok: true };
      else if (qid === "nextBest") answers[qid] = { decision: "keep_flow", confidence: 0.9, ok: true };
      else if (qid === "closeReady") answers[qid] = { decision: false, confidence: 0.9, ok: true };
      else if (qid === "objection") {
        const trig = /burned|scam|agencies/.test(lastCaller) ? "skepticism"
          : /expensive|cost|330/.test(lastCaller) ? "price"
          : /later|busy|not now/.test(lastCaller) ? "timing" : objection;
        answers[qid] = { decision: trig, confidence: 0.92, ok: true };
      }
      else if (qid.startsWith("sev_")) answers[qid] = { decision: "medium", confidence: 0.9, ok: true };
      else answers[qid] = { decision: true, confidence: 0.9, ok: true };
    }
    return { ok: true, answers };
  };
}

const diagnoseStub = async (url) => ({
  ok: true,
  signals: { finalUrl: "https://" + url.replace(/^https?:\/\//, ""), https: false, loadMs: 900 },
  findings: FIXTURE_FINDINGS.map((f) => ({ ...f })),
});

async function runCall(script, { persona, decide }) {
  const s = newSession();
  let clockMin = 0;
  const deps = {
    chatFn: scriptedChat(), decideFn: decide, diagnoseFn: diagnoseStub,
    nowMs: () => Date.parse(s.startedAt) + clockMin * 60000,
  };
  const transcript = [];
  for (const userText of script) {
    clockMin += 2; // ~2 min per exchange on a voice call
    const r = await simulateTurn(s, userText, deps);
    transcript.push({ user: userText, avatar: r.replyText, stage: s.stage, actions: r.actions.map((a) => a.type) });
    // safety-net assertions on EVERY reply
    if (r.replyText) {
      if (r.replyText.length > 450) { failed++; console.error(`FAIL reply >450 chars @${s.stage}: ${r.replyText.slice(0, 80)}…`); }
      else passed++;
      const low = r.replyText.toLowerCase();
      if (FORBIDDEN_PHRASES.some((p) => low.includes(p))) { failed++; console.error(`FAIL forbidden phrase @${s.stage}: ${r.replyText}`); }
      else passed++;
      if (INVENTED_METRICS.test(r.replyText)) { failed++; console.error(`FAIL invented metric @${s.stage}: ${r.replyText}`); }
      else passed++;
      if (/https?:\/\//.test(r.replyText)) { failed++; console.error(`FAIL raw URL spoken @${s.stage}`); }
      else passed++;
    }
    if (r.actions.some((a) => a.type === "endCall")) break;
  }
  return { session: s, transcript, clockMin };
}

// ── Persona 1: plumber burned by agencies (skeptical → proof → email) ───────
{
  const { session: s, transcript, clockMin } = await runCall([
    "yes",
    "yeah ok",
    "I'm a plumber",
    "Acme Plumbing",
    "acmeplumbing.com",
    "word of mouth mostly",
    "uh huh",
    "I've been burned by agencies before, you guys are all the same",
    "ok that's actually real, I checked",
    "fine, it's bob@acmeplumbing.com",
  ], { persona: "skeptical", decide: personaDecide("skeptical") });
  ok(s.consentGiven, "[plumber] consent captured");
  ok(s.diagnosisStatus === "ready" && s.findings.length === 4, "[plumber] live diagnosis ran with real findings");
  ok(s.findings.every((f) => FIXTURE_FINDINGS.some((x) => x.id === f.id)), "[plumber] no invented findings");
  ok(s.pitchDelivered, "[plumber] pitch delivered");
  ok(clockMin <= 30, `[plumber] pitch by minute 15 (call clock ${clockMin})`);
  eq2(s.email, "bob@acmeplumbing.com", "[plumber] email captured on the call");
  ok(s.outcome === "booked" || s.outcome === "followup", `[plumber] outcome=${s.outcome}`);
  ok(s.callerPersona === "skeptical", "[plumber] persona classified");
  ok((s.personaLog || []).length > 0, "[plumber] personaLog for red-team");
  ok((s.bgEvents || []).length > 0, "[plumber] background decide events fired");
  function eq2(a, e, n) { if (a === e) passed++; else { failed++; console.error(`FAIL ${n}: got ${a}`); } }
}

// ── Persona 2: busy restaurant owner (rushed → timing → followup email) ──────
{
  const { session: s } = await runCall([
    "yes yes",
    "make it quick",
    "restaurant",
    "Luigi's",
    "luigis-nyc.com",
    "foot traffic",
    "ok",
    "go on",
    "not now, I'm too busy",          // timing objection while in PITCH
    "maria@luigis-nyc.com",
    "no",                              // declines the nudge — respected
  ], { persona: "rushed", decide: personaDecide("rushed", "none") });
  ok(s.callerPersona === "rushed", "[restaurant] rushed detected");
  ok(s.pitchDelivered, "[restaurant] pitch still delivered to a rushed caller");
  eq3(s.email, "maria@luigis-nyc.com", "[restaurant] email captured");
  eq3(s.outcome, "followup", "[restaurant] timing objection → followup, not forced");
  eq3(s.followupConsent, false, "[restaurant] follow-up no respected instantly");
  function eq3(a, e, n) { if (a === e) passed++; else { failed++; console.error(`FAIL ${n}: got ${a}`); } }
}

// ── Persona 3: cautious e-commerce operator (guarded → price → books) ────────
{
  const { session: s } = await runCall([
    "yes",
    "ok",
    "I sell things online",
    "I'd rather not say the name yet",
    "shop-example.com",
    "ads",
    "hmm",
    "330 is a lot for an audit",
    "alright, dan@shop-example.com",
  ], { persona: "guarded", decide: personaDecide("guarded", "price") });
  ok(s.callerPersona === "guarded", "[ecom] guarded detected");
  ok(s.objections.includes("price"), "[ecom] price objection routed");
  eq4(s.email, "dan@shop-example.com", "[ecom] email captured after price handling");
  function eq4(a, e, n) { if (a === e) passed++; else { failed++; console.error(`FAIL ${n}: got ${a}`); } }
}

// ── Persona 4: rude caller (unflappable, exits clean on "stop") ───────────────
{
  const { session: s, transcript } = await runCall([
    "yeah whatever",
    "get on with it",
    "plumbing",
    "Acme",
    "acmeplumbing.com",
    "none of your business",
    "this is stupid",
    "whatever",
    "stop",                            // hard stop → immediate clean exit
  ], { persona: "rude", decide: personaDecide("rude") });
  ok(s.callerPersona === "rude", "[rude] rude detected");
  const bad = transcript.filter((t) => /stupid|idiot|shut up/i.test(t.avatar));
  ok(bad.length === 0, "[rude] avatar never mirrors hostility");
  eq5(s.outcome, "declined", "[rude] stop → declined, clean exit");
  ok(transcript[transcript.length - 1].actions.includes("endCall"), "[rude] endCall on stop");
  ok(s.wrapEmailAsked, "[rude] no email pitch after stop (respect)");
  function eq5(a, e, n) { if (a === e) passed++; else { failed++; console.error(`FAIL ${n}: got ${a}`); } }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
