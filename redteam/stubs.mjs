// redteam/stubs.mjs — deterministic test doubles for the red-team matrix.
//
// keywordDecide: mimics decide() classifying from the CALLER's own words (the
// real decide() does this with an LLM; here we test the WIRING: detection path,
// personaLog, objection triggers, scoring events). Triggers scan ONLY the last
// caller line — the avatar's own history must never trip objection triggers.
//
// faithfulChat: renders the brain's steer into a short spoken reply. It never
// invents content: stage replies come from the brain's canned fallbacks, and
// diagnosis replies echo the finding the brain QUOTED IN THE STEER (proving the
// brain→avatar content handoff). It records the persona steer line injected in
// the system prompt so the matrix can score matched-personality.
//
// fixtureFetch: serves redteam/fixtures/*.html per hostname; throws for the
// un-fetchable personas (cold/rude) to exercise spell-out → interview mode.
// rosastrattoria.com is delayed 5.2s to exercise the real "slow" finding.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PERSONA_STEER } from "../functions/api/_shared/assessmentPersona.js";
import { CALLER_PERSONAS } from "../functions/api/_shared/assessmentPersona.js";

const CALLER_STICKY = new Set(CALLER_PERSONAS);

const DIR = path.dirname(fileURLToPath(import.meta.url));

const FIXTURE_DELAY_MS = { "rosastrattoria.com": 5200 };
const UNFETCHABLE = new Set(["salcontracting.com", "vicsautoshop.bizzz"]);

export async function fixtureFetch(url, opts = {}) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (UNFETCHABLE.has(host)) throw new Error("fetch_failed");
  const f = path.join(DIR, "fixtures", `${host}.html`);
  if (!fs.existsSync(f)) throw new Error("fetch_failed");
  const delay = FIXTURE_DELAY_MS[host] || 0;
  if (delay) await new Promise((r) => setTimeout(r, delay));
  const html = fs.readFileSync(f, "utf8");
  const buf = Buffer.from(html, "utf8");
  return {
    status: 200,
    url: `https://${host}/`,
    headers: { get: (k) => (k.toLowerCase() === "content-type" ? "text/html" : null) },
    arrayBuffer: async () => buf,
  };
}

// ── keywordDecide ───────────────────────────────────────────────────────────
// Answers decide() questions from caller text. persona priority:
// rude/skeptical/rushed/guarded keywords → cold (terse) → chatty (long) →
// warm (warm words) → neutral.

function lastCallerLine(stateText) {
  const lines = String(stateText || "").toLowerCase().split("\n").filter((l) => l.startsWith("caller:"));
  return lines.length ? lines[lines.length - 1].slice("caller:".length) : "";
}
function callerLines(stateText, n) {
  return String(stateText || "").toLowerCase().split("\n").filter((l) => l.startsWith("caller:")).slice(-n)
    .map((l) => l.slice("caller:".length));
}

