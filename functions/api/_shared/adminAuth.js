// Tiny shared admin-auth helper used by all /api/prospects/* endpoints.
// Validates the same bearer JWT the existing /api/admin/metrics uses
// (issue at /v1/admin/login on api.mehyar.us).
//
// Returns: { ok: true, session } | { ok: false, status, message }
// Also exposes allowOrigin() for cross-origin checks.
export async function verifyAdminToken(request, env) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const secret = env?.ADMIN_SESSION_SECRET || env?.HMAC_SECRET || "";
  if (!token || !secret) return { ok: false, status: 401, message: "admin_auth_required" };
  try {
    const [encodedPayload, signature] = token.split(".");
    if (!encodedPayload || !signature) return { ok: false, status: 401, message: "bad_token_shape" };
    const expected = await hmacSha256B64Url(secret, encodedPayload);
    if (!timingSafeEqual(signature, expected)) return { ok: false, status: 401, message: "bad_signature" };
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload)));
    if (!payload?.sub || !payload?.exp || Number(payload.exp) < Math.floor(Date.now() / 1000)) {
      return { ok: false, status: 401, message: "expired_or_invalid" };
    }
    return { ok: true, session: payload };
  } catch {
    return { ok: false, status: 401, message: "verify_failed" };
  }
}

export function isAllowedOrigin(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const allowed = (env?.ALLOWED_ORIGINS || "https://mehyar.us,https://www.mehyar.us,http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  if (allowed.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    return host.endsWith(".pages.dev") && env?.ENVIRONMENT !== "production";
  } catch { return false; }
}

export function corsHeaders(request, env) {
  const origin = request.headers.get("origin");
  const allowedOrigin = origin && isAllowedOrigin(request, env) ? origin : "https://mehyar.us";
  return {
    "access-control-allow-origin": allowedOrigin,
    "vary": "Origin",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
  };
}

export function json(body, status = 200, request, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...corsHeaders(request, env),
    },
  });
}

async function hmacSha256B64Url(secret, value) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncodeBytes(new Uint8Array(sig));
}
function base64UrlEncodeBytes(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
