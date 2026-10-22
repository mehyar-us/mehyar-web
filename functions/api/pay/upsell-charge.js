// functions/api/pay/upsell-charge.js
// POST /api/pay/upsell-charge — ONE-CLICK post-purchase upsell.
//
// Body: {
//   base_token: "<64-hex access_token of the PAID base purchase>",  (required)
//   product_id: "baby-peek-agepack",                                (required)
//   test:       true                                                (optional — use STRIPE_TEST_SECRET_KEY)
// }
//
// Charges the card saved on the base purchase WITHOUT asking for card
// details again (off-session PaymentIntent against the saved customer +
// payment method). Price comes ONLY from the billing_products row — never
// from the client.
//
// Trust model: the base_token is the buyer's own unguessable credential
// (same posture as /api/redeem). The upsell SKU must be allowlisted here
// AND active in billing_products; the base purchase must be a paid row for
// the allowlisted base product, and its metadata gid must match. One upsell
// per generation: an existing paid upsell row for the same gid short-
// circuits as already:true (no double charge). Stripe-side idempotency key
// guards the charge itself.
//
// The base purchase must have been created with card-saving enabled
// (payment_intent_data[setup_future_usage]=off_session — see
// /api/pay/checkout params.save_card). Without a saved card this returns
// {ok:false,error:'no_saved_card'} and the product site falls back to a
// regular hosted checkout session.

import { sendCloudflareEmail } from "../_shared/cloudflareEmail.js";
import { fulfillAgepack } from "../_shared/fulfillAgepack.js";

