const SAFE_FAILURE = "Admin metrics unavailable.";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env }) {
  try {
    if (!isAllowedOrigin(request, env)) return json({ ok: false, message: SAFE_FAILURE }, 403, request, env);
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const secret = env?.ADMIN_SESSION_SECRET || env?.HMAC_SECRET || "";
    const session = secret ? await verifyToken(token, secret) : null;
    if (!session) return json({ ok: false, message: SAFE_FAILURE }, 401, request, env);
    if (!env?.LEADS_DB) return json({ ok: false, message: "LEADS_DB binding missing." }, 503, request, env);

    const rows = await env.LEADS_DB.prepare("SELECT form_type, COUNT(*) AS count FROM leads GROUP BY form_type").all();
    const suppression = await env.LEADS_DB.prepare("SELECT COUNT(*) AS count FROM suppression_list").first();
    const latest = await env.LEADS_DB.prepare("SELECT MAX(created_at) AS updated_at FROM leads").first();
    const counts = Object.fromEntries((rows.results || []).map((row) => [row.form_type, Number(row.count || 0)]));

    return json({
      leads: Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0),
      contactRequests: Number(counts.contact || 0),
      auditRequests: Number(counts.audit || 0),
      bookingRequests: Number(counts.booking || 0),
      microOfferRequests: Number(counts.micro_offer || 0),
      newsletterRequests: Number(counts.newsletter || 0),
      suppressions: Number(suppression?.count || 0),
      updatedAt: latest?.updated_at || new Date().toISOString(),
    }, 200, request, env);
  } catch (error) {
    console.error("admin metrics error", { error: error?.name || "unknown" });
    return json({ ok: false, message: SAFE_FAILURE }, 500, request, env);
  }
}

async function verifyToken(token, secret) {
  try {
    const [encodedPayload, signature] = token.split(".");
    if (!encodedPayload || !signature) return null;
    const expected = await hmacSha256(secret, encodedPayload);
    if (!timingSafeEqual(signature, expected)) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload)));
    if (!payload?.sub || !payload?.exp || Number(payload.exp) < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function hmacSha256(secret, value) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
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
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
  };
}

function json(body, status, request, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...corsHeaders(request, env) },
  });
}
