// Catch-all proxy from /api/admin-relay/* → https://api.mehyar.us/v1/*
// Same-origin bridge for the SPA bundle. The bundle's API base is now
// /api/admin-relay (same-origin) so the SPA fetch goes to
// https://mehyar.us/api/admin-relay/admin/login etc. — no cross-origin,
// no CORS preflight, no service-worker-induced failures.
//
// Authorization header from the SPA (Bearer <token>) is forwarded verbatim
// to the Worker so admin auth still gates the protected endpoints.

const WORKER_BASE = "https://api.mehyar.us";

function corsHeaders(request, env) {
  const origin = request.headers.get("origin") || "https://mehyar.us";
  const allow = (env?.ALLOWED_ORIGINS || "https://mehyar.us,https://www.mehyar.us").split(",").map((s) => s.trim());
  const allowedOrigin = allow.includes(origin) ? origin : "https://mehyar.us";
  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
}

export async function onRequest({ request, env, params }) {
  const requestOrigin = request.headers.get("origin") || "";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }

  // Build upstream URL. params.path is an array of segments for [...path]
  // or a string for [[path]].join('/') whichever it is, just turn it into a path.
  // The SPA bundle prepends `/v1/...` to every admin path (its hardcoded segment)
  // AND our relay base is `/api/admin-relay`, so we end up with pathSegments
  // starting with `v1/...`. Strip the leading `v1/` so we don't double-up.
  const rawSegments = Array.isArray(params?.path) ? params.path.join("/") : (params?.path || "");
  let pathSegments = rawSegments.replace(/^v1\//, "");
  const url = new URL(request.url);
  const qs = url.searchParams.toString();
  const upstreamUrl = `${WORKER_BASE}/v1/${pathSegments}${qs ? `?${qs}` : ""}`;

  // Forward body for non-GET methods
  let body = undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    try {
      body = await request.clone().arrayBuffer();
    } catch {
      body = undefined;
    }
  }

  // Build headers — copy original headers but hop-by-hop ones are forbidden
  const fwdHeaders = new Headers();
  for (const [k, v] of request.headers.entries()) {
    const kl = k.toLowerCase();
    if (["host", "cf-connecting-ip", "cf-ray", "cdn-loop"].includes(kl)) continue;
    fwdHeaders.set(k, v);
  }
  // Origin header for the upstream must be stripped — Worker checks allowed origins
  fwdHeaders.delete("origin");

  try {
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: fwdHeaders,
      body,
      redirect: "follow",
    });

    // Stream the response back through with CORS headers
    const headers = new Headers(upstream.headers);
    const ch = corsHeaders(request, env);
    for (const [k, v] of Object.entries(ch)) headers.set(k, v);
    // CF sets some implicit ones we must not duplicate
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
