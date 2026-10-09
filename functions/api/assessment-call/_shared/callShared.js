// /functions/api/assessment-call/_shared/callShared.js
//
// Shared core for the assessment-call INFRA session layer.
// PIVOT 2026-10-09: the voice team (fb19eba4) owns WebRTC transport, STT/TTS,
// the <=1s latency budget and turn-taking. The brain crew owns the
// conversation (functions/api/assessment/* + assessment_sessions).
// THIS module owns: infra session lifecycle, IP rate limits, the daily
// neuron guard, and the per-turn latency log.
//
// Turn flow (post-pivot):
//   voice transport -> transcript -> POST /api/assessment/turn (brain crew)
//     -> reply_text -> voice transport speaks (their TTS, their budget)
//   adapter -> POST /api/assessment-call/turn-complete (latency log, ours)

import { validateMayorWave } from "../../explore-voice.js";

export const CALL_MAX_SECONDS = 45 * 60;   // hard session cap (backstop)
export const HEARTBEAT_SECONDS = 30;
export const TURN_MAX_PER_SESSION = 120;   // sanity cap on logged turns
export const DAILY_NEURON_GUARD = 8000;    // stop new sessions before the 10k cap
export const SESSIONS_PER_IP_PER_DAY = 5;
export const NEURONS_BRAIN_PER_MTOK_IN = 8182; // @cf/cloudflare/clef-flash
// Unit-economics rates (official Workers AI pricing, 2026-10-09):
export const USD_PER_NEURON = 0.011 / 1000;
export const NEURONS_GPT_OSS_120B_IN_PER_MTOK = 31818;   // brain crew's LLM
export const NEURONS_GPT_OSS_120B_OUT_PER_MTOK = 68182;
export const NEURONS_DECIDE_PER_MTOK = 8182;             // clef-flash (input; output unlisted — same rate assumed)
// Voice-team STT/TTS defaults (official list; overridden by their reported usage):
export const NEURONS_WHISPER_PER_MIN = 46.63;
export const NEURONS_MELOTTS_PER_MIN = 18.63;
export const NEURONS_AURA2_PER_KCHAR = 2727.27;
export const NEURONS_NOVA3_PER_MIN = 472.73;

export const reply = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...(status === 429 ? { "retry-after": "60" } : {}),
    },
  });

export const nowIso = () => new Date().toISOString();

export async function sha256Hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((n) => n.toString(16).padStart(2, "0")).join("");
}

export function randomId() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b).map((n) => n.toString(16).padStart(2, "0")).join("");
}

// Origin gate shared with explore-voice: only first-party callers.
export function originOk(request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  return (
    ["mehyar.us", "www.mehyar.us", "localhost", "127.0.0.1"].includes(url.hostname) &&
    (!origin || origin === url.origin)
  );
}

// ── sessions ──────────────────────────────────────────────────────────────

export async function getSession(env, id) {
  if (!id || typeof id !== "string" || !/^[0-9a-f]{32}$/.test(id)) return null;
  return env.LEADS_DB.prepare("SELECT * FROM assessment_call_sessions WHERE id = ?").bind(id).first();
}

