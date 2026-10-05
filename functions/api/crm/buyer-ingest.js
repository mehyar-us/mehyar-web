// functions/api/crm/buyer-ingest.js (STAGED 2026-10-05 — NEW FILE, tracking-crm-fix)
// POST /api/crm/buyer-ingest — secret-gated buyer record for checkouts that
// do NOT run on the centralized mehyar-web Stripe path (Rizza/Base44,
// AI Mechanic). Writes ONLY the CRM side (subscribers_global +
// buyers_rollup) — never fabricates billing_payments ledger rows.
//
// Body: {
//   secret:        "...",              (CRM_INGEST_SECRET, server-to-server only)
//   email:         "buyer@example.com" (required)
//   brand:         "rizza"             (required — matches billing_products.brand)
//   amount_cents:  999                 (required — what was collected)
//   attribution:   { utm_source, ... } (optional — MSRC blob)
//   customer_name / billing_city / billing_state / billing_country (optional)
// }
//
// DEPLOY ORDER: (1) apply 0033 migration, (2) set CRM_INGEST_SECRET in the
// mehyar-web production env, (3) push via GitHub Actions push-to-main.
// NEVER wrangler pages deploy.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ATTR_KEYS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "gclid", "fbclid", "msclkid", "ttclid", "wbraid", "gbraid",
  "referrer", "landing_page", "landing_ts", "click_ids",
];

function cleanAttr(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const k of ATTR_KEYS) {
    const v = String(raw[k] == null ? "" : raw[k]).slice(0, 300);
    if (v) out[k] = v;
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

function clean(v, max) {
  return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, max || 160) || null;
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    if (!env.CRM_INGEST_SECRET) return json({ ok: false, error: "not_configured" }, 503);
    const body = await request.json().catch(() => ({}));
    const secret = String(body.secret || "");
    if (secret.length < 16 || secret !== env.CRM_INGEST_SECRET) {
      return json({ ok: false, error: "bad_secret" }, 403);
    }

    const email = clean(body.email, 254).toLowerCase();
    const brand = clean(body.brand, 60).toLowerCase() || "unknown";
    const amountCents = Math.max(0, Math.floor(Number(body.amount_cents) || 0));
    if (!EMAIL_RE.test(email)) return json({ ok: false, error: "invalid_email" }, 400);
    if (amountCents <= 0) return json({ ok: false, error: "invalid_amount" }, 400);

    const db = env.LEADS_DB;
    const attributionJson = cleanAttr(body.attribution);

    // subscribers_global — the brand CRM list. Idempotent on (email, brand).
    // Suppression-safe: never re-activates an opted-out row.
    try {
      await db.prepare(
        "INSERT INTO subscribers_global (email, brand, status, converted, " +
        "first_order_at, last_order_at, total_spent_cents, attribution_json, updated_at) " +
        "VALUES (?, ?, 'active', 1, " + nowSql + ", " + nowSql + ", ?, ?, " + nowSql + ") " +
        "ON CONFLICT(email, brand) DO UPDATE SET " +
        "status=CASE WHEN subscribers_global.status='opted_out' THEN 'opted_out' ELSE 'active' END, " +
        "converted=1, last_order_at=" + nowSql + ", " +
        "total_spent_cents=subscribers_global.total_spent_cents+excluded.total_spent_cents, " +
        "attribution_json=COALESCE(subscribers_global.attribution_json, excluded.attribution_json), " +
        "updated_at=" + nowSql
      ).bind(email, brand, amountCents, attributionJson).run();
    } catch (e) {
      console.error("buyer-ingest subscribers_global failed", e && e.message);
      return json({ ok: false, error: "crm_write_failed" }, 500);
    }

    // buyers_rollup — dashboard view.
    try {
      await db.prepare(
        "INSERT INTO buyers_rollup (email, brand, total_cents, first_attribution_json) " +
        "VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(email, brand) DO UPDATE SET " +
        "last_seen_at=" + nowSql + ", orders_count=buyers_rollup.orders_count+1, " +
        "total_cents=buyers_rollup.total_cents+excluded.total_cents"
      ).bind(email, brand, amountCents, attributionJson).run();
    } catch (e) {
      console.error("buyer-ingest buyers_rollup failed", e && e.message);
    }

    return json({ ok: true });
  } catch (e) {
    console.error("buyer-ingest error", e && e.message);
    return json({ ok: false }, 500);
  }
}
