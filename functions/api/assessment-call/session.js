// POST /api/assessment-call/session
//
// Creates the INFRA voice-call session AFTER explicit UI consent.
// This is the infra crew's session record (lifecycle, 45-min cap, heartbeat,
// rate limits, latency log). The brain crew's conversation session is created
// separately via POST /api/assessment/start — pass its session_id as
// brainSessionId to link the two rows.
//
// Body (JSON):
//   { consent: true, adult: true, brainSessionId?: "<assessment_sessions.id>" }
//
// consent = "I agree this call is recorded and transcribed" (UI checkbox,
// unchecked by default). adult = "I am 18 or older".
// Returns { sessionId, brainSessionId, expiresAt, secondsRemaining, heartbeatSec }.
// The sessionId is a 128-bit opaque secret — possession authorizes heartbeat,
// end, interrupt, turn-complete and delete. Never log it server-side.
//
// Consent model (two layers, both logged):
//   1) UI checkbox here (timestamped consent_at) — required before this call.
//   2) The brain's spoken consent script (first reply_text from /assessment/start,
//      consent stage in the state machine) — the caller confirms by voice.

import {
  reply, sha256Hex, originOk, ipHashOf,
  createSession, checkSessionCreateLimit, checkNeuronGuard,
  CALL_MAX_SECONDS, HEARTBEAT_SECONDS,
} from "./_shared/callShared.js";

export async function onRequestPost({ request, env }) {
  if (!originOk(request)) return reply(403, { message: "Assessment calls are available from MehyarSoft only." });
  if (!env.LEADS_DB || !env.INTAKE_KV) return reply(503, { message: "Assessment calls are not configured here." });

  let body;
  try {
    body = await request.json();
  } catch {
    return reply(400, { message: "Invalid request." });
  }
  // Explicit consent gate — the compliance PII rule. No consent, no session.
  if (body?.consent !== true) return reply(403, { message: "Please agree to call recording and transcription to start." });
  if (body?.adult !== true) return reply(403, { message: "Assessment calls are for adults 18 and older." });

  if (!(await checkNeuronGuard(env)))
    return reply(429, { message: "Call capacity is full right now. Please try again tomorrow." });

  const ipHash = await ipHashOf(request);
  if (!(await checkSessionCreateLimit(env, ipHash)))
    return reply(429, { message: "Too many calls from this connection today. Please try again tomorrow." });

  const ua = request.headers.get("user-agent") || "";
  const uaHash = ua ? await sha256Hex(ua) : null;
  const brainSessionId = typeof body?.brainSessionId === "string" ? body.brainSessionId.slice(0, 64) : null;

  const { id, createdAt } = await createSession(env, { ipHash, uaHash, brainSessionId });
  return reply(200, {
    sessionId: id,
    brainSessionId,
    consentAt: createdAt,
    expiresAt: new Date(Date.parse(createdAt) + CALL_MAX_SECONDS * 1000).toISOString(),
    secondsRemaining: CALL_MAX_SECONDS,
    heartbeatSec: HEARTBEAT_SECONDS,
    message:
      "This call is being recorded and transcribed for your business audit. " +
      "You can end the call or delete the transcript at any time.",
  });
}
