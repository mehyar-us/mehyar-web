// Dynamic proposal slugs need the SPA shell. Fetching the exact static index
// path avoids Pages' static 404 resolution for unknown nested URLs.
export async function onRequest({ request }) {
  const shellUrl = new URL("/index.html", request.url);
  const shell = await fetch(shellUrl.toString(), {
    headers: { accept: "text/html", "user-agent": "MehyarSoft-Proposal-Shell/1.0" },
  });
  if (!shell.ok) return new Response("Proposal shell unavailable", { status: 503 });
  const headers = new Headers(shell.headers);
  headers.set("cache-control", "public, max-age=60");
  headers.set("x-robots-tag", "noindex, nofollow");
  return new Response(shell.body, { status: 200, headers });
}
