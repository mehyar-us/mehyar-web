// /api/mayor/pause — Pause/resume the Mayor engine
//   POST { duration_hours: 24 }  → pause for N hours
//   POST { forever: true }       → kill switch
//   POST { resume: true }        → unpause

import { verifyAdminToken, json, corsHeaders } from "../_shared/adminAuth.js";
import { ensureMayorSchema, pause, resume } from "./_shared/mayorDb.js";

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

export async function onRequestPost({ request, env }) {
  if (!await bearerAccepted(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  await ensureMayorSchema(env);
  let body;
  try { body = await request.json(); } catch { body = {}; }

  if (body?.resume) return json(await resume(env), 200, request, env);
  if (body?.forever) return json(await pause(env, { forever: true }), 200, request, env);
  const hours = Math.min(Math.max(parseInt(body?.duration_hours || 24, 10) || 24, 1), 24 * 30);
  return json(await pause(env, { durationHours: hours }), 200, request, env);
}