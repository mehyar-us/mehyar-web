// POST /api/assessment-call/delete
// Body: { sessionId }. Data-deletion path (compliance item 20): hard-deletes
// the session row and every turn. The sessionId is a 128-bit opaque secret;
// possession authorizes deletion. Also the path the UI offers as
// "delete my transcript".

import { reply, originOk, getSession } from "./_shared/callShared.js";

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
  await env.LEADS_DB.prepare("DELETE FROM assessment_call_turns WHERE session_id = ?").bind(session.id).run();
  await env.LEADS_DB.prepare("DELETE FROM assessment_call_sessions WHERE id = ?").bind(session.id).run();
  return reply(200, { ok: true, message: "Your call transcript has been deleted." });
}
