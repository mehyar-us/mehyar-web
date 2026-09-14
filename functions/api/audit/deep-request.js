// functions/api/audit/deep-request.js
// POST /api/audit/deep-request — paid tier intake (manual invoice flow).
// Body: { email, name?, business?, url?, tier }
// Tiers: deep-199 ($199 Deep AI Audit), tech-330 ($330 Tech Audit), monitor-99 ($99/mo monitoring).
// Records the request, notifies the owner, confirms to the buyer.
// Payment is by manual invoice (ACH/wire/check) — no card form on this site.

import { sendCfEmail } from "../_shared/cfEmail.js";

const TIERS = {
  "deep-199": { name: "$199 Deep AI Audit", price: "$199 one-time", delivery: "3–5 business days" },
  "tech-330": { name: "$330 Tech Audit", price: "$330 one-time", delivery: "3–5 business days" },
  "monitor-99": { name: "$99/mo Site Monitoring", price: "$99/month", delivery: "First scan within 48 hours" },
};

const FROM_EMAIL = "audit@mehyar.us";
const OWNER_EMAIL = "info@mehyar.us";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
function sanitize(v, max = 200) {
  return String(v || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const body = await request.json().catch(() => ({}));
    const email = sanitize(body.email, 254).toLowerCase();
    const tier = TIERS[body.tier] ? body.tier : null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: "invalid_email" }, 400);
    if (!tier) return json({ ok: false, error: "invalid_tier" }, 400);
    const name = sanitize(body.name, 120);
    const business = sanitize(body.business, 160);
    const url = sanitize(body.url, 300);
    const t = TIERS[tier];

    // Upsert lead.
    const existing = await env.LEADS_DB.prepare("SELECT id FROM audit_leads WHERE email = ? ORDER BY id DESC LIMIT 1").bind(email).first();
    if (existing?.id) {
      await env.LEADS_DB.prepare(
        "UPDATE audit_leads SET name = COALESCE(NULLIF(?, ''), name), business = COALESCE(NULLIF(?, ''), business), url = COALESCE(NULLIF(?, ''), url), deep_status = 'requested', deep_requested_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
      ).bind(name, business, url, existing.id).run();
    } else {
      // New buyer: the website URL is required — it's a website audit.
      if (!url) return json({ ok: false, error: "invalid_url", message: "Your website URL is required for the audit." }, 400);
      await env.LEADS_DB.prepare(
        "INSERT INTO audit_leads (email, name, business, url, deep_status, deep_requested_at, source) VALUES (?, ?, ?, ?, 'requested', strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'site')"
      ).bind(email, name || null, business || null, url).run();
    }
    // Stop the sales drip — they're converting.
    await env.LEADS_DB.prepare("UPDATE audit_leads SET unsubscribed = 0 WHERE email = ?").bind(email).run();

    // Owner + buyer notifications via the verified Cloudflare Email Sending
    // API path (_shared/cfEmail.js) — no send_email binding required.
    {
      const n = await sendCfEmail(env, {
        from: `MehyarSoft Audit <${FROM_EMAIL}>`,
        to: OWNER_EMAIL,
        subject: `💰 ${t.name} requested — ${business || email}`,
        text: `PAID AUDIT REQUEST\nTier: ${t.name} (${t.price})\nEmail: ${email}\nName: ${name || "-"}\nBusiness: ${business || "-"}\nURL: ${url || "-"}\n\nNext: send a manual invoice (ACH/wire/check) and confirm scope.`,
      });
      if (!n.ok) console.error("deep-request owner notify failed", n.error);
      const c = await sendCfEmail(env, {
        from: `MehyarSoft Audit <${FROM_EMAIL}>`,
        to: email,
        subject: `Your ${t.name} is reserved — next step`,
        text: `Thanks${name ? " " + name : ""} — your ${t.name} (${t.price}) is reserved.\n\nDelivery: ${t.delivery}.\n\nNext step: we'll send a manual invoice with ACH/wire/check instructions. Once it's settled, the audit starts — no card form, no surprises.\n\nQuestions? Just reply to this email.\n\n— MehyarSoft`,
        replyTo: OWNER_EMAIL,
      });
      if (!c.ok) console.error("deep-request buyer confirm failed", c.error);
    }
    return json({ ok: true, tier, message: "Request received. We'll send your invoice shortly." });
  } catch (e) {
    console.error("deep-request error", e?.message);
    return json({ ok: false, error: "request_failed" }, 500);
  }
}
