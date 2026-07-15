// CF Pages Function catch-all that serves the SPA shell for /q/<slug>.
//
// Normally CF Pages honors _redirects (`/* → /index.html 200`) but for
// some reason `/q/abc` paths on this project return the 404.html instead
// of the SPA shell. We intercept /q/<anything> and proxy to index.html
// so the client-side QuoteView component can render the dynamic slug.

import { corsHeaders } from "../api/_shared/adminAuth.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const path = url.pathname;

  // Only handle /q/<slug> (slug may be anything non-empty)
  const m = path.match(/^\/q\/([^\/]+)\/?$/);
  if (!m) {
    return new Response("Not Found", { status: 404, headers: corsHeaders(request, env) });
  }
  const slug = m[1];

  // Serve the same index.html shell that wouter uses for everything else.
  try {
    const indexUrl = new URL("/index.html", url.origin);
    const resp = await fetch(indexUrl.toString(), {
      headers: { "User-Agent": "CF-Pages-QMiddleware" },
    });
    if (!resp.ok) {
      return new Response("Shell unavailable", { status: 502, headers: corsHeaders(request, env) });
    }
    const body = await resp.text();
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=60",
        ...corsHeaders(request, env),
      },
    });
  } catch (e) {
    return new Response("Shell fetch failed: " + (e?.message || String(e)), {
      status: 500,
      headers: corsHeaders(request, env),
    });
  }
}

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}
