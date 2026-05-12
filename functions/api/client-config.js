const TURNSTILE_SITE_KEY_PATTERN = /^0x[A-Za-z0-9_-]{16,}$/;

export async function onRequestGet({ env }) {
  const turnstileSiteKey = safePublicTurnstileSiteKey(env);
  return json({
    ok: Boolean(turnstileSiteKey),
    turnstileSiteKey,
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function safePublicTurnstileSiteKey(env) {
  const candidate = typeof env?.VITE_TURNSTILE_SITE_KEY === "string"
    ? env.VITE_TURNSTILE_SITE_KEY.trim()
    : typeof env?.TURNSTILE_SITE_KEY === "string"
      ? env.TURNSTILE_SITE_KEY.trim()
      : "";
  return TURNSTILE_SITE_KEY_PATTERN.test(candidate) ? candidate : "";
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...corsHeaders(),
    },
  });
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type, accept",
  };
}
