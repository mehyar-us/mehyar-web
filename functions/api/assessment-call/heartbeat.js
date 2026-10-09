// POST /api/assessment-call/heartbeat
// Body: { sessionId }. Keepalive every ~30s. Enforces the 45-min cap.
// Returns { ok, status, secondsRemaining, turnCount }.

import {
  reply, nowIso, originOk, requireActiveSession, secondsRemaining,
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
  if (!gate.ok) return reply(gate.status, { message: gate.message, secondsRemaining: 0 });
  await env.LEADS_DB.prepare(
    "UPDATE assessment_call_sessions SET last_heartbeat_at = ? WHERE id = ?"
  ).bind(nowIso(), gate.session.id).run();
  return reply(200, {
    ok: true,
    status: gate.session.status,
    secondsRemaining: secondsRemaining(gate.session),
    turnCount: gate.session.turn_count,
  });
}
