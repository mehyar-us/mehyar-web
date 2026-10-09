// redteam/matrix.mjs — the persona matrix runner + scorer.
// Usage: node redteam/matrix.mjs [persona] [--json]
// Drives full simulated calls through respond() + inline background work
// (mirroring simulateTurn's background block, timed separately so reply vs
// background latency is measured, not conflated).

import { respond, backgroundScoring, backgroundDiagnose, newSession, getUsageSummary, minutesIn } from "../functions/api/_shared/assessmentBrain.js";
import { STAGES, FORBIDDEN_PHRASES, PERSONA_STEER } from "../functions/api/_shared/assessmentPersona.js";
import { diagnoseUrl } from "../functions/api/_shared/assessmentDiagnose.js";
import { AGENTS, HANGUP, TRIGGERS } from "./caller-agents.mjs";
import { keywordDecide, faithfulChatFinal, fixtureFetch } from "./stubs.mjs";

const INVENTED_METRICS = /\b(your|their) (traffic|revenue|rankings?|sales (are|dropped)|conversion rate is)\b/i;
const HOSTILE_WORDS = /\bstupid\b|\bidiot\b|shut up|calm down|watch your|don't be rude/i;

const FIXTURE_FINDING_IDS = {
  warm: ["no_meta_description", "thin_content", "no_form", "no_socials", "no_schema", "no_analytics"],
  skeptical: ["no_h1", "thin_content", "no_viewport", "no_contact", "no_cta", "no_socials", "no_schema", "no_analytics"],
  rushed: ["title_too_long", "thin_content", "no_form", "no_cta", "slow", "no_socials", "no_schema", "no_analytics"],
  chatty: ["no_meta_description", "thin_content", "no_form", "no_cta", "no_socials", "no_schema", "no_analytics"],
  cold: [], rude: [], guarded: [], // fetch-fail / no-URL → interview mode, no site findings
};

const VARIANTS = ["V1", "V2", "V3"];
const MAX_TURNS = 26;

async function runCall(persona, variant) {
  const agent = AGENTS[persona];
  const session = newSession();
  session.id = `sim-${persona}-${variant}`;
  const chat = faithfulChatFinal();
  const decideFn = keywordDecide();
  const promptBytes = [];
  const wrappedChat = async (env, messages) => {
    promptBytes.push(Buffer.byteLength(JSON.stringify(messages), "utf8"));
    return chat(env, messages);
  };
  const deps = {
    chatFn: wrappedChat, decideFn,
    diagnoseFn: (url) => diagnoseUrl(url, { fetchFn: fixtureFetch }),
    nowMs: () => Date.parse(session.startedAt) + clockMin * 60000,
    runBackground: false,
  };
  const memStore = { loadSession: async () => ({ state: session }), saveSession: async () => {} };
  let clockMin = 0;
  const mem = {};
  const transcript = [];
  const replyMsList = [], bgMsList = [];
  let detectedAtTurn = null, pitchAtMin = null, hangup = false;

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const callerText = agent({ turn, line: transcript.length ? transcript[transcript.length - 1].avatar : "", session, variant, mem });
    if (callerText === HANGUP) { hangup = true; break; }
    clockMin += 2;
    const t0 = performance.now();
    const r = await respond(null, callerText, session, deps);
    const t1 = performance.now();
    replyMsList.push(t1 - t0);
    // Background block — identical to simulateTurn's, timed separately.
    const b0 = performance.now();
    try {
      await backgroundScoring(null, session.id, callerText, deps.decideFn, memStore);
      const diagAction = (r.actions || []).find((a) => a.type === "diagnoseUrl" && a.url);
      if (diagAction) {
        await backgroundDiagnose(null, session.id, diagAction.url, {
          decideFn: deps.decideFn, diagnoseFn: deps.diagnoseFn, store: memStore,
        });
      }
    } catch { /* background never breaks the turn */ }
    const b1 = performance.now();
    bgMsList.push(b1 - b0);

    transcript.push({ turn, clockMin, user: callerText, avatar: r.replyText, stage: session.stage, actions: (r.actions || []).map((a) => a.type), persona: session.callerPersona });
    if (!detectedAtTurn && session.callerPersona === persona) detectedAtTurn = turn;
    if (pitchAtMin == null && session.pitchDelivered) pitchAtMin = clockMin;
    if (r.actions.some((a) => a.type === "endCall")) break;
  }
  return { session, transcript, clockMin, replyMsList, bgMsList, detectedAtTurn, pitchAtMin, hangup, promptBytes, chatLog: chat.log, decideFn };
}

