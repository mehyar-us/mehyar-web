// Tiny OpenAI-compatible chat helper used by the gov pipeline.
// Uses env.LLM_API_KEY + env.LLM_BASE_URL + env.LLM_MODEL (matching the
// prospect pipeline so we can swap providers via env vars).
//
// Returns: { content, model, used_llm }.
// On any failure (no key, 4xx/5xx, parse error), returns { used_llm: false, error }
// so callers can fall back to a deterministic template.

export function resolveLlmConfig(env = {}) {
  const baseUrl = env.LLM_BASE_URL || "https://openrouter.ai/api/v1";
  const apiKey = env.LLM_API_KEY || env.MEHYARSOFT_LLM_API_KEY || "";
  const model = env.LLM_MODEL || "google/gemma-4-26b-a4b-it:free";
  return { baseUrl, apiKey, model };
}

export async function chatJson({ env, messages, max_tokens = 600, temperature = 0.2, json_mode = true }) {
  const { baseUrl, apiKey, model } = resolveLlmConfig(env);
  if (!apiKey) return { used_llm: false, error: "missing_api_key" };
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  // Some OpenRouter models want an attribution header; harmless if not.
  if (baseUrl.includes("openrouter.ai")) {
    headers["HTTP-Referer"] = env.ALLOWED_ORIGINS?.split(",")[0]?.trim() || "https://mehyar.us";
    headers["X-Title"] = "MehyarSoft Gov Pipeline";
  }
  const body = {
    model,
    messages,
    max_tokens,
    temperature,
  };
  // response_format: { type: "json_object" } is OpenAI-specific and rejected
  // by some OpenRouter free models (e.g. gemma-4-26b returns 400). Instead we
  // ask for JSON in the system prompt and parse leniently in safeJsonParse.
  if (json_mode && !model.includes("gemma")) body.response_format = { type: "json_object" };
  try {
    const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!resp.ok) {
      return { used_llm: false, error: `http_${resp.status}`, body: (await resp.text()).slice(0, 200) };
    }
    const json = await resp.json();
    const content = json?.choices?.[0]?.message?.content || "";
    return { used_llm: true, content, model: json?.model || model, usage: json?.usage };
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