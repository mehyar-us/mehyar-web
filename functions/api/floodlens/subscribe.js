// functions/api/floodlens/subscribe.js
// POST /api/floodlens/subscribe — free-tier email capture (double opt-in).
// Body: { email, lookup_token }
// Stores in the brand table AND the global subscriber table (brand-tagged),
// then sends a confirmation email from team@mehyar.us (until
// floodlens.mehyar.us is ESP-onboarded). Transactional only — the staged
// drip is never sent from here.

import { sendCloudflareEmail } from "../_shared/cloudflareEmail.js";
import { randomToken, isFloodlensSuppressed } from "../_shared/floodlensCore.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const db = env.LEADS_DB;

    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
    const lookupToken = String(body.lookup_token || "").trim().slice(0, 128);
    if (!EMAIL_RE.test(email)) return json({ ok: false, error: "invalid_email" }, 400);
    if (!lookupToken) return json({ ok: false, error: "missing_lookup_token" }, 400);

    const lookup = await db
      .prepare("SELECT token, address, zone, risk_plain FROM floodlens_lookups WHERE token = ? AND zone IS NOT NULL")
      .bind(lookupToken)
      .first();
    if (!lookup) return json({ ok: false, error: "unknown_lookup_token" }, 400);

    // Suppressed (brand or global)? Stay silent — never re-enable, never email.
    if (await isFloodlensSuppressed(db, email)) {
      return json({ ok: true, message: "Check your email to confirm." });
    }

    // Already confirmed? Stay quiet and idempotent.
    const existing = await db
      .prepare("SELECT status, confirm_token, unsubscribed FROM floodlens_subscribers WHERE email = ?")
      .bind(email)
      .first();
    const confirmToken = (existing && existing.confirm_token) || randomToken(32);

    await db.prepare(
      "INSERT INTO floodlens_subscribers (email, status, brand, lookup_token, confirm_token, source) " +
      "VALUES (?, 'pending', 'floodlens', ?, ?, 'free-lookup') " +
      "ON CONFLICT(email) DO UPDATE SET status=CASE WHEN floodlens_subscribers.status='confirmed' THEN 'confirmed' ELSE 'pending' END, " +
      "lookup_token=excluded.lookup_token, confirm_token=excluded.confirm_token, unsubscribed=0, unsubscribed_at=NULL"
    ).bind(email, lookupToken, confirmToken).run();

    await db.prepare(
      "INSERT INTO subscribers_global (email, brand, status) VALUES (?, 'floodlens', 'pending') " +
      "ON CONFLICT(email, brand) DO UPDATE SET status=CASE WHEN subscribers_global.status='confirmed' THEN 'confirmed' ELSE 'pending' END, " +
      "unsubscribed=0, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')"
    ).bind(email).run();

    if (!existing || existing.status !== "confirmed") {
      const confirmUrl = `https://mehyar.us/api/floodlens/confirm?token=${confirmToken}`;
      const unsubUrl = `https://mehyar.us/api/floodlens/unsubscribe?token=${confirmToken}`;
      const subject = "Confirm your FloodLens zone breakdown";
      const text =
        `One click and we'll send the full breakdown for:\n${lookup.address}\nZone ${lookup.zone} — ${lookup.risk_plain}\n\n` +
        `Confirm here:\n${confirmUrl}\n\n` +
        `Not an official flood determination.\n\n` +
        `Don't want these emails? ${unsubUrl}\n\n-- FloodLens`;
      const html =
        `<p>One click and we'll send the full breakdown for:</p>` +
        `<p><strong>${escapeHtml(lookup.address)}</strong><br>Zone ${escapeHtml(lookup.zone)} — ${escapeHtml(lookup.risk_plain)}</p>` +
        `<p><a href="${confirmUrl}" style="display:inline-block;background:#0a5cc2;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Confirm my email</a></p>` +
        `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${confirmUrl}">${confirmUrl}</a></p>` +
        `<p style="color:#6b7280;font-size:13px;">Not an official flood determination.</p>` +
        `<p style="color:#9aa3b2;font-size:12px;"><a href="${unsubUrl}" style="color:#9aa3b2;">Unsubscribe</a></p>` +
        `<p>-- FloodLens</p>`;
      const result = await sendCloudflareEmail(env, {
        from: env.FLOODLENS_FROM_EMAIL || "team@mehyar.us",
        fromName: "FloodLens",
        to: email,
        replyTo: "info@mehyar.us",
        subject, text, html,
        headers: {
          "List-Unsubscribe": `<${unsubUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
      if (!result.ok) console.error("floodlens subscribe confirm email failed", result.error);
    }

    return json({ ok: true, message: "Check your email to confirm." });
  } catch (e) {
    console.error("floodlens subscribe failed", e && e.message);
    return json({ ok: false, error: "subscribe_failed" }, 500);
  }
}

function escapeHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
