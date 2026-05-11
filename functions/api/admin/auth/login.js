const SAFE_FAILURE = "Admin login unavailable.";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!isAllowedOrigin(request, env)) return json({ ok: false, message: SAFE_FAILURE }, 403, request, env);
    if (!(request.headers.get("content-type") || "").includes("application/json")) {
      return json({ ok: false, message: SAFE_FAILURE }, 415, request, env);
    }

    const body = await request.json().catch(() => ({}));
    const identifier = sanitize(body.username || body.email, 254).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const expectedIdentifier = sanitize(env?.MEHYARSOFT_ADMIN_USERNAME || env?.MEHYARSOFT_ADMIN_EMAIL, 254).toLowerCase();
    const expectedPassword = env?.MEHYARSOFT_ADMIN_PASSWORD || "";
    const secret = env?.ADMIN_SESSION_SECRET || env?.HMAC_SECRET || "";

    if (!expectedIdentifier || !expectedPassword || !secret) {
      return json({ ok: false, message: "Admin auth is not configured." }, 503, request, env);
    }

    const rate = await checkRateLimit(env, secret, request, identifier || "unknown");
    if (!rate.ok) return json({ ok: false, message: SAFE_FAILURE }, 429, request, env);

    if (identifier !== expectedIdentifier || !timingSafeEqual(password, expectedPassword)) {
      return json({ ok: false, message: SAFE_FAILURE }, 401, request, env);
    }

    const expiresAtMs = Date.now() + 1000 * 60 * 60 * 8;
    const expiresAt = new Date(expiresAtMs).toISOString();
    const token = await signToken({ sub: identifier, exp: Math.floor(expiresAtMs / 1000) }, secret);
    return json({ token, expiresAt }, 200, request, env);
  } catch (error) {
    console.error("admin login error", { error: error?.name || "unknown" });
    return json({ ok: false, message: SAFE_FAILURE }, 500, request, env);
  }
}

async function signToken(payload, secret) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmacSha256(secret, encodedPayload);
  return `${encodedPayload}.${signature}`;
}

async function checkRateLimit(env, secret, request, email) {
  if (!env?.INTAKE_KV) return { ok: true };
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const keyHash = await hmacSha256(secret, `admin-login:${ip}:${email}`);
  const key = `ratelimit:admin-login:${keyHash}`;
  const current = Number((await env.INTAKE_KV.get(key)) || "0");
  if (current >= 10) return { ok: false };
  await env.INTAKE_KV.put(key, String(current + 1), { expirationTtl: 900 });
  return { ok: true };
}

async function hmacSha256(secret, value) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

function base64UrlEncode(value) {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
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
