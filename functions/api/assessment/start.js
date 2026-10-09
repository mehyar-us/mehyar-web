// functions/api/assessment/start.js
// POST /api/assessment/start — open a new assessment-call session.
// The infra crew's call UI announces recording BEFORE hitting this endpoint;
// the avatar's first spoken line is the consent script (returned here).
// Body: {} — nothing PII is required to start.

import { json, clientIpHashInput, saveSession } from "../_shared/assessmentStore.js";
import { sha256hex } from "../_shared/assessmentDiagnose.js";
import { newSession } from "../_shared/assessmentBrain.js";
import { CONSENT_SCRIPT } from "../_shared/assessmentPersona.js";

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const session = newSession();
    session.id = crypto.randomUUID();
    session.createdAt = new Date().toISOString();
    session.ipHash = await sha256hex("assessment-call-ip|" + clientIpHashInput(request));
    // Rate limit: 5 call starts/day per IP (KV best-effort; abuse gate).
    if (env?.INTAKE_KV) {
      const k = `assessment:call:start:${session.ipHash}`;
      const n = Number((await env.INTAKE_KV.get(k)) || "0");
      if (n >= 5) return json({ ok: false, error: "rate_limited" }, 429);
      await env.INTAKE_KV.put(k, String(n + 1), { expirationTtl: 86400 });
    }
    await saveSession(env, session);
    return json({ ok: true, session_id: session.id, reply_text: CONSENT_SCRIPT, stage: session.stage });
  } catch (e) {
    console.error("[assessment/start]", e?.message);
    return json({ ok: false, error: "start_failed" }, 500);
  }
}
