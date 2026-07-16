// /api/mayor/followup — Daily follow-up loop
// Sends all DUE step-2 and step-3 sequence emails (after the cadence delay).
// Called by cron at 2 PM ET.

import { verifyAdminToken, json, corsHeaders } from "../_shared/adminAuth.js";
import { ensureMayorSchema, logEvent, getAllSettings, isPaused, setSetting } from "./_shared/mayorDb.js";
import { capRemaining } from "./_shared/mayorGuardrails.js";
import { sendSequenceStep } from "./_shared/mayorEngine.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

async function bearerAccepted(request, env) {
  const h = request.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) return false;
  const tok = h.slice(7);
  if (tok && env?.GOV_INGEST_TOKEN && tok === env.GOV_INGEST_TOKEN) return true;
  const a = await verifyAdminToken(request, env);
  return a.ok;
}

async function fetchDueFollowups(env, limit) {
  if (!env?.LEADS_DB) return [];
  const now = new Date().toISOString();
  try {
    const { results } = await env.LEADS_DB.prepare(
      `SELECT s.id, s.prospect_id, s.step_no, s.subject, s.body_text,
              s.status, s.scheduled_for,
              p.business_name, p.email, p.vertical, p.first_name
       FROM prospect_sequences s
       LEFT JOIN prospects p ON p.id = s.prospect_id
       WHERE s.step_no IN (2, 3)
         AND s.status = 'queued'
         AND s.scheduled_for <= ?
       ORDER BY s.scheduled_for ASC
       LIMIT ?`
    ).bind(now, limit).all();
    return results || [];
  } catch (e) { return []; }
}

// Check if prospect has a reply in mayor_replies → skip if so
async function hasReply(env, prospectId) {
  if (!env?.LEADS_DB) return false;
  try {
    const r = await env.LEADS_DB.prepare(
      `SELECT 1 FROM mayor_replies WHERE prospect_id = ? LIMIT 1`
    ).bind(prospectId).first();
    return !!r;
  } catch (_) { return false; }
}

export async function onRequestPost({ request, env }) {
  if (!await bearerAccepted(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  await ensureMayorSchema(env);
  const settings = await getAllSettings(env);
  if (isPaused(settings)) return json({ ok: false, error: "paused" }, 403, request, env);

  const start = Date.now();
  let remaining = await capRemaining(env);
  if (remaining <= 0) {
    await logEvent(env, "followup", "Daily cap reached — skipping", { loop: "followup" });
    return json({ ok: true, sent: 0, skipped: 0 }, 200, request, env);
  }

  const candidates = await fetchDueFollowups(env, Math.min(remaining * 2, 200));
  let sent = 0, skipped = 0, failed = 0;
  const details = [];
  for (const step of candidates) {
    if (remaining <= 0) break;
    if (!step.email) { skipped++; continue; }
    if (await hasReply(env, step.prospect_id)) { skipped++; continue; }
    const result = await sendSequenceStep(env, {
      sequence: { id: step.id, prospect_id: step.prospect_id,
                  step_no: step.step_no, subject: step.subject, body_text: step.body_text },
      prospect: { email: step.email, business_name: step.business_name, vertical: step.vertical, first_name: step.first_name },
    });
    if (result.ok) { sent++; remaining--; details.push({ to: step.email, step: step.step_no }); }
    else if (result.reason) skipped++;
    else failed++;
  }

  await setSetting(env, "followup_run_at", new Date().toISOString());
  await logEvent(env, "followup",
    `Sent ${sent} follow-ups, skipped ${skipped}, failed ${failed}`,
    { loop: "followup", details: { sent, skipped, failed, details, duration_ms: Date.now() - start } });

  return json({ ok: true, sent, skipped, failed, cap_remaining: remaining }, 200, request, env);
}

export async function onRequestGet({ request, env }) {
  if (!await bearerAccepted(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  const settings = await getAllSettings(env);
  return json({ ok: true, run_at: settings.followup_run_at?.value || "", paused: isPaused(settings) }, 200, request, env);
}