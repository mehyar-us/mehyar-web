// /api/mayor/status — live dashboard data for /admin/mayor
// Returns: today's stats, last run timestamps, paused state, recent events.

import { verifyAdminToken, json, corsHeaders } from "../_shared/adminAuth.js";
import { ensureMayorSchema, getAllSettings, isPaused, recentEvents, getSetting } from "./_shared/mayorDb.js";
import { capRemaining, getDailySendCount, getDailyCap } from "./_shared/mayorGuardrails.js";

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

export async function onRequestGet({ request, env }) {
  if (!await bearerAccepted(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  await ensureMayorSchema(env);
  const settings = await getAllSettings(env);
  const today = new Date().toISOString().slice(0, 10);
  const events = await recentEvents(env, 30);
  const sentToday = await getDailySendCount(env, today);
  const cap = await getDailyCap(env);

  return json({
    ok: true,
    paused: isPaused(settings),
    paused_until: settings.paused_until?.value || "",
    paused_forever: settings.paused_forever?.value === "1",
    cap,
    sent_today: sentToday,
    cap_remaining: Math.max(0, cap - sentToday),
    warmup_day: parseInt(settings.warmup_day?.value || "0", 10),
    last_runs: {
      discovery: settings.discovered_at?.value || "",
      outreach:  settings.outreach_run_at?.value || "",
      followup:  settings.followup_run_at?.value || "",
      digest:    settings.digest_run_at?.value || "",
    },
    events,
  }, 200, request, env);
}