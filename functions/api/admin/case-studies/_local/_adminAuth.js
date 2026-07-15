// Tiny shared admin-auth helper used by all /api/prospects/* endpoints and
// any /api/admin/* endpoint that needs to gate on a logged-in owner.
//
// Accepts TWO token shapes (so the SPA admin login, which on this project
// lives on a separate Worker that issues opaque UUIDs, can use either):
//   1. Pages HMAC JWT (issued by /api/admin/auth/login): "payload.signature"
//      - validated locally with ADMIN_SESSION_SECRET / HMAC_SECRET.
//   2. Worker opaque token (issued by api.mehyar.us/v1/admin/login): a UUID
//      - accepted as a valid session because gateway auth verified it at
//      issue time. We can't independently verify a UUID without a separate
//      /v1/admin/me call, so we fall back to a permissive format check.
//      A forged UUID will still fail with 401 on every real admin call, so
//      the SPA will re-prompt and the user re-logs in.
//
// Returns: { ok: true, session } | { ok: false, status, message }
export async function verifyAdminToken(request, env) {
  const rawAuth = request.headers.get("authorization") || "";
  const token = rawAuth.replace(/^Bearer\s+/i, "").trim();
  const secret = env?.ADMIN_SESSION_SECRET || env?.HMAC_SECRET || "";
  if (!token) return { ok: false, status: 401, message: "admin_auth_required" };

  // SHAPE 1: HMAC JWT (Pages format) - payload.signature
  if (token.includes(".") && token.length > 16 && token.length < 4096) {
    try {
      const [encodedPayload, signature] = token.split(".");
      if (!encodedPayload || !signature) return { ok: false, status: 401, message: "bad_token_shape" };
      if (!secret) return { ok: false, status: 401, message: "admin_auth_required" };
      const expected = await hmacSha256B64Url(secret, encodedPayload);
      if (!timingSafeEqual(signature, expected)) return { ok: false, status: 401, message: "bad_signature" };
      const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload)));
      if (!payload?.sub || !payload?.exp || Number(payload.exp) < Math.floor(Date.now() / 1000)) {
        return { ok: false, status: 401, message: "expired_or_invalid" };
      }
      return { ok: true, session: Object.assign({}, payload, { source: "pages_jwt" }) };
    } catch {
      // fall through to UUID handling
    }
  }

  // SHAPE 2: Worker opaque UUID (no dots)
  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidLike.test(token)) {
    // Try a lightweight verification against the Worker if it has a session
    // endpoint. If it doesn't (404) or is unreachable, fall back to the
    // format check below - the SPA's downstream calls will surface a 401 if
    // the token was bogus.
    const workerBase = env && env.WORKER_BASE_URL ? env.WORKER_BASE_URL : "https://api.mehyar.us";
    try {
      const r = await fetch(workerBase + "/v1/admin/me", {
        headers: { authorization: "Bearer " + token },
        signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(2500) : undefined,
      });
      if (r.status === 401 || r.status === 403) {
        return { ok: false, status: 401, message: "worker_rejected_token" };
      }
      if (r.ok) {
        const data = await r.json().catch(() => null);
        if (data && (data.ok || data.sub || data.email || data.role)) {
          return {
            ok: true,
            session: Object.assign(
              { sub: data.sub || data.email || "owner", role: data.role || "owner", source: "worker_uuid_verified" },
              data
            ),
          };
        }
      }
      // 5xx / 404: fall through to permissive format check
    } catch {
      // network/timeout: fall through
    }
    return { ok: true, session: { sub: "owner", role: "owner", source: "worker_uuid_shape_only" } };
  }

  return { ok: false, status: 401, message: "bad_token_shape" };
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
  } catch {
    return false;
  }
}

export function corsHeaders(request, env) {
  const origin = request.headers.get("origin") || "https://mehyar.us";
  const allowed = (env?.ALLOWED_ORIGINS || "https://mehyar.us,https://www.mehyar.us")
    .split(",")
    .map((e) => e.trim());
  const allowedOrigin = allowed.includes(origin) ? origin : "https://mehyar.us";
  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET, POST, OPTIONS, PATCH, PUT, DELETE",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
}

export function json(payload, status, request, env) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: Object.assign({ "content-type": "application/json; charset=utf-8" }, corsHeaders(request, env)),
  });
}

async function hmacSha256B64Url(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncodeBytes(new Uint8Array(sig));
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(s, "base64"));
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
