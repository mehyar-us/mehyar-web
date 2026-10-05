// functions/api/carerank/subscribe.js
// POST /api/carerank/subscribe — free-tier lead capture for CareRank.
//
// Body: { email: "a@b.com", quiz: {...} }  (quiz optional)
//
// Single opt-in (no double opt-in). Flow:
//   1. Validate email.
//   2. If the email is in carerank_suppressions → {ok:false, error:"unsubscribed"}.
//   3. Rate-limit by IP: max 5/day (D1 table carerank_rate_limits).
//   4. Upsert carerank_leads (email UNIQUE, brand='carerank', status='active').
//   5. STAGE (do NOT send) the free blurred-result link email into
//      carerank_outbox with an unsubscribe footer. Sending is blocked by the
//      Mayor's no-send rule — see ../_shared/carerankNoSend.js.

import { sendCloudflareEmail } from "../_shared/cloudflareEmail.js";
import {
  carerankUnsubUrl,
  carerankListUnsubscribeHeaders,
} from "../_shared/carerankUnsub.js";
import { maybeSendCarerankEmail } from "../_shared/carerankNoSend.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BASE_URL = "https://carerank.mehyar.us";

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extraHeaders },
  });
}

// CORS for cross-origin brand calls (carerank.mehyar.us -> mehyar.us).
// Only *.mehyar.us origins are reflected; everything else gets no CORS headers.
// (Same pattern as functions/api/pay/checkout.js.)
function corsHeaders(request) {
  const origin = (request.headers.get("Origin") || "").trim();
  if (/^https:\/\/([a-z0-9-]+\.)?mehyar\.us$/i.test(origin)) {
    return { "access-control-allow-origin": origin, vary: "Origin" };
  }
  return {};
}

export async function onRequestOptions({ request }) {
  const cors = corsHeaders(request);
  return new Response(null, {
    status: 204,
    headers: {
      ...cors,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
    },
  });
}

function sanitize(v, max) {
  return String(v || "")
    .replace(/[^ -~\u00A0-\uFFFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max || 200);
}

function randomToken(bytes = 16) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
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
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS carerank_rate_limits (" +
      "ip TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, " +
      "PRIMARY KEY (ip, day))"
    )
    .run();
}

export async function onRequestPost({ request, env }) {
  try {
    const cors = corsHeaders(request);
    const J = (data, status = 200) => json(data, status, cors);
    const db = env && env.LEADS_DB;
    if (!db || typeof db.prepare !== "function") {
      return J({ ok: false, error: "db_unavailable" }, 500);
    }
    await ensureSchema(db);

    const body = await request.json().catch(() => ({}));
    const email = sanitize(body.email, 254).toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return J({ ok: false, error: "invalid_email" }, 400);
    }

    // 1. Suppression check.
    const suppressed = await db
      .prepare("SELECT email FROM carerank_suppressions WHERE email = ?")
      .bind(email)
      .first();
    if (suppressed) {
      return J({ ok: false, error: "unsubscribed" }, 200);
    }

    // 2. Rate limit: max 5 subscribes per IP per UTC day.
    const ip =
      request.headers.get("cf-connecting-ip") ||
      (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      "unknown";
    const day = new Date().toISOString().slice(0, 10);
    await db
      .prepare("INSERT INTO carerank_rate_limits (ip, day, count) VALUES (?, ?, 1) ON CONFLICT(ip, day) DO UPDATE SET count = count + 1")
      .bind(ip.slice(0, 64), day)
      .run();
    const rl = await db
      .prepare("SELECT count FROM carerank_rate_limits WHERE ip = ? AND day = ?")
      .bind(ip.slice(0, 64), day)
      .first();
    if (rl && Number(rl.count) > 5) {
      return J({ ok: false, error: "rate_limited" }, 429);
    }

    // 3. Upsert the lead (keep the existing access token so the free blurred
    //    link stays stable across re-subscribes).
    const quiz = body.quiz && typeof body.quiz === "object" ? body.quiz : {};
    const existing = await db
      .prepare("SELECT access_token FROM carerank_leads WHERE email = ?")
      .bind(email)
      .first();
    let leadToken = existing && existing.access_token;
    if (!leadToken) {
      leadToken = randomToken(16);
      await db
        .prepare(
          "INSERT INTO carerank_leads (email, brand, status, quiz_json, access_token) VALUES (?, 'carerank', 'active', ?, ?)"
        )
        .bind(email, JSON.stringify(quiz).slice(0, 4000), leadToken)
        .run();
    } else {
      await db
        .prepare(
          "UPDATE carerank_leads SET status='active', quiz_json=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE email=?"
        )
        .bind(JSON.stringify(quiz).slice(0, 4000), email)
        .run();
    }

    // 4. Stage (do NOT send) the free blurred-result link email.
    const resultsUrl = `${BASE_URL}/results.html?lead=${leadToken}`;
    const unsubUrl = await carerankUnsubUrl(env, email);
    if (!unsubUrl) console.error("carerank subscribe: CARERANK_UNSUB_SECRET missing — email staged without one-click link");
    const subject = "Your free CareRank shortlist preview";
    const text =
      `Thanks for taking the CareRank quiz!\n\n` +
      `Your free preview — the top nursing homes near you, with names blurred — is here:\n${resultsUrl}\n\n` +
      `Want the full picture? The paid CareRank Shortlist Report ($29) unblurs every name and adds a fit score plus exactly what to look for — and what to watch out for — at each home, based on federal CMS data.\n\n` +
      `This link is personal to you — keep it somewhere safe.\n\n` +
      `-- CareRank\n\n` +
      `---\nDon't want CareRank emails? Unsubscribe in one click: ${unsubUrl || "reply STOP"}`;
    const html =
      `<p>Thanks for taking the CareRank quiz!</p>` +
      `<p>Your free preview — the top nursing homes near you, with names blurred — is here:</p>` +
      `<p><a href="${resultsUrl}" style="display:inline-block;background:#0e7c61;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">See my free preview</a></p>` +
      `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${resultsUrl}">${resultsUrl}</a></p>` +
      `<p style="color:#6b7280;font-size:13px;">Want the full picture? The paid <strong>CareRank Shortlist Report ($29)</strong> unblurs every name and adds a fit score plus exactly what to look for — and what to watch out for — at each home, based on federal CMS data.</p>` +
      `<p>-- CareRank</p>` +
      `<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">` +
      `<p style="color:#9ca3af;font-size:12px;">Don't want CareRank emails? ` +
      (unsubUrl ? `<a href="${unsubUrl}">Unsubscribe in one click</a>.` : `Reply STOP and we'll remove you.`) + `</p>`;
    // STAGING GUARD (Mayor's no-send rule): the payload is stored in
    // carerank_outbox for audit; nothing is sent until he explicitly approves.
    const emailArgs = {
      from: "team@mehyar.us",
      fromName: "CareRank",
      to: email,
      replyTo: "info@mehyar.us",
      subject,
      text,
      html,
      headers: carerankListUnsubscribeHeaders(unsubUrl),
    };
    const result = await maybeSendCarerankEmail(
      db,
      () => sendCloudflareEmail(env, emailArgs),
      { kind: "subscribe", unsubUrl, args: emailArgs }
    );
    if (!result.ok) {
      console.error("carerank subscribe email failed", result.error);
      return J({ ok: true, email_ok: false, lead_token: leadToken });
    }
    return J({ ok: true, lead_token: leadToken, email_staged: !!result.staged });
  } catch (e) {
    console.error("carerank subscribe failed", e && e.message);
    return J({ ok: false, error: "server_error" }, 500);
  }
}
