// functions/api/audit/full-report/pay-blocked.js
// POST /api/audit/full-report/pay-blocked — { email, url }
// Blocked-checkout notify-me for the $5 full report. When Stripe isn't
// configured, the /audit/report buy card offers this instead of a dead-end
// "check back" message: the buyer already typed their email + site into the
// form, and the notify click IS the explicit consent (item 6).
//
// Records an idempotent capture in LEADS_DB. The future "checkout is back"
// email MUST carry the one-click unsubscribe link (compliance item 18);
// notify_token is minted here for that link. Mirrors the $330 pattern in
// functions/api/audit/pay-blocked.js (which is intake-bound and can't serve
// this product).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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
    const url = String(body.url || "").trim().slice(0, 512);
    if (!EMAIL_RE.test(email)) return json({ ok: false, error: "invalid_email" }, 400);
    if (!url) return json({ ok: false, error: "invalid_url" }, 400);

    const db = env.LEADS_DB;
    await db
      .prepare(
        "CREATE TABLE IF NOT EXISTS audit_report_pay_blocked (" +
          "email TEXT NOT NULL, url TEXT NOT NULL, ip TEXT, " +
          "notify_token TEXT NOT NULL, notified INTEGER NOT NULL DEFAULT 0, " +
          "created_at TEXT NOT NULL DEFAULT (datetime('now')), " +
          "PRIMARY KEY (email, url))"
      )
      .run()
      .catch(() => {});

    const existing = await db
      .prepare("SELECT notify_token FROM audit_report_pay_blocked WHERE email = ? AND url = ?")
      .bind(email, url)
      .first()
      .catch(() => null);
    if (!existing) {
      await db
        .prepare("INSERT INTO audit_report_pay_blocked (email, url, ip, notify_token) VALUES (?, ?, ?, ?)")
        .bind(email, url, ip.slice(0, 64), crypto.randomUUID())
        .run();
    }
    return json({ ok: true });
  } catch (e) {
    console.error("api/audit/full-report/pay-blocked failed", e && e.message);
    return json({ ok: false, error: "server_error" }, 500);
  }
}
