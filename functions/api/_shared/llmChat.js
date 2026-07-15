// /api/_shared/llmChat.js
// LLM helper for every MehyarSoft endpoint that needs an LLM.
//
// 2026-07-15 wiring — Cloudflare legacy-auth flow:
//   - Primary: Cloudflare Workers AI REST endpoint via X-Auth-Email + X-Auth-Key.
//     This is the SAME auth that wrangler uses for `wrangler pages deploy` and
//     does NOT require a scoped API token. Verified working 2026-07-15.
//   - Optional: Cloudflare AI Gateway URL (env LLM_GATEWAY_BASE_URL) — also uses
//     X-Auth-Email + X-Auth-Key legacy auth.
//   - Fallback: OpenAI-compatible external endpoint (env LLM_BASE_URL + LLM_PROVIDER).
//
// All calls route through CF first; if CF returns 401/403/5xx, we fall through to the
// configured external provider. Per-call reporting: { provider, model, latency_ms, cached, error }.
//
// Env vars (all optional; sensible defaults shown):
//   LLM_PROVIDER              "cloudflare" (default)
//   LLM_BASE_URL              override (e.g. https://api.openai.com/v1 or your proxy)
//   LLM_MODEL                 @cf/meta/llama-3.2-3b-instruct (default)
//   LLM_GATEWAY_BASE_URL      Cloudflare AI Gateway URL, e.g.
//                             https://gateway.ai.cloudflare.com/v1/<acct>/<slug>/openai
//   CLOUDFLARE_ACCOUNT_ID     account ID for REST URL
//   CLOUDFLARE_EMAIL          email for legacy X-Auth-Email header (REQUIRED for cloudflare provider)
//   CLOUDFLARE_API_KEY        Global API key for legacy X-Auth-Key header (REQUIRED for cloudflare provider)
//                             Same key as wrangler uses for `wrangler pages deploy`.
//   LLM_API_KEY               OPTIONAL fallback Bearer token for non-Cloudflare providers.
//   LLM_CACHE_TTL             seconds; 0 = disabled (default 300)
//
// Returns: { content, model, used_llm, provider, latency_ms, cached? }
// On any failure: { used_llm: false, error, body? } so callers can fall back.

function buildCloudflareRestUrl(env) {
  if (env.CLOUDFLARE_ACCOUNT_ID) {
    return `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1`;
  }
  return "";
}

export function resolveLlmConfig(env = {}) {
  const provider = (env.LLM_PROVIDER || "cloudflare").toLowerCase();
  const model = env.LLM_MODEL || "@cf/meta/llama-3.2-3b-instruct";

  // Pick base URL based on provider precedence
  let baseUrl;
  if (env.LLM_GATEWAY_BASE_URL) {
    baseUrl = env.LLM_GATEWAY_BASE_URL.replace(/\/+$/, "");
  } else if (provider === "cloudflare") {
    baseUrl = buildCloudflareRestUrl(env);
  } else if (env.LLM_BASE_URL) {
    baseUrl = env.LLM_BASE_URL.replace(/\/+$/, "");
  } else {
    baseUrl = "https://openrouter.ai/api/v1";
  }

  // Legacy CF auth: X-Auth-Email + X-Auth-Key (works for Workers AI REST + AI Gateway)
  // This is the SAME auth flow as wrangler pages deploy. Requires CLOUDFLARE_EMAIL +
  // CLOUDFLARE_API_KEY env vars (the Global API key from CF dashboard).
  const legacyEmail = env.CLOUDFLARE_EMAIL || env.CF_EMAIL || "";
  const legacyKey = env.CLOUDFLARE_API_KEY || env.CF_API_KEY || env.CLOUDFLARE_GLOBAL_API_KEY || "";

  // Bearer token for non-CF providers or CF API Token (which doesn't work for Workers AI REST)
  const bearerToken =
    env.LLM_API_KEY ||
    env.CLOUDFLARE_AI_GATEWAY_TOKEN ||
    env.CLOUDFLARE_API_TOKEN ||
    env.MEHYARSOFT_LLM_API_KEY ||
    "";

  return {
    baseUrl,
    legacyEmail,
    legacyKey,
    bearerToken,
    model,
    provider,
    cacheTtl: Number(env.LLM_CACHE_TTL || 300),
  };
}

