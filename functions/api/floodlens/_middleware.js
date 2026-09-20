// functions/api/floodlens/_middleware.js
// CORS for the FloodLens satellite site (https://floodlens.mehyar.us) calling
// the mehyar.us API. Handles preflight OPTIONS and stamps
// Access-Control-Allow-Origin on every response from this directory.
const ALLOWED = new Set(["https://floodlens.mehyar.us", "https://mehyar.us"]);

function corsHeaders(request) {
  const origin = request.headers.get("origin") || "";
  return {
    "access-control-allow-origin": ALLOWED.has(origin) ? origin : "https://floodlens.mehyar.us",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
  };
}

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(context.request) });
  }
  const res = await context.next();
  const headers = new Headers(res.headers);
  const cors = corsHeaders(context.request);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
