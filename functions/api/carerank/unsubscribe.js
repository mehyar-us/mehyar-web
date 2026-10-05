// functions/api/carerank/unsubscribe.js
// GET /api/carerank/unsubscribe?e=<email>&t=<token> — brand-level one-click
// unsubscribe for CareRank.
//
// token = HMAC-SHA256(lowercase-email, CARERANK_UNSUB_SECRET) hex (see
// ../_shared/carerankUnsub.js). CARERANK_UNSUB_SECRET is a DASHBOARD-ONLY env
// var on the mehyar-web Pages project — never committed.
//
// RFC 8058: the GET itself unsubscribes immediately and renders a
// CareRank-branded confirmation page. A POST with the same params is also
// accepted for List-Unsubscribe-Post clients (mailto clients post
// List-Unsubscribe=One-Click). Suppressions land in carerank_suppressions
// (email UNIQUE) and carerank_leads rows flip to status='unsubscribed'.
// The subscribe endpoint checks carerank_suppressions before re-adding.

import {
  carerankUnsubSecret,
  verifyCarerankUnsub,
} from "../_shared/carerankUnsub.js";

function page(title, heading, body) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${title} — CareRank</title><style>` +
      `body{margin:0;background:#f3f7f5;color:#1f2937;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}` +
      `.card{max-width:520px;text-align:center;background:#ffffff;border:1px solid #d7e6df;border-radius:16px;padding:40px 32px;box-shadow:0 8px 30px rgba(14,124,97,.08)}` +
      `.h{font-size:24px;font-weight:700;margin:0 0 12px;color:#0b3d30}` +
      `.p{color:#4b5563;font-size:15px;line-height:1.6}` +
      `.brand{margin-top:24px;font-size:12px;color:#9ca3af;letter-spacing:.08em;text-transform:uppercase}` +
      `.check{display:inline-block;width:52px;height:52px;border-radius:50%;background:#0e7c61;color:#fff;font-size:26px;line-height:52px;margin-bottom:16px}` +
      `a{color:#0e7c61}` +
      `</style></head><body><div class="card">` +
      `<div class="check">✓</div>` +
      `<div class="h">${heading}</div><p class="p">${body}</p>` +
      `<div class="brand">CareRank · carerank.mehyar.us</div></div></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );
}

async function ensureSchema(db) {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS carerank_suppressions (" +
      "email TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))"
    )
    .run();
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS carerank_leads (" +
      "email TEXT PRIMARY KEY, brand TEXT NOT NULL DEFAULT 'carerank', status TEXT NOT NULL DEFAULT 'active', " +
      "quiz_json TEXT, access_token TEXT, " +
      "created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), " +
      "updated_at TEXT)"
    )
    .run();
}

async function handle(request, env) {
  const url = new URL(request.url);
  let email = (url.searchParams.get("e") || "").trim().toLowerCase();
  let token = (url.searchParams.get("t") || "").trim();
  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    email = email || String(body.e || body.email || "").trim().toLowerCase();
    token = token || String(body.t || body.token || "").trim();
  }

  const invalid = () =>
    page(
      "Unsubscribe",
      "Something's off",
      "That unsubscribe link looks incomplete or isn't valid. Every CareRank email has a working unsubscribe link — please use the one in your latest email."
    );

  if (!email || !token) return invalid();
  const secret = carerankUnsubSecret(env);
  if (!secret) {
    console.error("carerank unsubscribe: CARERANK_UNSUB_SECRET not configured");
    return invalid();
  }
  const ok = await verifyCarerankUnsub(email, token, secret);
  if (!ok) return invalid();

  // RFC 8058 one-click: the GET itself performs the unsubscribe.
  const db = env && env.LEADS_DB;
  if (db && typeof db.prepare === "function") {
    await ensureSchema(db);
    await db
      .prepare("INSERT OR IGNORE INTO carerank_suppressions (email) VALUES (?)")
      .bind(email)
      .run();
    await db
      .prepare("UPDATE carerank_leads SET status='unsubscribed', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE email=?")
      .bind(email)
      .run();
  }

  return page(
    "Unsubscribed",
    "You're unsubscribed",
    "Done — you won't hear from CareRank again. If this was a mistake, just reply to any of our emails and we'll add you back."
  );
}

export async function onRequestGet(context) {
  try {
    return await handle(context.request, context.env);
  } catch (e) {
    console.error("carerank unsubscribe failed", e && e.message);
    return page("Unsubscribe", "Hmm", "We couldn't process that right now — please try again in a minute.");
  }
}

export async function onRequestPost(context) {
  try {
    return await handle(context.request, context.env);
  } catch (e) {
    console.error("carerank unsubscribe POST failed", e && e.message);
    return new Response(JSON.stringify({ ok: false }), {
      status: 500,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
}