export async function createSession(env, { ipHash, uaHash, brainSessionId }) {
  const id = randomId();
  const now = nowIso();
  await env.LEADS_DB.prepare(
    `INSERT INTO assessment_call_sessions
       (id, brain_session_id, ip_hash, user_agent_hash, consent_at, status, last_heartbeat_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
  ).bind(id, brainSessionId || null, ipHash, uaHash || null, now, now, now).run();
  return { id, createdAt: now };
}

export function sessionExpired(session) {
  return Date.now() - Date.parse(session.created_at) > CALL_MAX_SECONDS * 1000;
}

export async function markSession(env, id, status) {
  await env.LEADS_DB.prepare(
    "UPDATE assessment_call_sessions SET status = ?, ended_at = ? WHERE id = ?"
  ).bind(status, nowIso(), id).run();
}

// Returns {ok} or {ok:false, status, message}. Marks timed_out on expiry.
export async function requireActiveSession(env, id) {
  const session = await getSession(env, id);
  if (!session) return { ok: false, status: 404, message: "Call session not found." };
  if (session.status === "deleted") return { ok: false, status: 410, message: "This call was deleted." };
  if (session.status !== "active") return { ok: false, status: 410, message: "This call has ended." };
  if (sessionExpired(session)) {
    await markSession(env, id, "timed_out");
    return { ok: false, status: 410, message: "The 45-minute call limit was reached." };
  }
  return { ok: true, session };
}

export function secondsRemaining(session) {
  return Math.max(0, Math.floor(CALL_MAX_SECONDS - (Date.now() - Date.parse(session.created_at)) / 1000));
}

// ── rate limits (hash-only; INTAKE_KV) ─────────────────────────────────────

export async function ipHashOf(request) {
  return sha256Hex(request.headers.get("cf-connecting-ip") || "local");
}

export async function checkSessionCreateLimit(env, ipHash) {
  const day = Math.floor(Date.now() / 86400000);
  const key = `call:sessions:day:${day}:${ipHash}`;
  const count = Number((await env.INTAKE_KV.get(key)) || 0);
  if (count >= SESSIONS_PER_IP_PER_DAY) return false;
  await env.INTAKE_KV.put(key, String(count + 1), { expirationTtl: 172800 });
  return true;
}

// Global daily neuron guard — the free-tier circuit breaker (admission only).
export async function checkNeuronGuard(env) {
  const day = Math.floor(Date.now() / 86400000);
  const key = `call:neurons:day:${day}`;
  const used = Number((await env.INTAKE_KV.get(key)) || 0);
  return used < DAILY_NEURON_GUARD;
}

export async function addNeurons(env, sessionId, neurons) {
  const day = Math.floor(Date.now() / 86400000);
  const key = `call:neurons:day:${day}`;
  const used = Number((await env.INTAKE_KV.get(key)) || 0);
  await env.INTAKE_KV.put(key, String(used + neurons), { expirationTtl: 172800 });
  await env.LEADS_DB.prepare(
    "UPDATE assessment_call_sessions SET neurons_est = neurons_est + ? WHERE id = ?"
  ).bind(neurons, sessionId).run();
}

// Rough brain-input-token estimate for the neuron guard (~4 chars/token).
// Our per-call AI cost is brain-only now (voice team owns STT/TTS).
export function estimateBrainNeurons(userText, replyText) {
  const tokens = Math.ceil((String(userText).length + String(replyText).length + 1200) / 4);
  return (tokens / 1e6) * NEURONS_BRAIN_PER_MTOK_IN;
}

// ── unit economics ────────────────────────────────────────────────────────
// Per-call cost rollup for Mayor's pricing rethink. Sources:
//   - brain usage: reported by the brain crew's /assessment/turn `usage`
//     object (see docs/assessment-call-contract.md) — REAL when present,
//     else estimated from text lengths (labeled estimate).
//   - STT/TTS usage: reported by the voice team (see NEEDS list item 11) —
//     official list-price defaults until they report actuals.
//   - infra compute: Workers requests are unmetered here; ~40 requests/call
//     against the 100k/day free tier ≈ $0 — labeled estimate.
// usage = { llmInputTokens?, llmOutputTokens?, llmModel?, decideCalls?,
//           decideInputTokens?, sttSeconds?, sttNeuronsPerMin?, ttsChars?,
//           ttsNeuronsPerKChar?, ttsSeconds?, ttsNeuronsPerMin? }
// Returns { neurons, usd, merged } and persists the rollup.
export function costNeurons(usage = {}) {
  const u = usage || {};
  const brainIn = Number(u.llmInputTokens) || 0;
  const brainOut = Number(u.llmOutputTokens) || 0;
  // decide() calls ride clef-flash; count them separately when reported.
  const decideIn = Number(u.decideInputTokens) || 0;
  const decideCalls = Number(u.decideCalls) || 0;
  const sttN = ((Number(u.sttSeconds) || 0) / 60) * (Number(u.sttNeuronsPerMin) || NEURONS_WHISPER_PER_MIN);
  const ttsN =
    ((Number(u.ttsChars) || 0) / 1000) * (Number(u.ttsNeuronsPerKChar) || NEURONS_AURA2_PER_KCHAR) +
    ((Number(u.ttsSeconds) || 0) / 60) * (Number(u.ttsNeuronsPerMin) || NEURONS_MELOTTS_PER_MIN);
  const neurons =
    (brainIn / 1e6) * NEURONS_GPT_OSS_120B_IN_PER_MTOK +
    (brainOut / 1e6) * NEURONS_GPT_OSS_120B_OUT_PER_MTOK +
    (decideIn / 1e6) * NEURONS_DECIDE_PER_MTOK +
    sttN + ttsN;
  return { neurons, usd: neurons * USD_PER_NEURON, decideCalls };
}

export async function rollupUsage(env, sessionId, usage = {}) {
  const row = await env.LEADS_DB.prepare(
    "SELECT usage_json, cost_usd_est, neurons_est FROM assessment_call_sessions WHERE id = ?"
  ).bind(sessionId).first();
  if (!row) return null;
  let merged = {};
  try { merged = JSON.parse(row.usage_json || "{}"); } catch {}
  const u = usage || {};
  // Accumulate counters; keep latest scalar reports.
  for (const k of ["llmInputTokens", "llmOutputTokens", "decideCalls", "decideInputTokens", "sttSeconds", "ttsChars", "ttsSeconds"]) {
    const v = Number(u[k]);
    if (Number.isFinite(v) && v >= 0) merged[k] = (Number(merged[k]) || 0) + v;
  }
  for (const k of ["llmModel", "sttModel", "ttsModel", "sttNeuronsPerMin", "ttsNeuronsPerKChar", "ttsNeuronsPerMin"]) {
    if (u[k] !== undefined && u[k] !== null) merged[k] = u[k];
  }
  // estimated=true until the brain reports real tokens; once real, stays real.
  // An explicit boolean from the caller (e.g. turn-complete's honest fallback) wins.
  if (typeof u.estimated === "boolean") merged.estimated = u.estimated && merged.estimated !== false;
  else if (Number(u.llmInputTokens) > 0) merged.estimated = false;
  else if (merged.estimated === undefined) merged.estimated = true;
  const { neurons, usd } = costNeurons(merged);
  merged.neuronsEst = Math.round(neurons * 100) / 100;
  merged.usdEst = Math.round(usd * 100000) / 100000;
  await env.LEADS_DB.prepare(
    "UPDATE assessment_call_sessions SET usage_json = ?, cost_usd_est = ?, neurons_est = ? WHERE id = ?"
  ).bind(JSON.stringify(merged), merged.usdEst, merged.neuronsEst, sessionId).run();
  // Keep the daily guard honest: add this rollup's delta to the KV counter.
  if (env.INTAKE_KV && merged.neuronsEst > (Number(row.neurons_est) || 0)) {
    const day = Math.floor(Date.now() / 86400000);
    const key = `call:neurons:day:${day}`;
    const used = Number((await env.INTAKE_KV.get(key)) || 0);
    await env.INTAKE_KV.put(key, String(used + (merged.neuronsEst - (Number(row.neurons_est) || 0))), { expirationTtl: 172800 });
  }
  return merged;
}

// ── latency log ───────────────────────────────────────────────────────────
// Field ownership (frozen in docs/voice-adapter-contract.md):
//   stt_ms   speech-end -> final transcript        (voice team, client-measured)
//   ttt_ms   transcript-final -> first reply byte  (adapter-measured)
//   brain_ms brain server time, when reported      (brain crew, optional)
//   tts_ms   first reply byte -> first audible     (voice team, client-measured)

const TIMING_COLS = ["stt_ms", "ttt_ms", "brain_ms", "tts_ms"];

export async function appendTurn(env, { sessionId, seq, role, text, timing }) {
  const t = timing || {};
  await env.LEADS_DB.prepare(
    `INSERT INTO assessment_call_turns
       (id, session_id, seq, role, text, stt_ms, ttt_ms, brain_ms, tts_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    randomId(), sessionId, seq, role, text,
    t.sttMs ?? null, t.tttMs ?? null, t.brainMs ?? null, t.ttsMs ?? null,
    nowIso()
  ).run();
  await env.LEADS_DB.prepare(
    "UPDATE assessment_call_sessions SET turn_count = turn_count + 1, last_heartbeat_at = ? WHERE id = ?"
  ).bind(nowIso(), sessionId).run();
}

// Fill in latency fields reported after the fact (turn-complete).
// timings: [{ seq, sttMs?, tttMs?, brainMs?, ttsMs? }]
export async function applyTimings(env, sessionId, timings) {
  for (const t of timings || []) {
    if (!t || typeof t !== "object") continue;
    const seq = Number(t.seq);
    if (!Number.isInteger(seq) || seq < 1) continue;
    const sets = [];
    const vals = [];
    for (const [col, key] of [["stt_ms", "sttMs"], ["ttt_ms", "tttMs"], ["brain_ms", "brainMs"], ["tts_ms", "ttsMs"]]) {
      const v = Number(t[key]);
      if (Number.isFinite(v) && v >= 0 && v <= 3600000) {
        sets.push(`${col} = COALESCE(?, ${col})`);
        vals.push(Math.round(v));
      }
    }
    if (!sets.length) continue;
    await env.LEADS_DB.prepare(
      `UPDATE assessment_call_turns SET ${sets.join(", ")} WHERE session_id = ? AND seq = ?`
    ).bind(...vals, sessionId, seq).run();
  }
}

export { validateMayorWave };
export { TIMING_COLS };

// R1 booking mechanics: WITHDRAWN 2026-10-09 ~13:00 ET. The brain crew built
// the post-payment booking system themselves on this branch (commit 01c155e:
// functions/api/assessment/booking-{availability,confirm,decline,status}.js,
// functions/api/_shared/assessmentBooking.js, migrations/
// 0042_assessment_bookings.sql, book-followup slot flow) — request/hold/
// approve-decline/status mechanics, manual Mayor approval, office hours, and
// the Google Calendar template-link seam. Building our parallel
// assessment_call_booking_requests system would have duplicated it, so it was
// removed before ever being committed. See docs/assessment-call-infra.md.
