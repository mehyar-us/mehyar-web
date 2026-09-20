// functions/api/sproutscore/unsubscribe.js
// SproutScore one-click unsubscribe (RFC 8058 style).
//
// GET  /api/sproutscore/unsubscribe?email=<buyer>&token=<order access_token>
//   The GET itself unsubscribes (one-click) and renders a confirmation page.
// POST /api/sproutscore/unsubscribe
//   JSON body {email, token} — same effect, for List-Unsubscribe-Post
//   clients and the product's own unsubscribe form.
//
// The token must be a live sproutscore_orders access_token for that email
// (or a matching billing_payments access_token with brand sproutscore) —
// this keeps arbitrary addresses from being suppressed by third parties.
// Writes per-product suppression (sproutscore_suppressions) AND mirrors to
// the global suppression_list (see _shared/sproutscoreSuppression.js).

import { suppressEmail, normalizeEmail, validEmail } from "../_shared/sproutscoreSuppression.js";

function page(title, heading, body) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${title} — SproutScore</title><style>` +
      `body{margin:0;background:#f0fdf4;color:#14532d;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}` +
      `.card{max-width:520px;text-align:center;background:#fff;border:1px solid #bbf7d0;border-radius:16px;padding:40px 32px}` +
      `.h{font-size:24px;font-weight:700;margin:0 0 12px}` +
      `.p{color:#3f6212;font-size:15px;line-height:1.6}` +
      `.brand{margin-top:24px;font-size:12px;color:#86a389;letter-spacing:.08em;text-transform:uppercase}` +
      `a{color:#15803d}` +
      `</style></head><body><div class="card">` +
      `<div class="h">${heading}</div><p class="p">${body}</p>` +
      `<div class="brand">SproutScore · MehyarSoft</div></div></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function verifyToken(db, email, token) {
  const em = normalizeEmail(email);
  if (!validEmail(em) || !token || String(token).length < 16) return false;
  const order = await db
    .prepare("SELECT id FROM sproutscore_orders WHERE access_token = ? AND lower(email) = lower(?)")
    .bind(String(token), em)
    .first()
    .catch(() => null);
  if (order) return true;
  const pay = await db
    .prepare("SELECT id FROM billing_payments WHERE access_token = ? AND lower(email) = lower(?) AND brand = 'sproutscore'")
    .bind(String(token), em)
    .first()
    .catch(() => null);
  return !!pay;
}

async function handle(request, env) {
  const db = env.LEADS_DB;
  if (!db) {
    if (request.method === "POST") return json({ ok: false, error: "db_unavailable" }, 500);
    return page("Unsubscribe", "Something's off", "We couldn't process that right now — please try again in a minute.");
  }
  const url = new URL(request.url);
  let email = url.searchParams.get("email");
  let token = url.searchParams.get("token");
  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    email = email || body.email;
    token = token || body.token;
  }
  const em = normalizeEmail(email);
  if (!validEmail(em)) {
    if (request.method === "POST") return json({ ok: false, error: "invalid_email" }, 400);
    return page("Unsubscribe", "Something's off", "That unsubscribe link looks incomplete. Please use the link from your latest SproutScore email.");
  }
  const okToken = await verifyToken(db, em, token);
  if (!okToken) {
    if (request.method === "POST") return json({ ok: false, error: "invalid_token" }, 403);
    return page("Unsubscribe", "Something's off", "That unsubscribe link isn't valid. Please use the link from your latest SproutScore email.");
  }
  await suppressEmail(db, env, em, "unsubscribe_request", "sproutscore");
  if (request.method === "POST") return json({ ok: true, status: "suppressed" });
  return page(
    "Unsubscribed",
    "You're unsubscribed",
    "Done — no more SproutScore updates to " + em.replace(/</g, "&lt;") + ". Your purchased reports stay available at your personal link."
  );
}

export async function onRequestGet(context) {
  try {
    return await handle(context.request, context.env);
  } catch (e) {
    console.error("sproutscore unsubscribe GET failed", e && e.message);
    return page("Unsubscribe", "Something's off", "We couldn't process that right now — please try again in a minute.");
  }
}

export async function onRequestPost(context) {
  try {
    return await handle(context.request, context.env);
  } catch (e) {
    console.error("sproutscore unsubscribe POST failed", e && e.message);
    return json({ ok: false, error: "failed" }, 500);
  }
}
