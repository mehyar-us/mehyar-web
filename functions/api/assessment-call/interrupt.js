// POST /api/assessment-call/interrupt
// Body: { sessionId }. Barge-in receipt: the caller started speaking while the
// avatar was talking, so the client cancelled playback locally. Marks the
// latest assistant turn interrupted=1 (best-effort abort marker for the
// transcript + scoring). Always 200 — interruption is a normal event.

import { reply, originOk, requireActiveSession } from "./_shared/callShared.js";

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
  await env.LEADS_DB.prepare(
    `UPDATE assessment_call_turns SET interrupted = 1 WHERE id = (
       SELECT id FROM assessment_call_turns
       WHERE session_id = ? AND role = 'assistant'
       ORDER BY seq DESC LIMIT 1
     )`
  ).bind(gate.session.id).run();
  return reply(200, { ok: true });
}
