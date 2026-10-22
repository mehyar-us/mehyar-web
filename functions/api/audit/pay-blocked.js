// functions/api/audit/pay-blocked.js
// POST /api/audit/pay-blocked — { email, audit_id }
// Blocked-checkout notify-me for "Audit My Business" ($330). When Stripe
// isn't configured, the /audit/ pay step offers this instead of a dead-end
// "check back" toast: one click, we already hold their email from step 1,
// and the click IS the explicit consent (item 6).
//
// The caller must own the intake: SHA-256("audit-business|" + email) has to
// match the row's email_hash (same scheme as /api/pay/checkout audit_business).
// Records an idempotent capture. The future "checkout is back" email MUST
// carry the one-click unsubscribe link (compliance item 18); notify_token is
// minted here for that link.

import { sha256hex, normalizeUrl } from "../_shared/auditBusinessShared.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const AUDIT_ID_RE = /^[0-9a-f-]{36}$/i;

// Cheap in-memory rate limit: 10 captures / 15 min / IP (per isolate).
const RL = new Map();
function rateLimitOk(ip) {
  const now = Date.now();
  const arr = (RL.get(ip) || []).filter((ts) => now - ts < 15 * 60 * 1000);
  if (arr.length >= 10) return false;
  arr.push(now);
  RL.set(ip, arr);
  return true;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    if (!rateLimitOk(ip)) return json({ ok: false, error: "rate_limited" }, 429);

    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
    let auditId = String(body.audit_id || "").trim();
    if (!EMAIL_RE.test(email)) return json({ ok: false, error: "invalid_email" }, 400);

    const db = env.LEADS_DB;

    // Direct-buy lane (rot542, 2026-10-22): a direct buyer whose checkout is
    // blocked has no intake yet — create the row from the pay-point details
    // (same 'intake' state + email binding as the checkout hook's direct
    // branch) so the notify capture has a real audit to attach to, and hand
    // the id back so the client adopts the standard rails.
    if (!AUDIT_ID_RE.test(auditId) && body.direct === true) {
      const businessName = String(body.business_name || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
      const directUrl = normalizeUrl(String(body.url || "").trim().slice(0, 300));
      if (!businessName) return json({ ok: false, error: "missing_business_name" }, 400);
      if (!directUrl) return json({ ok: false, error: "invalid_url" }, 400);
      auditId = crypto.randomUUID();
      const directEmailHash = await sha256hex("audit-business|" + email);
      await db.prepare(
        "INSERT INTO audit_business_reports (id, email_hash, url, business_name, status, signals_json) VALUES (?, ?, ?, ?, 'intake', NULL)"
      ).bind(auditId, directEmailHash, directUrl, businessName).run();
      await db
        .prepare(
          "CREATE TABLE IF NOT EXISTS audit_pay_blocked (" +
            "email TEXT NOT NULL, audit_id TEXT NOT NULL, ip TEXT, " +
            "notify_token TEXT NOT NULL, notified INTEGER NOT NULL DEFAULT 0, " +
            "created_at TEXT NOT NULL DEFAULT (datetime('now')), " +
            "PRIMARY KEY (email, audit_id))"
        )
        .run()
        .catch(() => {});
      await db
        .prepare("INSERT INTO audit_pay_blocked (email, audit_id, ip, notify_token) VALUES (?, ?, ?, ?)")
        .bind(email, auditId, ip.slice(0, 64), crypto.randomUUID())
        .run();
      return json({ ok: true, audit_id: auditId });
    }
    if (!AUDIT_ID_RE.test(auditId)) return json({ ok: false, error: "invalid_audit_id" }, 400);
    const row = await db
      .prepare("SELECT id, email_hash FROM audit_business_reports WHERE id = ?")
      .bind(auditId)
      .first();
    if (!row) return json({ ok: false, error: "unknown_audit" }, 400);
    const emailHash = await sha256hex("audit-business|" + email);
    if (row.email_hash !== emailHash) return json({ ok: false, error: "audit_email_mismatch" }, 400);

    await db
      .prepare(
        "CREATE TABLE IF NOT EXISTS audit_pay_blocked (" +
          "email TEXT NOT NULL, audit_id TEXT NOT NULL, ip TEXT, " +
          "notify_token TEXT NOT NULL, notified INTEGER NOT NULL DEFAULT 0, " +
          "created_at TEXT NOT NULL DEFAULT (datetime('now')), " +
          "PRIMARY KEY (email, audit_id))"
      )
      .run()
      .catch(() => {});

    const existing = await db
      .prepare("SELECT notify_token FROM audit_pay_blocked WHERE email = ? AND audit_id = ?")
      .bind(email, auditId)
      .first()
      .catch(() => null);
    if (!existing) {
      await db
        .prepare("INSERT INTO audit_pay_blocked (email, audit_id, ip, notify_token) VALUES (?, ?, ?, ?)")
        .bind(email, auditId, ip.slice(0, 64), crypto.randomUUID())
        .run();
    }
    return json({ ok: true });
  } catch (e) {
    console.error("api/audit/pay-blocked failed", e && e.message);
    return json({ ok: false, error: "server_error" }, 500);
  }
}
