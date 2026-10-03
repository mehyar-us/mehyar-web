/**
 * YouTube OAuth callback — captures the authorization code after the owner
 * approves the youtube.upload consent, stores it briefly in D1, and shows a
 * confirmation page. The code is exchanged server-side for tokens immediately
 * after; this row is single-use (id=1 upsert).
 */
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  const html = (body) =>
    new Response(`<!doctype html><html><body style="font-family:sans-serif;padding:40px"><h1>${body}</h1><p>You can close this tab.</p></body></html>`, {
      headers: { "Content-Type": "text/html" },
    });
  if (!code) return html("Connection failed: " + (err || "no code received"));
  try {
    await context.env.LEADS_DB.prepare(
      "CREATE TABLE IF NOT EXISTS yt_oauth_code (id INTEGER PRIMARY KEY CHECK (id = 1), code TEXT, created_at TEXT)"
    ).run();
    await context.env.LEADS_DB.prepare(
      "INSERT OR REPLACE INTO yt_oauth_code (id, code, created_at) VALUES (1, ?, datetime('now'))"
    )
      .bind(code)
      .run();
  } catch (e) {
    return html("Connection failed: storage error");
  }
  return html("YouTube connected successfully!");
}
