// POST /api/assessment-call/turn-complete
//
// Per-turn latency log aggregation (infra crew stores; voice stack supplies).
// Called by the call adapter after each spoken reply finishes.
//
// Body (JSON):
//   {
//     "sessionId": "<infra session id>",
 //     "userText": "…",            // caller transcript (persisted)
//     "replyText": "…",            // assistant reply (persisted)
//     "timings": { "sttMs": 320, "tttMs": 610, "brainMs": 540, "ttsMs": 180 },
//     "usage": { "llmInputTokens": 412, "llmOutputTokens": 96, "decideCalls": 1,
//                "stt": { "model": "@cf/deepgram/flux", "audioMinutes": 4.2, "neurons": 2940 },
//                "tts": { "model": "@cf/deepgram/aura-1", "chars": 180, "neurons": 245 },
//                "turn": { "model": "@cf/pipecat-ai/smart-turn-v2", "audioMinutes": 6.5, "neurons": 3 } }
//              // cost rollup (optional). Voice legs use the FROZEN shape from
//              // docs/voice-adapter-answers.md §11 — actual neurons verbatim,
//              // never list-price estimates.
//   }
//
// Field ownership (frozen in docs/voice-adapter-contract.md):
//   stt_ms   speech-end -> final transcript        (voice team, client-measured)
//   ttt_ms   transcript-final -> first reply byte  (adapter-measured)
//   brain_ms brain server time, when reported      (brain crew, optional)
//   tts_ms   first reply byte -> first audible     (voice team, client-measured)
// Appends the user + assistant turn rows (text only — audio never stored)
// and rolls the usage into the session's cost record (usage_json/cost_usd_est).

import {
  reply, originOk, requireActiveSession, secondsRemaining,
  appendTurn, rollupUsage, TURN_MAX_PER_SESSION,
} from "./_shared/callShared.js";

export async function onRequestPost({ request, env }) {
  if (!originOk(request)) return reply(403, { message: "Assessment calls are available from MehyarSoft only." });
  if (!env.LEADS_DB) return reply(503, { message: "Assessment calls are not configured here." });

  let body;
  try {
    body = await request.json();
  } catch {
    return reply(400, { message: "Invalid request." });
  }
  const gate = await requireActiveSession(env, body?.sessionId);
  if (!gate.ok) return reply(gate.status, { message: gate.message });
  const session = gate.session;

  const userText = String(body?.userText || "").slice(0, 2000).trim();
  const replyText = String(body?.replyText || "").slice(0, 2000).trim();
  if (!userText || !replyText) return reply(400, { message: "userText and replyText are required." });
  if (session.turn_count + 2 > TURN_MAX_PER_SESSION)
    return reply(429, { message: "This call has reached its turn limit." });

  const t = body?.timings || {};
  const seq = session.turn_count + 1;
  await appendTurn(env, { sessionId: session.id, seq, role: "user", text: userText, timing: { sttMs: t.sttMs } });
  await appendTurn(env, {
    sessionId: session.id, seq: seq + 1, role: "assistant", text: replyText,
    timing: { tttMs: t.tttMs, brainMs: t.brainMs, ttsMs: t.ttsMs },
  });

  // Cost rollup: brain `usage` comes from /assessment/turn's response
  // (passthrough by the adapter); STT/TTS from the voice team. When nobody
  // reports, estimate from text lengths so the pricing math stays honest.
  const usage = body?.usage && typeof body.usage === "object" ? { ...body.usage } : {};
  if (!usage.llmInputTokens) {
    usage.llmInputTokens = Math.ceil((userText.length + 1200) / 4);
    usage.llmOutputTokens = Math.ceil(replyText.length / 4);
    usage.llmModel = usage.llmModel || "estimate";
    usage.estimated = true; // honest label: nobody reported real tokens
  }
  const rollup = await rollupUsage(env, session.id, usage);

  return reply(200, {
    ok: true,
    seq: seq + 1,
    turnCount: session.turn_count + 2,
    secondsRemaining: secondsRemaining(session),
    costUsdEst: rollup ? rollup.usdEst : 0,
  });
}
