// /api/mayor/settings — GET/PUT mayor settings (kill switch, caps, etc.)

import { verifyAdminToken, json, corsHeaders } from "../_shared/adminAuth.js";
import { ensureMayorSchema, getAllSettings, setSetting, logEvent } from "./_shared/mayorDb.js";

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

const EDITABLE_KEYS = new Set([
  "daily_email_cap", "bounce_rate_alert", "auto_send",
]);

export async function onRequestGet({ request, env }) {
  if (!await bearerAccepted(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  await ensureMayorSchema(env);
  return json({ ok: true, settings: await getAllSettings(env) }, 200, request, env);
}

export async function onRequestPut({ request, env }) {
  if (!await bearerAccepted(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  await ensureMayorSchema(env);
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const updates = body?.updates || {};
  const applied = [];
  for (const [k, v] of Object.entries(updates)) {
    if (!EDITABLE_KEYS.has(k)) continue;
    await setSetting(env, k, String(v));
    applied.push({ key: k, value: String(v) });
  }
  await logEvent(env, "settings", `Settings updated: ${applied.map(a => a.key).join(", ") || "(none)"}`, {
    loop: "system",
    details: { applied },
  });
  return json({ ok: true, applied }, 200, request, env);
}