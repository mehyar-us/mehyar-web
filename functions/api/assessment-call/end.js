// POST /api/assessment-call/end
// Body: { sessionId }. Graceful end — marks the session ended and returns
// the summary the UI shows ("your audit is on its way").

import {
  reply, originOk, getSession, requireActiveSession, markSession,
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
  const session = await getSession(env, body?.sessionId);
  if (!session) return reply(404, { message: "Call session not found." });
  if (session.status === "active") await markSession(env, session.id, "ended");
  const done = await getSession(env, session.id);
  const durationSec = Math.floor((Date.parse(done.ended_at || done.last_heartbeat_at || done.created_at) - Date.parse(done.created_at)) / 1000);
  return reply(200, {
    ok: true,
    status: done.status,
    turnCount: done.turn_count,
    durationSec: Math.max(0, durationSec),
    message: "Thanks for your time — your business audit is being prepared.",
  });
}
