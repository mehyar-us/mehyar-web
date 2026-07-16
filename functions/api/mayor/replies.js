// /api/mayor/replies — inbound reply classification list

import { verifyAdminToken, json, corsHeaders } from "../_shared/adminAuth.js";
import { ensureMayorSchema, listReplies } from "./_shared/mayorDb.js";

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
  const url = new URL(request.url);
  const replies = await listReplies(env, {
    needsAction: url.searchParams.get("needs_action") === "1",
    limit: Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200),
  });
  return json({ ok: true, count: replies.length, replies }, 200, request, env);
}