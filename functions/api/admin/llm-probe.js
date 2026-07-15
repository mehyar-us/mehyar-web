// /api/admin/llm-probe
//
// Owner-only endpoint that hits the LLM helper directly and returns the raw
// { used_llm, error, body, auth_mode, latency_ms } so we can diagnose why
// the AI integration isn't working in production.

import { verifyAdminToken, json, corsHeaders } from "../_shared/adminAuth.js";
import { chatJson, resolveLlmConfig } from "../_shared/llmChat.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);

  const cfg = resolveLlmConfig(env || {});
  const out = {
    ok: true,
    config: {
      provider: cfg.provider,
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      hasLegacyAuth: !!(cfg.legacyEmail && cfg.legacyKey),
      hasBearerToken: !!cfg.bearerToken,
      legacyEmailTail: cfg.legacyEmail ? cfg.legacyEmail.slice(0, 6) + "..." : "",
      legacyKeyTail: cfg.legacyKey ? cfg.legacyKey.slice(-4) : "",
      cacheTtl: cfg.cacheTtl,
    },
  };

  // Try a tiny LLM call
  const t0 = Date.now();
  const r = await chatJson({
    env,
    messages: [
      { role: "system", content: "You are a health-check. Reply with valid JSON {\"ok\":true,\"ping\":\"pong\"} only." },
      { role: "user", content: "ping?" },
    ],
    max_tokens: 30,
    temperature: 0,
    json_mode: true,
  });
  out.llm_call = {
    ...r,
    wall_ms: Date.now() - t0,
  };
  return json(out, 200, request, env);
}