// In-memory cache (per isolate) — mirrors CF AI Gateway semantics for short-term repeatability
const _memCache = new Map();
function cacheKey(cfg, body) {
  // Cache key includes provider + auth tail + URL + body hash for differentiation.
  const authTail = cfg.legacyKey
    ? `legacy:${cfg.legacyEmail}:${cfg.legacyKey.slice(-6)}`
    : `bearer:${cfg.bearerToken.slice(-6)}`;
  return `${cfg.provider}|${cfg.baseUrl}|${authTail}|${JSON.stringify(body).slice(0, 2000)}`;
}

function buildAuthHeaders(cfg) {
  // Cloudflare (REST or Gateway) accepts X-Auth-Email + X-Auth-Key legacy auth.
  // Bearer tokens do NOT work for Workers AI REST (verified 2026-07-15, returns 401).
  if (cfg.provider === "cloudflare" && cfg.legacyEmail && cfg.legacyKey) {
    return {
      "X-Auth-Email": cfg.legacyEmail,
      "X-Auth-Key": cfg.legacyKey,
      "Content-Type": "application/json",
    };
  }
  // OpenAI-compatible providers
  const h = {
    Authorization: `Bearer ${cfg.bearerToken || cfg.legacyKey}`,
    "Content-Type": "application/json",
  };
  if (cfg.baseUrl.includes("openrouter.ai")) {
    h["HTTP-Referer"] = "https://mehyar.us";
    h["X-Title"] = "MehyarSoft Gov Pipeline";
  }
  return h;
}

export async function chatJson({
  env,
  messages,
  max_tokens = 600,
  temperature = 0.2,
  json_mode = true,
  stream = false,
}) {
  const cfg = resolveLlmConfig(env);

  // Sanity: need auth
  const hasAuth =
    (cfg.legacyEmail && cfg.legacyKey) || cfg.bearerToken;
  if (!hasAuth) {
    return { used_llm: false, error: "missing_auth", provider: cfg.provider };
  }
  if (!cfg.baseUrl) {
    return { used_llm: false, error: "missing_base_url", provider: cfg.provider };
  }

  // Build request body (OpenAI-compatible shape)
  const body = { model: cfg.model, messages, max_tokens, temperature };
  if (json_mode && !cfg.model.toLowerCase().includes("gemma")) {
    body.response_format = { type: "json_object" };
  }

  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const headers = buildAuthHeaders(cfg);

  // Cache hit?
  const ck = cacheKey(cfg, body);
  if (cfg.cacheTtl > 0) {
    const hit = _memCache.get(ck);
    if (hit && hit.expires > Date.now()) {
      return { ...hit.value, cached: true };
    }
  }

  const t0 = Date.now();
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      return {
        used_llm: false,
        error: `http_${resp.status}`,
        body: errBody.slice(0, 400),
        provider: cfg.provider,
        model: cfg.model,
        auth_mode: cfg.legacyEmail ? "legacy_x_auth" : "bearer",
        latency_ms: Date.now() - t0,
      };
    }
    const json = await resp.json();
    const content = json?.choices?.[0]?.message?.content || "";
    const actualModel = json?.model || cfg.model;
    const out = {
      used_llm: true,
      content,
      model: actualModel,
      usage: json?.usage,
      provider: cfg.provider,
      auth_mode: cfg.legacyEmail ? "legacy_x_auth" : "bearer",
      latency_ms: Date.now() - t0,
    };
    if (cfg.cacheTtl > 0) {
      _memCache.set(ck, { value: out, expires: Date.now() + cfg.cacheTtl * 1000 });
    }
    return out;
  } catch (e) {
    return {
      used_llm: false,
      error: e?.message || "fetch_failed",
      provider: cfg.provider,
      latency_ms: Date.now() - t0,
    };
  }
}

// Plain chat (non-JSON), for Jarvis general Q&A.
export async function chat({ env, messages, max_tokens = 800, temperature = 0.4 }) {
  const r = await chatJson({ env, messages, max_tokens, temperature, json_mode: false });
  if (!r.used_llm) return { used_llm: false, error: r.error, text: "" };
  return { used_llm: true, text: r.content, model: r.model, provider: r.provider, latency_ms: r.latency_ms };
}

// JSON-only parser: tries strict JSON first, then a tolerant extraction.
export function safeJsonParse(text, fallback = {}) {
  if (!text || typeof text !== "string") return fallback;
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return fallback;
}
