// functions/api/audit/notify.js
// POST /api/audit/notify — "notify me when checkout opens" lead capture for
// the Audit My Business page while live Stripe checkout is unavailable.
// Body: { email, audit_id? }
//
// Stores the address in the CRM subscribers table (brand='audit',
// status='pending') with explicit-consent attribution. The visitor opted in
// for exactly one thing: an email when $330 checkout opens. Unsubscribe is
// honored via /api/email/unsubscribe. Rate-limited per IP (best-effort).

import { sanitize, sha256hex } from "../_shared/auditBusinessShared.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const body = await request.json().catch(() => ({}));
    const email = sanitize(body.email, 254).toLowerCase();
    const auditId = sanitize(body.audit_id || body.auditId, 64);
    if (!EMAIL_RE.test(email)) return json({ ok: false, error: "invalid_email" }, 400);

    const clientIp = request.headers.get("cf-connecting-ip")
      || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (env?.INTAKE_KV) {
      const ipHash = await sha256hex("audit-notify|" + clientIp);
      const k = `audit:notify:${ipHash}`;
      const n = Number((await env.INTAKE_KV.get(k)) || "0");
      if (n >= 5) return json({ ok: false, error: "rate_limited", message: "Too many requests — try again tomorrow." }, 429);
      await env.INTAKE_KV.put(k, String(n + 1), { expirationTtl: 86400 });
    }

    const attribution = JSON.stringify({
      source: "audit-checkout-notify",
      consent: "notify_when_checkout_opens",
      audit_id: /^[0-9a-f-]{36}$/i.test(auditId || "") ? auditId : null,
      landing_page: "/audit/",
    });
    await env.LEADS_DB.prepare(
      "INSERT INTO subscribers_global (email, brand, status, attribution_json) VALUES (?, 'audit', 'pending', ?) " +
      "ON CONFLICT(email, brand) DO UPDATE SET attribution_json = excluded.attribution_json, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"
    ).bind(email, attribution).run();

    return json({ ok: true });
  } catch (e) {
    console.error("audit notify error", e && e.message);
    return json({ ok: false, error: "notify_failed" }, 500);
  }
}
