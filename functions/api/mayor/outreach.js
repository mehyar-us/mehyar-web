// /api/mayor/outreach — Daily outreach loop
// Sends all DUE step-1 (or step-2/3 follow-ups not yet sent) emails.
// Called by cron at 10 AM ET.

import { verifyAdminToken, json, corsHeaders } from "../_shared/adminAuth.js";
import { ensureMayorSchema, logEvent, getAllSettings, isPaused, setSetting } from "./_shared/mayorDb.js";
import { capRemaining, isOverCap } from "./_shared/mayorGuardrails.js";
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

// Pull due queued sequence steps + join with prospect email
async function fetchDueSteps(env, limit) {
  if (!env?.LEADS_DB) return [];
  const now = new Date().toISOString();
  try {
    const { results } = await env.LEADS_DB.prepare(
      `SELECT s.id, s.prospect_id, s.step_no, s.subject, s.body_text,
              s.send_after_days, s.status, s.scheduled_for,
              p.business_name, p.email, p.vertical
       FROM prospect_sequences s
       LEFT JOIN prospects p ON p.id = s.prospect_id
       WHERE s.status = 'queued'
         AND (s.scheduled_for IS NULL OR s.scheduled_for <= ?)
       ORDER BY s.scheduled_for ASC
       LIMIT ?`
    ).bind(now, limit).all();
    console.log(`[mayor/outreach] fetchDueSteps: ${(results || []).length} candidates`);
    return results || [];
  } catch (e) {
    console.log(`[mayor/outreach] fetchDueSteps ERROR: ${e?.message}`);
    return [];
  }
}

export async function onRequestPost({ request, env }) {
  if (!await bearerAccepted(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  await ensureMayorSchema(env);
  const settings = await getAllSettings(env);
  if (isPaused(settings)) {
    return json({ ok: false, error: "paused" }, 403, request, env);
  }

  const start = Date.now();
  let remaining = await capRemaining(env);
  if (remaining <= 0) {
    await logEvent(env, "outreach", "Daily cap reached — skipping", {
      loop: "outreach",
      details: { cap_remaining: 0 },
    });
    return json({ ok: true, sent: 0, skipped: 0, cap_remaining: 0 }, 200, request, env);
  }

  const candidates = await fetchDueSteps(env, Math.min(remaining * 2, 200));
  console.log(`[mayor/outreach] fetched ${(candidates || []).length} candidates`);
  let sent = 0, skipped = 0, failed = 0;
  const sentDetails = [];
  const debugLog = [];
  for (const step of candidates) {
    if (remaining <= 0) break;
    if (!step.email) {
      console.log(`[mayor/outreach] skipping ${step.id} — no email (prospect_id=${step.prospect_id?.slice(0,8)})`);
      debugLog.push(`skip-no-email:${step.prospect_id?.slice(0,8)}`);
      skipped++;
      continue;
    }
    console.log(`[mayor/outreach] sending ${step.id} to ${step.email} step=${step.step_no}`);
    const result = await sendSequenceStep(env, {
      sequence: { id: step.id, prospect_id: step.prospect_id,
                  step_no: step.step_no, subject: step.subject, body_text: step.body_text },
      prospect: { email: step.email, business_name: step.business_name, vertical: step.vertical },
    });
    console.log(`[mayor/outreach]   result:`, JSON.stringify(result));
    debugLog.push(`${step.email} -> ok=${result.ok} reason=${result.reason || '-'} err=${result.error || '-'}`);
    if (result.ok) { sent++; remaining--; sentDetails.push({ to: step.email, step: step.step_no, id: result.send_id }); }
    else if (result.reason) skipped++;
    else failed++;
  }

  await setSetting(env, "outreach_run_at", new Date().toISOString());

  await logEvent(env, "outreach",
    `Sent ${sent}, skipped ${skipped}, failed ${failed} (candidates=${(candidates||[]).length})`,
    { loop: "outreach", details: { sent, skipped, failed, candidates_count: (candidates||[]).length, sentDetails, debugLog, duration_ms: Date.now() - start } });

  return json({ ok: true, sent, skipped, failed, cap_remaining: remaining, duration_ms: Date.now() - start }, 200, request, env);
}

export async function onRequestGet({ request, env }) {
  if (!await bearerAccepted(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  const settings = await getAllSettings(env);
  return json({
    ok: true,
    run_at: settings.outreach_run_at?.value || "",
    paused: isPaused(settings),
    cap_remaining: await capRemaining(env),
  }, 200, request, env);
}