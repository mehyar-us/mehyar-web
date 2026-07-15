// /api/_shared/llmChat.js
// LLM helper for every MehyarSoft endpoint that needs an LLM.
//
// 2026 wiring — Cloudflare-first:
//   - Primary: Cloudflare Workers AI REST endpoint (cheap, no egress, integrated auth).
//   - Optional: Cloudflare AI Gateway URL (env LLM_GATEWAY_BASE_URL) for caching + observability.
//   - Fallback: OpenAI-compatible external endpoint (env LLM_BASE_URL + LLM_PROVIDER).
//
// All calls route through CF first; if CF returns 401/403/5xx, we fall through to the
// configured external provider. The whole decision tree is logged via opportunity_events
// event_type='llm_call' so the admin can audit cost + latency.
//
// Env vars (all optional; sensible defaults shown):
//   LLM_PROVIDER              "cloudflare" (default)
//   LLM_BASE_URL              override (e.g. https://api.openai.com/v1 or your proxy)
//   LLM_MODEL                 @cf/meta/llama-3.2-3b-instruct (default)
//   LLM_GATEWAY_BASE_URL      Cloudflare AI Gateway URL, e.g.
//                             https://gateway.ai.cloudflare.com/v1/<acct>/<slug>/<provider>
//   LLM_GATEWAY_PROVIDER      "openai" (default) — Gateway's per-provider namespace
//   CLOUDFLARE_ACCOUNT_ID     account ID for REST URL
//   CLOUDFLARE_AI_GATEWAY_TOKEN or LLM_API_KEY or CLOUDFLARE_API_TOKEN — auth
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

  const apiKey =
    env.LLM_API_KEY ||
    env.CLOUDFLARE_AI_GATEWAY_TOKEN ||
    env.CLOUDFLARE_API_TOKEN ||
    env.MEHYARSOFT_LLM_API_KEY ||
    "";

  return { baseUrl, apiKey, model, provider, cacheTtl: Number(env.LLM_CACHE_TTL || 300) };
}

// In-memory cache (per isolate) — mirrors CF AI Gateway semantics for short-term repeatability
const _memCache = new Map();
function cacheKey(url, body, apiKey) {
  return `${apiKey.slice(-6)}|${url}|${JSON.stringify(body).slice(0, 2000)}`;
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
  if (!cfg.apiKey) return { used_llm: false, error: "missing_api_key", provider: cfg.provider };

  // Build request body (OpenAI-compatible shape)
  const body = { model: cfg.model, messages, max_tokens, temperature };
  if (json_mode && !cfg.model.toLowerCase().includes("gemma")) {
    body.response_format = { type: "json_object" };
  }

  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const headers = {
    Authorization: `Bearer ${cfg.apiKey}`,
    "Content-Type": "application/json",
  };
  if (cfg.provider !== "cloudflare" && cfg.baseUrl.includes("openrouter.ai")) {
    headers["HTTP-Referer"] = (env.ALLOWED_ORIGINS || "").split(",")[0]?.trim() || "https://mehyar.us";
    headers["X-Title"] = "MehyarSoft Gov Pipeline";
  }

  // Cache hit?
  const ck = cacheKey(url, body, cfg.apiKey);
  if (cfg.cacheTtl > 0) {
    const hit = _memCache.get(ck);
    if (hit && hit.expires > Date.now()) {
      return { ...hit.value, cached: true };
    }
  }

  const t0 = Date.now();
  try {
    const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(45_000) });
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      return {
        used_llm: false,
        error: `http_${resp.status}`,
        body: errBody.slice(0, 200),
        provider: cfg.provider,
        model: cfg.model,
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
      latency_ms: Date.now() - t0,
    };
    if (cfg.cacheTtl > 0) {
      _memCache.set(ck, { value: out, expires: Date.now() + cfg.cacheTtl * 1000 });
    }
    return out;
  } catch (e) {
    return { used_llm: false, error: e?.message || "fetch_failed", provider: cfg.provider, latency_ms: Date.now() - t0 };
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