function keywordPersona(text) {
  if (/stupid|idiot|shut up|hurry up|get on with it|whatever|screw|dumb|waste of time/i.test(text)) return "rude";
  if (/burned|scam|prove it|agencies|last (guy|agency|company)|ripped off/i.test(text)) return "skeptical";
  if (/make it quick|in a hurry|gotta (go|run)|between (lunch|rush)|no time|be quick|hurry/i.test(text)) return "rushed";
  if (/rather not|that's private|private|won't say|don't give out|none of your business/i.test(text)) return "guarded";
  return null;
}

function classifyPersona(stateText) {
  const recent4 = callerLines(stateText, 4).join(" | ");
  const all = callerLines(stateText, 40).join(" | ");
  const last = lastCallerLine(stateText);
  const est = (String(stateText || "").match(/established_persona:\s*(\w+)/) || [])[1] || null;
  // (1) strong keyword evidence for a DIFFERENT persona in the recent window.
  // But refusal phrases ("none of your business", "rather not say") are
  // ANSWERS, not personality — they never flip an established persona.
  // Only strong style markers (hostility, hurry, scam-talk) switch mid-call.
  const STRONG_SWITCH = /stupid|idiot|shut up|hurry up|get on with it|screw|dumb|waste of time|burned|scam|prove it|ripped off|make it quick|gotta (go|run)|between (lunch|rush)|no time|be quick|hurry/i;
  const kwRecent = keywordPersona(recent4);
  if (kwRecent && kwRecent !== est) {
    // Guarded is DEFINED by refusals — a withholder emerges from cold/neutral
    // via "rather not"/"don't give out". (But not from rude: a rude refusal
    // is still rude.)
    if (kwRecent === "guarded" && (!est || est === "neutral" || est === "cold")) return kwRecent;
    if (!est || est === "neutral" || STRONG_SWITCH.test(recent4)) return kwRecent;
  }
  // (2) chatty is behavioral and observable: a 35+ word monologue is
  // talkativeness, not warmth — it overrides a sticky "warm".
  if (callerLines(stateText, 40).some((l) => l.split(/\s+/).filter(Boolean).length >= 35)) return "chatty";
  // (2b) guarded is behavioral too: repeated REFUSALS to share (name, URL,
  // details) mark a withholder even when the tone is terse. Two or more
  // distinct refusals override a sticky "cold" — cold is curt, guarded hides.
  const refusals = callerLines(stateText, 40).filter((l) =>
    /rather not|don't give out|won't (say|share)|that's private|rest is private|keep that (to myself|private)/i.test(l)).length;
  if (refusals >= 2) return "guarded";
  // (3) sticky: the established persona holds through terse acks ("ok") and
  // short answers — a single quiet turn is not a personality change
  if (est && est !== "neutral" && CALLER_STICKY.has(est)) return est;
  // (3) keyword evidence anywhere in history persists
  const kwAll = keywordPersona(all);
  if (kwAll) return kwAll;
  // (4) style heuristics anchored in history
  const recent = callerLines(stateText, 3);
  const avgWords = recent.reduce((a, l) => a + l.split(/\s+/).filter(Boolean).length, 0) / Math.max(1, recent.length);
  // Terse throughout + no warmth signals anywhere = cold. (A lone "yeah"/"ok"
  // is still cold when the whole call is terse — it's their personality.)
  // Requires 3+ turns: two short factual answers ("Yes.", "I'm a lawyer.")
  // are concise, not frosty.
  if (recent.length >= 3 && avgWords <= 4
      && !/thanks|love|great|wonderful|excited|awesome|appreciate/i.test(all)) return "cold";
  if (/thanks|love|great|wonderful|excited|awesome|yes!|appreciate/i.test(all)) return "warm";
  return "neutral";
}

function classifyObjection(stateText) {
  const last = lastCallerLine(stateText);
  if (/how much|price|cost|330|expensive|bucks|afford|too much/i.test(last)) return "price";
  if (/burned|scam|prove|last agency|agencies|trust/i.test(last)) return "skepticism";
  if (/later|not now|too busy|gotta (go|run)|no time|timing/i.test(last)) return "timing";
  if (/wife|husband|partner|check with|ask my|board/i.test(last)) return "authority";
  return "none";
}

const PERSONA_SCORE = { warm: 82, cold: 30, rude: 18, skeptical: 58, rushed: 62, chatty: 74, guarded: 42, neutral: 50 };

export function keywordDecide() {
  const fn = async (env, state, questions) => {
    const persona = classifyPersona(state?.text);
    const answers = {};
    for (const qid of Object.keys(questions || {})) {
      if (qid === "persona") answers[qid] = { decision: persona, confidence: 0.9, ok: true };
      else if (qid === "prospect") {
        let score = PERSONA_SCORE[persona] ?? 50;
        if (/let'?s do|sign me up|book it|i'?m in\b/i.test(lastCallerLine(state?.text))) score = 92;
        answers[qid] = { decision: score, confidence: 0.88, ok: true };
      } else if (qid === "nextBest") {
        const last = lastCallerLine(state?.text);
        const nb = /let'?s do|sign me up|book it|i'?m in\b/i.test(last) ? "go_pitch"
          : /@/.test(last) ? "capture_email"
          : /stop|done|leave me alone/i.test(last) ? "wrap_up"
          : "keep_flow";
        answers[qid] = { decision: nb, confidence: 0.88, ok: true };
      } else if (qid === "closeReady") {
        const ready = /let'?s do|sign me up|book it|i'?m in\b|yes,? (let'?s|book|do it)/i.test(lastCallerLine(state?.text));
        answers[qid] = { decision: ready, confidence: 0.9, ok: true };
      } else if (qid === "objection") {
        answers[qid] = { decision: classifyObjection(state?.text), confidence: 0.9, ok: true };
      } else if (qid === "engagement") {
        answers[qid] = { decision: PERSONA_SCORE[persona] ?? 50, confidence: 0.85, ok: true };
      } else if (qid.startsWith("sev_")) {
        answers[qid] = { decision: "medium", confidence: 0.9, ok: true };
      } else {
        answers[qid] = { decision: true, confidence: 0.9, ok: true }; // noul fact-checks → auto
      }
    }
    return { ok: true, answers };
  };
  return fn;
}

// ── faithfulChat ────────────────────────────────────────────────────────────
// Renders the brain's steer. Records per-turn: stage, detected persona steer
// line present in the system prompt, reply length. Diagnosis replies echo the
// finding quoted in the steer (never invented); everything else = the brain's
// canned fallback verbatim.

export function faithfulChat() {
  const log = [];
  const fn = async (env, messages) => {
    const sys = messages?.[0]?.content || "";
    const lastUser = messages?.[messages.length - 1]?.content || "";
    const stageM = sys.match(/Current stage: (\w+)/);
    const personaM = sys.match(/CALLER PERSONA \(detected live\): (\w+)\./);
    const stage = stageM ? stageM[1] : "?";
    const persona = personaM ? personaM[1] : null;
    // The brain quotes the finding it wants presented in the steer.
    const steerFinding = lastUser.match(/Present this ONE finding in your own spoken words, one breath: ([^.]+)\.\s*([^]*?)\s*Then a light question/i)
      || lastUser.match(/Diagnose one more real flaw, spoken: ([^.]+)\.\s*([^]*?)\s*Then tie it/i);
    let text;
    if (steerFinding) {
      const title = steerFinding[1].trim();
      const obs = steerFinding[2].trim().split(/\s+/).slice(0, 45).join(" ");
      text = `Real talk — ${title}: ${obs}`;
    } else {
      // Fall back to the brain's canned line: extract from the steer tail is
      // unreliable, so we re-derive: the brain passes cannedFallback only via
      // draftReply — not visible here. Use a stage-appropriate short line that
      // carries NO facts (the matrix scores facts from steer echo + actions).
      text = null;
    }
    log.push({ stage, persona, hadSteerFinding: !!steerFinding });
    return { text, __log: log, __sys: sys, __lastUser: lastUser };
  };
  fn.log = log;
  return fn;
}

// NOTE: faithfulChat can't see the brain's canned fallback (draftReply doesn't
// pass it through chatFn). The matrix therefore wraps draftReply: we patch at
// the respond() level instead — see harness: chatStub returns null and the
// harness falls back... Actually simpler: faithfulChat returns { text: null }
// and draftReply's enforceReply falls back to canned — wait, enforceReply(null)
// returns fallback. But then we lose the steer-finding echo. Resolution: the
// harness monkey-patches is ugly. Better: faithfulChat returns the steer echo
// when a finding is quoted, else returns a SENTINEL "__CANNED__" and the
// harness wraps chatFn to substitute the real canned text.
//
// Cleanest: implement the wrap in harness.mjs — wrapChat(chatFn, getCanned)
// where getCanned is captured by patching draftReply? draftReply is imported
// from assessmentBrain — we can't intercept its canned arg without editing the
// brain. Alternative: harness replicates enforceReply's fallback by re-running
// the stage logic? No.
//
// Pragmatic call: edit NOTHING in the brain for the harness. Instead the stub
// chat returns text:null when there's no steer finding, and draftReply will
// then use the canned fallback itself (enforceReply(null→fallback)). The stub
// just needs to return { text: null } — draftReply handles it: addLlmUsage
// counts the call, r.text falsy → returns cannedFallback. The turn log still
// records stage/persona. The steer-finding echo path returns real text. This
// works with zero brain changes.
export function faithfulChatFinal() {
  const log = [];
  const fn = async (env, messages) => {
    const sys = messages?.[0]?.content || "";
    const lastUser = messages?.[messages.length - 1]?.content || "";
    const stageM = sys.match(/Current stage: (\w+)/);
    const personaM = sys.match(/CALLER PERSONA \(detected live\): (\w+)\./);
    const steerLine = personaM ? PERSONA_STEER[personaM[1]] || null : null;
    const steerFinding = lastUser.match(/Present this ONE finding in your own spoken words, one breath: ([^.]+)\.\s*([\s\S]*?)\s*Then a light question/i)
      || lastUser.match(/Diagnose one more real flaw, spoken: ([^.]+)\.\s*([\s\S]*?)\s*Then tie it/i);
    let text = null; // null → draftReply uses the brain's canned fallback verbatim
    if (steerFinding) {
      const title = steerFinding[1].trim();
      const obs = steerFinding[2].trim().split(/\s+/).slice(0, 42).join(" ");
      text = `Real talk — ${title}: ${obs}`;
    }
    log.push({ stage: stageM ? stageM[1] : "?", persona: personaM ? personaM[1] : null, steerLine, echo: !!steerFinding });
    return { text };
  };
  fn.log = log;
  return fn;
}

export { PERSONA_STEER };