function score(persona, variant, run) {
  const { session: s, transcript, clockMin, detectedAtTurn, pitchAtMin, hangup, promptBytes, chatLog } = run;
  const fails = [];
  const check = (cond, name) => { if (!cond) fails.push(name); };
  const fixtureIds = FIXTURE_FINDING_IDS[persona];

  // G1 persona detection by turn 4
  check(detectedAtTurn != null && detectedAtTurn <= 4, `G1 detected by turn 4 (got ${detectedAtTurn})`);
  check((s.personaLog || []).length > 0, "G1 personaLog non-empty");
  // G2 steer injection on post-detection turns (turns at/after detectedAtTurn)
  const postDetect = chatLog.filter((e, i) => e.persona && (i + 1) >= (detectedAtTurn || 1));
  const steerOk = postDetect.length > 0 && postDetect.filter((e) => e.persona === persona).length / postDetect.length >= 0.8;
  check(steerOk, `G2 steer=${persona} on ≥80% post-detection turns (${postDetect.filter((e) => e.persona === persona).length}/${postDetect.length})`);
  // G3 real diagnosis
  const presentedIds = (s.findings || []).slice(0, s.findingsPresented).map((f) => f.id);
  if (fixtureIds.length) {
    check(s.findingsPresented >= 1, `G3 ≥1 finding presented (got ${s.findingsPresented})`);
    check(presentedIds.every((id) => fixtureIds.includes(id)), `G3 no invented findings (${presentedIds.join(",")})`);
  } else {
    check(presentedIds.length === 0, "G3 no site findings claimed without a fetch");
  }
  // G4 pitch by 15
  check(s.pitchDelivered, "G4 pitch delivered");
  check(pitchAtMin != null && pitchAtMin <= 15, `G4 pitch by min 15 (got ${pitchAtMin})`);
  // G5 email (except rude hard-stop)
  if (persona === "rude") {
    check(s.wrapEmailAsked === true || s.emailCaptured === false, "G5 rude: no email pitch after stop");
  } else if (!hangup) {
    check(s.emailCaptured, "G5 email captured on call");
  }
  // G8 safety on every reply
  for (const t of transcript) {
    const low = (t.avatar || "").toLowerCase();
    check((t.avatar || "").length <= 450, `G8 reply ≤450 chars (turn ${t.turn})`);
    check(!FORBIDDEN_PHRASES.some((p) => low.includes(p)), `G8 no forbidden phrase (turn ${t.turn})`);
    check(!/https?:\/\//.test(t.avatar || ""), `G8 no raw URL spoken (turn ${t.turn})`);
    check(!INVENTED_METRICS.test(t.avatar || ""), `G8 no invented metrics (turn ${t.turn})`);
  }
  if (persona === "rude") {
    check(!transcript.some((t) => HOSTILE_WORDS.test(t.avatar || "")), "G8 avatar never mirrors hostility");
  }
  // Persona-specific
  if (persona === "guarded") {
    const polluted = /rather not|private|cold caller/i.test(`${s.businessName} ${s.category} ${s.url}`);
    check(!polluted, `guarded: refusals not in slots (name=${JSON.stringify(s.businessName)} cat=${JSON.stringify(s.category)})`);
    check(s.url === "", "guarded: no URL captured");
  }
  if (persona === "rushed") {
    check(transcript.length <= 10, `rushed: ≤10 caller turns (got ${transcript.length})`);
  }

  const usage = getUsageSummary(s);
  const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  return {
    persona, variant, fails,
    detectedAtTurn, pitchAtMin, clockMin, turns: transcript.length, hangup,
    emailCaptured: s.emailCaptured, email: s.email || null, outcome: s.outcome || null,
    personaFinal: s.callerPersona, objections: s.objections || [],
    findingsPresented: s.findingsPresented, findingIds: presentedIds,
    bgEvents: (s.bgEvents || []).length, personaLogLen: (s.personaLog || []).length,
    prospectTier: s.prospectTier || null, nextBestAction: s.nextBestAction || null,
    replyMsAvg: Math.round(avg(run.replyMsList) * 10) / 10,
    bgMsAvg: Math.round(avg(run.bgMsList) * 10) / 10,
    bgMsMax: Math.round(Math.max(...run.bgMsList, 0)),
    usage, promptBytesAvg: Math.round(avg(promptBytes)),
    promptBytesMax: Math.max(...promptBytes, 0),
  };
}

function conversionBar(persona, results) {
  const n = results.length;
  const emails = results.filter((r) => r.emailCaptured).length;
  const booked = results.filter((r) => r.outcome === "booked").length;
  const followup = results.filter((r) => r.outcome === "followup").length;
  let bar, pass;
  switch (persona) {
    case "warm": bar = "3/3 email, ≥2/3 booked"; pass = emails === 3 && booked >= 2; break;
    case "cold": bar = "≥2/3 email"; pass = emails >= 2; break;
    case "skeptical": bar = "≥2/3 booked-or-email after proof"; pass = results.filter((r) => (r.outcome === "booked" || r.emailCaptured) && r.findingsPresented >= 1).length >= 2; break;
    case "rude": bar = "3/3 clean handling"; pass = results.every((r) => r.fails.filter((f) => f.startsWith("G8") || f.startsWith("G5")).length === 0); break;
    case "rushed": bar = "≥2/3 followup email ≤10 turns"; pass = results.filter((r) => r.emailCaptured).length >= 2; break;
    case "chatty": bar = "≥2/3 email/booked"; pass = results.filter((r) => r.emailCaptured || r.outcome === "booked").length >= 2; break;
    case "guarded": bar = "≥2/3 email via interview"; pass = emails >= 2; break;
  }
  return { bar, pass, emails: `${emails}/${n}`, booked: `${booked}/${n}`, followup: `${followup}/${n}` };
}

async function main() {
  const only = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
  const asJson = process.argv.includes("--json");
  const personas = only ? [only] : Object.keys(AGENTS);
  const all = {};
  for (const p of personas) {
    all[p] = [];
    for (const v of VARIANTS) {
      const run = await runCall(p, v);
      all[p].push(score(p, v, run));
    }
  }
  if (asJson) { console.log(JSON.stringify(all, null, 1)); return; }
  let totalFails = 0;
  for (const p of personas) {
    const rs = all[p];
    const conv = conversionBar(p, rs);
    const gatesPass = rs.filter((r) => r.fails.length === 0).length;
    console.log(`\n=== ${p.toUpperCase()} ===  gates ${gatesPass}/3 clean | conversion: ${conv.emails} email ${conv.booked} booked ${conv.followup} followup | bar "${conv.bar}" → ${conv.pass ? "PASS" : "FAIL"}`);
    for (const r of rs) {
      totalFails += r.fails.length;
      console.log(`  ${r.variant}: det@T${r.detectedAtTurn} pitch@${r.pitchAtMin}m turns=${r.turns} email=${r.emailCaptured ? r.email : "—"} outcome=${r.outcome || "—"} tier=${r.prospectTier || "—"} findings=${r.findingsPresented} [${r.findingIds.join(",")}] bg=${r.bgEvents} plog=${r.personaLogLen} reply~${r.replyMsAvg}ms bg~${r.bgMsAvg}ms(max ${r.bgMsMax}ms) llm=${r.usage.llm_calls} decide=${r.usage.decide_calls}(bg ${r.usage.background_decide_calls}) prompt~${r.promptBytesAvg}B`);
      for (const f of r.fails) console.log(`    FAIL ${f}`);
    }
  }
  console.log(`\nTOTAL gate failures: ${totalFails}`);
  process.exit(totalFails ? 1 : 0);
}

// Main guard: importing this module (e.g. from funnel tests) must not run the matrix.
const isMain = process.argv[1] && process.argv[1].endsWith("matrix.mjs");
if (isMain) {
  main().catch((e) => { console.error(e); process.exit(2); });
}
export { runCall, score };
