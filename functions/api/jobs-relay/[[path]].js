// Catch-all proxy from /api/jobs-relay/* → https://jobs.mehyar.us/api/*
// Same-origin bridge for the SPA's "Mayor Jobs" tab so the browser never talks
// to jobs.mehyar.us directly (CORS not allowlisted there, and provider keys
// must never live in browser code).
//
// Mirrors functions/api/admin-relay/[[path]].js.
//
// The dashboard admin Bearer token is forwarded verbatim; jobs.mehyar.us
// verifies it with env.MESC_JWT_SECRET (fallback ADMIN_JWT_SECRET), so that
// secret MUST equal this project's ADMIN_SESSION_SECRET — see
// docs/JOBS_RELAY_SETUP.md for the one-time setup step.

const JOBS_BASE = "https://jobs.mehyar.us";

function corsHeaders(request, env) {
  const origin = request.headers.get("origin") || "https://dashboard.mehyar.us";
  const allow = (env?.ALLOWED_ORIGINS || "https://dashboard.mehyar.us,https://mehyar.us").split(",").map((s) => s.trim());
  const allowedOrigin = allow.includes(origin) ? origin : "https://dashboard.mehyar.us";
  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
}

export async function onRequest({ request, env, params }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }

  // /api/jobs-relay/<path...> → https://jobs.mehyar.us/api/<path...>
  const rawSegments = Array.isArray(params?.path) ? params.path.join("/") : (params?.path || "");
  const url = new URL(request.url);
  const qs = url.searchParams.toString();
  const upstreamUrl = `${JOBS_BASE}/api/${rawSegments}${qs ? `?${qs}` : ""}`;

  // Forward body for non-GET methods
  let body = undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    try {
      body = await request.clone().arrayBuffer();
    } catch {
      body = undefined;
    }
  }

  // Copy headers, dropping hop-by-hop ones (Authorization goes through verbatim)
  const fwdHeaders = new Headers();
  for (const [k, v] of request.headers.entries()) {
    const kl = k.toLowerCase();
    if (["host", "cf-connecting-ip", "cf-ray", "cdn-loop"].includes(kl)) continue;
    fwdHeaders.set(k, v);
  }
  fwdHeaders.delete("origin");

  try {
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: fwdHeaders,
      body,
      redirect: "follow",
    });

    const headers = new Headers(upstream.headers);
    const ch = corsHeaders(request, env);
    for (const [k, v] of Object.entries(ch)) headers.set(k, v);
    headers.delete("cf-ray");
    headers.delete("cf-cache-status");

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "upstream_failed", message: e?.message || "unknown" }), {
      status: 502,
      headers: { "content-type": "application/json", ...corsHeaders(request, env) },
    });
  }
}
