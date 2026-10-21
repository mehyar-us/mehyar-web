// functions/api/pay/credit-status.js
// POST /api/pay/credit-status { email } — display-side companion to the
// $5 Full Report credit. The Step-3 pay point asks this whether the
// buyer standing there is eligible (the exact rule checkout enforces,
// via _shared/credit.js) and, if so, shows the arithmetic with figures
// taken from billing_products + the credit — never from the client.
// Informational only: checkout remains the enforcer. A non-eligible or
// failed lookup simply leaves the standard pay display unchanged.
//
// Rate limit (2026-10-21, Clef ruling audit-credit-status-enumeration-
// 20261021): the endpoint stays unauthenticated and numbers-only — the
// pay-point display contract requires a pre-checkout lookup by email —
// but volume is capped (30 requests/minute) on TWO keys so the
// eligibility boolean cannot be harvested in bulk: per source IP, and
// per queried email (the per-email key binds even when a prober
// rotates egress IPs; a tripped email bucket only ever costs that
// email's display a minute — checkout enforces the credit server-side
// regardless). The limiter lives in D1 (shared across isolates) and
// FAILS OPEN: a limiter error never breaks the pay-point display, and
// a rate-limited buyer still checks out normally.

import { fullReportCreditCents } from "./_shared/credit.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT = 30;
const RATE_WINDOW_SEC = 60;

async function bump(db, key, win) {
  await db.prepare(
    "INSERT INTO credit_status_rate (ip, window_start, hits) VALUES (?, ?, 1) " +
    "ON CONFLICT(ip, window_start) DO UPDATE SET hits = hits + 1"
  ).bind(key, win).run();
  const row = await db.prepare(
    "SELECT hits FROM credit_status_rate WHERE ip = ? AND window_start = ?"
  ).bind(key, win).first();
  return row ? row.hits : 0;
}

async function overRateLimit(db, request, email) {
  try {
    const win = Math.floor(Date.now() / 1000 / RATE_WINDOW_SEC);
    const ip = String(request.headers.get("CF-Connecting-IP") || "unknown").slice(0, 64);
    if ((await bump(db, ip, win)) > RATE_LIMIT) return true;
    const emailHits = await bump(db, "e:" + email, win);
    if (emailHits > RATE_LIMIT) return true;
    if (emailHits === 1) {
      // First query of this email in a new window: sweep stale windows.
      await db.prepare("DELETE FROM credit_status_rate WHERE window_start < ?")
        .bind(win - 2).run().catch(() => {});
    }
    return false;
  } catch (e) {
    return false;
  }
}

export async function onRequestPost({ request, env }) {
  if (!env?.LEADS_DB) {
    return Response.json({ ok: false, error: "service_unavailable" }, { status: 503 });
  }
  const db = env.LEADS_DB;
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().toLowerCase().slice(0, 254);
  if (!EMAIL_RE.test(email)) {
    return Response.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }
  if (await overRateLimit(db, request, email)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  const product = await db.prepare(
    "SELECT price_cents FROM billing_products WHERE id = 'audit-my-business' AND active = 1"
  ).first();
  if (!product) {
    return Response.json({ ok: false, error: "invalid_product" }, { status: 400 });
  }
  const creditCents = await fullReportCreditCents(db, email);
  const listCents = product.price_cents;
  return Response.json({
    ok: true,
    eligible: creditCents > 0,
    credit_cents: creditCents,
    list_cents: listCents,
    due_cents: listCents - creditCents,
  });
}
