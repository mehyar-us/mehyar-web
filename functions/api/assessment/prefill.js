// functions/api/assessment/prefill.js
// Tokenized prefill for the Audit My Business form (the audit-tab crew's page).
//
// GET  /api/assessment/prefill?token=act_...  → { ok, payload } (does NOT consume;
//      safe for page render + refresh)
// POST /api/assessment/prefill { token }      → { ok, payload } + marks the token
//      used (call when the caller submits the audit intake form).
//
// The payload is prefill ONLY — names the business, URL, and the call's
// measured findings. The audit-tab crew's intake endpoint remains the system of
// record (their audit_business_reports table); see docs/assessment-call-handoff.md.

import { json, redeemPrefillToken, markTokenUsed } from "../_shared/assessmentStore.js";

export async function onRequestGet({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const token = new URL(request.url).searchParams.get("token") || "";
    const r = await redeemPrefillToken(env, token);
    if (!r.ok) return json(r, 410);
    return json({ ok: true, payload: r.payload });
  } catch (e) {
    console.error("[assessment/prefill GET]", e?.message);
    return json({ ok: false, error: "prefill_failed" }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const body = await request.json().catch(() => ({}));
    const r = await redeemPrefillToken(env, String(body.token || ""));
    if (!r.ok) return json(r, 410);
    await markTokenUsed(env, r.tokenHash);
    return json({ ok: true, payload: r.payload });
  } catch (e) {
    console.error("[assessment/prefill POST]", e?.message);
    return json({ ok: false, error: "prefill_failed" }, 500);
  }
}