// upsell_product_id -> base_product_id (the paid purchase that authorizes it)
const UPSELLS = {
  "baby-peek-agepack": "baby-peek",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

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

function randomHex(bytes) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function readMeta(row) {
  try {
    const m = JSON.parse((row && row.metadata_json) || "{}");
    return m && typeof m === "object" ? m : {};
  } catch {
    return {};
  }
}

async function stripeCall(stripeKey, method, path, params, idemKey) {
  const headers = {
    authorization: "Bearer " + stripeKey,
    "content-type": "application/x-www-form-urlencoded",
  };
  if (idemKey) headers["Idempotency-Key"] = idemKey;
  const r = await fetch("https://api.stripe.com" + path, {
    method,
    headers,
    body: params ? params.toString() : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

export async function onRequestPost({ request, env }) {
  const cors = corsHeaders(request);
  const J = (data, status = 200) => json(data, status, cors);
  try {
    if (!env?.LEADS_DB) return J({ ok: false, error: "service_unavailable" }, 503);
    const db = env.LEADS_DB;
    const body = await request.json().catch(() => ({}));

    const productId = sanitize(body.product_id, 100);
    const baseToken = sanitize(body.base_token, 128);
    const baseProductId = UPSELLS[productId];
    if (!baseProductId) return J({ ok: false, error: "invalid_product" }, 400);
    if (!/^[0-9a-f]{64}$/.test(baseToken))
      return J({ ok: false, error: "invalid_token" }, 400);

    const product = await db.prepare(
      "SELECT * FROM billing_products WHERE id = ? AND active = 1"
    ).bind(productId).first();
    if (!product) return J({ ok: false, error: "invalid_product" }, 400);

    // The base purchase: paid, right product, card saved at checkout.
    const base = await db.prepare(
      "SELECT * FROM billing_payments WHERE access_token = ? AND product_id = ? AND status = 'paid'"
    ).bind(baseToken, baseProductId).first();
    if (!base) return J({ ok: false, error: "base_not_paid" }, 402);
    const baseMeta = readMeta(base);
    const gid = String(baseMeta.gid || "");
    if (!/^[0-9a-f]{32}$/.test(gid))
      return J({ ok: false, error: "base_not_paid" }, 402);
    if (!base.stripe_customer_id || !base.stripe_payment_intent)
      return J({ ok: false, error: "no_saved_card" }, 409);

    // Idempotency: one upsell per generation. A paid upsell row for this
    // gid already exists → hand back its token, charge nothing.
    const existing = await db.prepare(
      "SELECT id, access_token, status, metadata_json FROM billing_payments WHERE product_id = ? AND email = ?"
    ).bind(productId, base.email).all();
    for (const row of (existing.results || [])) {
      if (readMeta(row).gid === gid && row.status === "paid") {
        return J({ ok: true, already: true, token: row.access_token });
      }
    }

    const testMode = body.test === true;
    const stripeKey = testMode ? env.STRIPE_TEST_SECRET_KEY : env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return J(
        { ok: false, error: testMode ? "stripe_test_not_configured" : "stripe_not_configured" },
        testMode ? 400 : 503
      );
    }

    // Resolve the saved payment method from the base PaymentIntent.
    const piGet = await stripeCall(
      stripeKey, "GET",
      "/v1/payment_intents/" + encodeURIComponent(base.stripe_payment_intent)
    );
    const savedPm = piGet.ok && piGet.data && piGet.data.payment_method;
    const customer = (piGet.ok && piGet.data && piGet.data.customer) || base.stripe_customer_id;
    if (!piGet.ok || !savedPm || !customer) {
      return J({ ok: false, error: "no_saved_card" }, 409);
    }

    // One-tap off-session charge. Idempotency key = one charge per
    // generation per 24h even if the endpoint is hit twice.
    const sp = new URLSearchParams();
    sp.set("amount", String(Number(product.price_cents) || 0));
    sp.set("currency", product.currency || "usd");
    sp.set("customer", String(customer));
    sp.set("payment_method", String(savedPm));
    sp.set("off_session", "true");
    sp.set("confirm", "true");
    sp.set("metadata[payment_id]", "upsell-pending");
    sp.set("metadata[product_id]", productId);
    sp.set("metadata[brand]", product.brand || "");
    sp.set("metadata[email]", base.email || "");
    sp.set("metadata[gid]", gid);
    sp.set("metadata[upsell_from]", String(base.id));
    const charge = await stripeCall(
      stripeKey, "POST", "/v1/payment_intents", sp,
      "upsell-" + productId + "-" + gid
    );
    const pi = charge.data || {};
    if (!charge.ok || !pi.id) {
      const msg = (pi.error && pi.error.message) || "charge_failed";
      console.error("pay/upsell-charge stripe failed", msg);
      return J({ ok: false, error: "charge_failed", message: String(msg).slice(0, 200) }, 502);
    }
    if (pi.status === "requires_action" || pi.status === "requires_payment_method") {
      // Card needs the buyer present (SCA) — the product site falls back
      // to a regular hosted checkout session for the upsell SKU.
      return J({ ok: false, error: "requires_action", payment_intent: pi.id }, 409);
    }
    if (pi.status !== "succeeded") {
      const msg = (pi.last_payment_error && pi.last_payment_error.message) || ("status_" + pi.status);
      console.error("pay/upsell-charge not succeeded", pi.id, msg);
      return J({ ok: false, error: "charge_failed", message: String(msg).slice(0, 200) }, 502);
    }

    const accessToken = randomHex(32);
    const ins = await db.prepare(
      "INSERT INTO billing_payments (product_id, brand, email, amount_cents, currency, access_token, metadata_json, stripe_payment_intent, stripe_customer_id, status, paid_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', " + "strftime('%Y-%m-%dT%H:%M:%fZ','now')" + ")"
    ).bind(
      productId,
      product.brand,
      base.email,
      Number(product.price_cents) || 0,
      product.currency || "usd",
      accessToken,
      JSON.stringify({ gid, upsell_from: base.id }),
      pi.id,
      String(customer)
    ).run();
    const paymentId = (ins && ins.meta && ins.meta.last_row_id) || null;
    if (!paymentId) {
      console.error("pay/upsell-charge ledger insert failed after successful charge", pi.id);
      return J({ ok: false, error: "ledger_failed", payment_intent: pi.id }, 500);
    }

    const payment = await db.prepare(
      "SELECT * FROM billing_payments WHERE id = ?"
    ).bind(paymentId).first();

    // Fulfillment: BabyPeek generation trigger + transactional receipt +
    // buyer CRM. Best-effort after the ledger write — the row is paid and
    // recoverable by the fulfillment sweep even if this throws.
    try {
      const sendEmail = (e, msg) => sendCloudflareEmail(e, msg);
      await fulfillAgepack({ db, env, sendEmail }, payment);
    } catch (e) {
      console.error("pay/upsell-charge fulfillment failed", paymentId, e && e.message);
    }

    return J({ ok: true, token: accessToken, payment_id: paymentId });
  } catch (e) {
    console.error("pay/upsell-charge error", e && e.message);
    return J({ ok: false, error: "charge_failed" }, 500);
  }
}
