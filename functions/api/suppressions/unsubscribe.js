const SAFE_SUCCESS = "This email has been unsubscribed.";
const SAFE_FAILURE = "We could not process the unsubscribe request.";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!isAllowedOrigin(request, env)) return json({ ok: false, message: SAFE_FAILURE }, 403, request, env);
    if (!(request.headers.get("content-type") || "").includes("application/json")) {
      return json({ ok: false, message: SAFE_FAILURE }, 415, request, env);
    }
    if (!env?.LEADS_DB) return json({ ok: false, message: "LEADS_DB binding missing." }, 503, request, env);

    const body = await request.json().catch(() => ({}));
    const email = sanitize(body.email, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, message: SAFE_FAILURE }, 400, request, env);

    const valueHash = await hmacSha256(env, email);
    const rate = await checkRateLimits(env, request, valueHash);
    if (!rate.ok) return json({ ok: false, message: SAFE_FAILURE }, 429, request, env);

    const reason = sanitize(body.reason, 500) || "unsubscribe_request";
    const source = sanitize(body.source, 120) || "mehyar-web";
    await env.LEADS_DB.prepare(
      "INSERT OR IGNORE INTO suppression_list (id, type, value_hash, reason, source) VALUES (?, 'email', ?, ?, ?)"
    ).bind(crypto.randomUUID(), valueHash, reason, source).run();
    if (env?.INTAKE_KV) {
      await env.INTAKE_KV.put(`suppression:email:${valueHash}`, "1", { expirationTtl: 86400 });
    }
    await writeAudit(env, "suppression_created", { source });
    return json({ ok: true, status: "suppressed", message: SAFE_SUCCESS }, 200, request, env);
  } catch (error) {
    console.error("unsubscribe error", { error: error?.name || "unknown" });
    return json({ ok: false, message: SAFE_FAILURE }, 500, request, env);
  }
}

async function writeAudit(env, eventType, metadata) {
  if (!env?.LEADS_DB) return;
  await env.LEADS_DB.prepare("INSERT INTO lead_events (id, lead_id, event_type, actor, metadata_json) VALUES (?, NULL, ?, 'system', ?)")
    .bind(crypto.randomUUID(), eventType, JSON.stringify(metadata || {}))
    .run();
}

async function checkRateLimits(env, request, emailHash) {
  if (!env?.INTAKE_KV) return { ok: true };
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const ipHash = await hmacSha256(env, ip);
  const checks = [
    { key: `ratelimit:unsubscribe:ip:${ipHash}`, limit: 10, ttl: 900 },
    { key: `ratelimit:unsubscribe:email:${emailHash}`, limit: 5, ttl: 86400 },
  ];
  for (const check of checks) {
    const current = Number((await env.INTAKE_KV.get(check.key)) || "0");
    if (current >= check.limit) return { ok: false };
  }
  for (const check of checks) {
    const current = Number((await env.INTAKE_KV.get(check.key)) || "0");
    await env.INTAKE_KV.put(check.key, String(current + 1), { expirationTtl: check.ttl });
  }
  return { ok: true };
}

async function hmacSha256(env, value) {
  const secret = env?.HMAC_SECRET || env?.TURNSTILE_SECRET_KEY || (env?.ENVIRONMENT !== "production" ? "mehyar-web-local-hash-salt" : "");
  if (!secret) throw new Error("HMAC secret missing");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sanitize(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function isAllowedOrigin(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const allowed = (env?.ALLOWED_ORIGINS || "https://mehyar.us,https://www.mehyar.us,http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (allowed.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    return host.endsWith(".pages.dev") && env?.ENVIRONMENT !== "production";
  } catch {
    return false;
  }
}

function corsHeaders(request, env) {
  const origin = request.headers.get("origin");
  const allowedOrigin = origin && isAllowedOrigin(request, env) ? origin : "https://mehyar.us";
  return {
    "access-control-allow-origin": allowedOrigin,
    "vary": "Origin",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
  };
}

function json(body, status, request, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...corsHeaders(request, env) },
  });
}
