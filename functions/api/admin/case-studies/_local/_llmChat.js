// Tiny chat helper used by the gov pipeline.
// Default backend: Cloudflare AI (via the OpenAI-compatible `/v1` shim on
// the AI Gateway or the Run on Workers AI REST endpoint). The user
// runs no local LLM — Cloudflare hosts the model.
//
// Returns: { content, model, used_llm }.
// On any failure (no key, 4xx/5xx, parse error), returns { used_llm: false, error }
// so callers can fall back to a deterministic template.
//
// Cloudflare AI options surfaced via env vars:
//   LLM_PROVIDER              "cloudflare" (default) or "openrouter" or anything
//                             OpenAI-compatible the user chooses
//   LLM_BASE_URL              override (e.g. openai, openrouter, your proxy)
//   LLM_MODEL                 default @cf/meta/llama-3-8b-instruct (free tier)
//   CLOUDFLARE_ACCOUNT_ID     account for the REST URL
//   CLOUDFLARE_AI_GATEWAY_TOKEN or CLOUDFLARE_API_TOKEN or LLM_API_KEY for auth

function buildBaseUrl(env) {
  if (env.LLM_BASE_URL) return env.LLM_BASE_URL.replace(/\/+$/, "");
  if (env.CLOUDFLARE_ACCOUNT_ID) {
    // Workers AI REST — auth header + model "@cf/..." in body
    return `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1`;
  }
  return "https://api.cloudflare.com/client/v4/accounts/<unknown>/ai/v1";
}

export function resolveLlmConfig(env = {}) {
  const baseUrl = buildBaseUrl(env);
  const apiKey =
    env.LLM_API_KEY ||
    env.CLOUDFLARE_AI_GATEWAY_TOKEN ||
    env.CLOUDFLARE_API_TOKEN ||
    env.MEHYARSOFT_LLM_API_KEY ||
    "";
  // Cloudflare Workers AI was deprecated for llama-3-8b-instruct on 2026-05-30.
  // Use llama-3.2-3b-instruct as the new default — same quality, still supported.
  // Any other live @cf/... model can be selected via env.LLM_MODEL.
  const model = env.LLM_MODEL || "@cf/meta/llama-3.2-3b-instruct";
  return { baseUrl, apiKey, model, provider: env.LLM_PROVIDER || "cloudflare" };
}

export async function chatJson({ env, messages, max_tokens = 600, temperature = 0.2, json_mode = true }) {
  const { baseUrl, apiKey, model, provider } = resolveLlmConfig(env);
  if (!apiKey) return { used_llm: false, error: "missing_api_key" };
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  // Cloudflare REST expects Bearer as the API token; OpenRouter wants referer.
  if (provider !== "cloudflare" && (baseUrl.includes("openrouter.ai") || provider === "openrouter")) {
    headers["HTTP-Referer"] = (env.ALLOWED_ORIGINS || "").split(",")[0]?.trim() || "https://mehyar.us";
    headers["X-Title"] = "MehyarSoft Gov Pipeline";
  }
  const body = {
    model,
    messages,
    max_tokens,
    temperature,
  };
  // Cloudflare workers-ai (llama-3 etc) supports OpenAI response_format=json_object
  // for chat-compatible models. Skipping for gemma flavors that don't.
  if (json_mode && !model.toLowerCase().includes("gemma")) body.response_format = { type: "json_object" };

  try {
    const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!resp.ok) {
      return { used_llm: false, error: `http_${resp.status}`, body: (await resp.text()).slice(0, 200) };
    }
    const json = await resp.json();
    const content = json?.choices?.[0]?.message?.content || "";
    const actualModel = json?.model || model;
    return { used_llm: true, content, model: actualModel, usage: json?.usage, provider };
  } catch (e) {
    return { used_llm: false, error: e?.message || "fetch_failed" };
  }
}

// JSON-only parser: tries strict JSON first, then a tolerant extraction.
export function safeJsonParse(text, fallback = {}) {
  if (!text || typeof text !== "string") return fallback;
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return fallback;
}
