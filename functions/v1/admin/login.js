// POST /v1/admin/login
//
// Same-origin bridge for the SPA admin login. The SPA bundle hardcodes
// `fetch("https://api.mehyar.us/v1/admin/login", ...)` and some user environments
// (stale service workers, ad-blockers, corporate proxies) block that
// cross-origin POST with a "Failed to fetch" error.
//
// Pages Functions mounted at `functions/v1/admin/login.js` ALSO serve from the
// Pages default hostname (mehyar-web.pages.dev) — and this is the SAME origin
// as the SPA if we mount it under mehyar.us. But Mehyar.us is a custom domain
// CNAME on Pages, so functions under `functions/v1/...` are reachable at
// `https://mehyar.us/v1/admin/login` — same origin, no CORS, no SW trap.
//
// We forward credentials to the real Worker and shape the response so the
// SPA's existing shape contract still holds.

async function relay(request, env) {
  // Construct outgoing Worker URL — same one the SPA used to call directly
  const workerBase = env?.WORKER_BASE_URL || "https://api.mehyar.us";
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "bad_json" }), {
      status: 400,
      headers: { "content-type": "application/json", ...corsHeaders(request, env) },
    });
  }
  let upstream;
  try {
    const r = await fetch(`${workerBase}/v1/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const raw = await r.text();
    try { upstream = JSON.parse(raw); } catch { upstream = { ok: r.ok, raw: raw.slice(0, 200) }; }
    return new Response(
      JSON.stringify({ ...upstream, ok: r.ok && !upstream.error }),
      {
        status: r.status,
        headers: {
          "content-type": "application/json; charset=utf-8",
          ...corsHeaders(request, env),
        },
      }
    );
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "upstream_failed", message: e?.message || "unknown" }), {
      status: 502,
      headers: { "content-type": "application/json", ...corsHeaders(request, env) },
    });
  }
}

function corsHeaders(request, env) {
  const origin = request.headers.get("origin") || "https://mehyar.us";
  const allow = (env?.ALLOWED_ORIGINS || "https://mehyar.us,https://www.mehyar.us").split(",").map((s) => s.trim());
  const allowedOrigin = allow.includes(origin) ? origin : "https://mehyar.us";
  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "vary": "Origin",
  };
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }
  if (request.method === "POST") {
    return relay(request, env);
  }
  return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
    status: 405,
    headers: { "content-type": "application/json", ...corsHeaders(request, env) },
  });
}
