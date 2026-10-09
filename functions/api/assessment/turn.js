// functions/api/assessment/turn.js
// POST /api/assessment/turn — one caller utterance in, one avatar reply out.
// Body: { session_id, user_text }
// The infra crew's turn-taking loop calls this per turn (after STT).
// Response: { ok, reply_text, stage, actions, outcome }.
// Actions the infra crew must honor: endCall, captureEmail, bookAudit { booking_url }.

import { json, loadSession, saveSession, mintPrefillToken } from "../_shared/assessmentStore.js";
import { respond, backgroundScoring, getUsageSummary } from "../_shared/assessmentBrain.js";
import { AUDIT_PREFILL_URL } from "../_shared/assessmentPersona.js";

function bookingUrl(token) {
  const base = (typeof AUDIT_PREFILL_URL !== "undefined" && AUDIT_PREFILL_URL) || "https://mehyar.us/audit";
  return `${base}?prefill=${encodeURIComponent(token)}`;
}

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const body = await request.json().catch(() => ({}));
    const sessionId = String(body.session_id || "");
    const userText = String(body.user_text || "").slice(0, 2000);
    if (!sessionId) return json({ ok: false, error: "missing_session_id" }, 400);

    const loaded = await loadSession(env, sessionId);
    if (!loaded || !loaded.state) return json({ ok: false, error: "session_not_found" }, 404);
    const session = loaded.state;
    if (session.outcome && session.stage === "wrap") {
      return json({ ok: true, reply_text: "", stage: session.stage, actions: [{ type: "endCall" }], outcome: session.outcome });
    }

    const { replyText, actions } = await respond(env, userText, session);

    // Side effects owned by the route (never by the brain).
    const outActions = [];
    for (const a of actions) {
      if (a.type === "bookAudit") {
        if (!session.email) {
          outActions.push({ type: "captureEmail" });
          continue;
        }
        const { token } = await mintPrefillToken(env, session.id, session.email);
        session.prefillToken = token;
        outActions.push({ type: "bookAudit", booking_url: bookingUrl(token) });
      } else {
        outActions.push(a);
      }
    }
    if (session.consentGiven && !session.consentAt) session.consentAt = new Date().toISOString();
    if (outActions.some((a) => a.type === "endCall") && !session.outcome) {
      session.outcome = "declined";
      session.closedAt = new Date().toISOString();
    }
    await saveSession(env, session);
    // D4: real-time background decide() — prospect scoring, next-best-action,
    // persona re-detection. Fire-and-forget AFTER the reply is built and saved:
    // it NEVER blocks the audio path. waitUntil keeps it alive past the response.
    const bg = backgroundScoring(env, session.id, userText).catch(
      (e) => console.error("[assessment/turn] background scoring failed", e?.message));
    if (typeof waitUntil === "function") waitUntil(bg);
    return json({
      ok: true,
      reply_text: replyText,
      stage: session.stage,
      actions: outActions,
      outcome: session.outcome || null,
      // Per-call usage ledger (measured only) — the infra crew rolls this into
      // the session record for the pricing unit-economics report.
      usage: getUsageSummary(session),
    });
  } catch (e) {
    console.error("[assessment/turn]", e?.message);
    return json({ ok: false, error: "turn_failed" }, 500);
  }
}
