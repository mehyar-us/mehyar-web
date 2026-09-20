// functions/api/pay/checkout.js
// POST /api/pay/checkout — SHARED checkout for every brand/product on this
// worker. One endpoint, one Stripe account, one webhook, many products.
//
// Body: {
//   product_id:  "audit-full-report"            (required — looked up in billing_products)
//   email:       "buyer@example.com"            (required)
//   test:       true                           (optional — use STRIPE_TEST_SECRET_KEY)
//   success_url: "https://other.mehyar.us/ty"  (optional — host must be in allowed_return_hosts)
//   cancel_url:  "https://other.mehyar.us/"     (optional — host must be in allowed_return_hosts)
//   params:      { ... }                        (optional — product-specific fields, <=2KB)
// }
//
// Price is NEVER taken from the client — it comes only from the
// billing_products row. Fulfillment-specific order setup lives in the
// initOrder hook below; the audit_report hook mirrors the legacy
// /api/audit/full-report/checkout behavior.

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

// CORS for cross-origin brand checkouts (e.g. puretap.mehyar.us -> mehyar.us).
// Only *.mehyar.us origins are reflected; everything else gets no CORS headers.
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

// Host-allowlisted caller override for return URLs.
function resolveReturnUrl(requested, fallback, allowedHosts) {
  if (!requested) return fallback;
  try {
    const u = new URL(String(requested));
    if (u.protocol !== "https:") return fallback;
    const hosts = String(allowedHosts || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
    if (hosts.includes(u.hostname.toLowerCase())) return u.toString();
  } catch { /* fall through to fallback */ }
  return fallback;
}

function fillTemplate(tpl, vars) {
  return String(tpl || "").replace(/\{([a-zA-Z_]+)\}/g, (m, k) => vars[k] != null ? String(vars[k]) : m);
}

// ── Order-init hooks per fulfillment type ────────────────────────────────
// Each hook returns { orderExtra, metadataExtra, alreadyReady } where
// alreadyReady = { ok, already_ready: true, token } short-circuits with 200
// (mirrors the legacy checkout's ready-report behavior).
const orderHooks = {
  // Full AI Website Evaluation (mehyar.us). params: { url, business?, lead_id? }
  async audit_report(db, product, { email, params }) {
    const url = sanitize(params.url, 300);
    const business = sanitize(params.business, 160);
    const leadId = Number(params.lead_id) || null;
    if (!url) return { error: "invalid_url" };

    // Idempotency on the report itself: reuse a recent pending row for the
    // same email+url. Same logic as the legacy checkout.
    const existing = await db.prepare(
      "SELECT id, status FROM audit_full_reports " +
      "WHERE email = ? AND url = ? AND created_at > datetime('now','-1 hour') " +
      "ORDER BY id DESC LIMIT 1"
    ).bind(email, url).first();
    if (existing && existing.status === "ready") {
      const tokRow = await db.prepare(
        "SELECT access_token FROM audit_full_reports WHERE id = ?"
      ).bind(existing.id).first();
      return { alreadyReady: { ok: true, already_ready: true, token: tokRow && tokRow.access_token } };
    }

    let reportId = existing && existing.id ? existing.id : null;
    let reportToken = null;
    if (!reportId) {
      reportToken = randomHex(32);
      const ins = await db.prepare(
        "INSERT INTO audit_full_reports (lead_id, email, url, business, amount_cents, currency, status, access_token) " +
        "VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)"
      ).bind(leadId, email, url, business || null, product.price_cents, product.currency || "usd", reportToken).run();
      reportId = (ins && ins.meta && ins.meta.last_row_id) || null;
    } else {
      const tokRow = await db.prepare(
        "SELECT access_token FROM audit_full_reports WHERE id = ?"
      ).bind(reportId).first();
      reportToken = tokRow && tokRow.access_token;
    }
    return {
      orderExtra: { report_id: reportId, accessToken: reportToken },
      metadataExtra: { report_id: String(reportId), url },
    };
  },

  // Default: no order hook — payment is just recorded. Access token minted
  // anyway so future per-product delivery can gate on it.
  async none() {
    return { orderExtra: { accessToken: randomHex(32) }, metadataExtra: {} };
  },
};

export async function onRequestPost({ request, env }) {
  const cors = corsHeaders(request);
  const J = (data, status = 200) => json(data, status, cors);
  try {
    if (!env?.LEADS_DB) return J({ ok: false, error: "service_unavailable" }, 503);
    const db = env.LEADS_DB;
    const body = await request.json().catch(() => ({}));

    const productId = sanitize(body.product_id, 100);
    const email = sanitize(body.email, 254).toLowerCase();
    if (!productId) return J({ ok: false, error: "invalid_product" }, 400);
    if (!EMAIL_RE.test(email)) return J({ ok: false, error: "invalid_email" }, 400);

    const product = await db.prepare(
      "SELECT * FROM billing_products WHERE id = ? AND active = 1"
    ).bind(productId).first();
    if (!product) return J({ ok: false, error: "invalid_product" }, 400);

    // Product-specific params: cap at ~2KB and sanitize strings.
    let params = {};
    if (body.params && typeof body.params === "object" && !Array.isArray(body.params)) {
      const raw = JSON.stringify(body.params);
      if (raw.length > 2048) return J({ ok: false, error: "params_too_large" }, 400);
      for (const [k, v] of Object.entries(body.params)) {
        const key = sanitize(k, 64);
        if (!key) continue;
        params[key] = (typeof v === "string") ? sanitize(v, 2000) : v;
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

    // Order-init hook (fulfillment-specific).
    const hook = orderHooks[product.fulfillment] || orderHooks.none;
    const hookResult = await hook(db, product, { email, params });
    if (hookResult.error) return J({ ok: false, error: hookResult.error }, 400);
    if (hookResult.alreadyReady) return J(hookResult.alreadyReady);

    const orderExtra = hookResult.orderExtra || {};
    const metadataExtra = hookResult.metadataExtra || {};
    let accessToken = orderExtra.accessToken || randomHex(32);
    const reportId = orderExtra.report_id || null;

    // Idempotency: reuse a pending payment row for the same product+email
    // created within the last hour. A fresh Stripe session is attached to it.
    let payment = await db.prepare(
      "SELECT id, access_token FROM billing_payments " +
      "WHERE product_id = ? AND email = ? AND status = 'pending' AND created_at > datetime('now','-1 hour') " +
      "ORDER BY id DESC LIMIT 1"
    ).bind(productId, email).first();

    let paymentId;
    if (payment) {
      paymentId = payment.id;
      // Never rotate the access token on reuse: an earlier Stripe session for
      // this payment already baked the original token into its success_url;
      // rotating would orphan that success page (404 on status poll) and its
      // download link.
      if (payment.access_token) accessToken = payment.access_token;
      await db.prepare(
        "UPDATE billing_payments SET metadata_json = ? WHERE id = ?"
      ).bind(JSON.stringify(params), paymentId).run();
    } else {
      const ins = await db.prepare(
        "INSERT INTO billing_payments (product_id, brand, email, amount_cents, currency, access_token, metadata_json) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(productId, product.brand, email, product.price_cents, product.currency || "usd", accessToken, JSON.stringify(params)).run();
      paymentId = (ins && ins.meta && ins.meta.last_row_id) || null;
      if (!paymentId) return J({ ok: false, error: "checkout_failed" }, 500);
    }

    // Return URLs: template defaults, caller overrides only for allowlisted hosts.
    const vars = { access_token: accessToken, payment_id: paymentId };
    let successUrl = resolveReturnUrl(
      body.success_url,
      fillTemplate(product.success_url_template, vars) ||
        "https://mehyar.us/",
      product.allowed_return_hosts
    );
    // Token unification: the success page always receives ?token=. Fill any
    // {placeholders} the caller left in their override URL first (e.g.
    // PillGuard's ?token={access_token}) using the (possibly reused) payment
    // token; if the URL still lacks a token, append it.
    successUrl = fillTemplate(successUrl, vars);
    try {
      const su = new URL(successUrl);
      if (!su.searchParams.get("token")) {
        su.searchParams.set("token", vars.access_token);
        successUrl = su.toString();
      }
    } catch { /* keep the resolved URL as-is */ }
    const cancelUrl = resolveReturnUrl(
      body.cancel_url,
      product.cancel_url || "https://mehyar.us/",
      product.allowed_return_hosts
    );

    // Create the Stripe Checkout Session via REST (no SDK in Workers).
    // Billing mode is TRUSTED product data (billing_products.billing_mode) —
    // never from the client. 'subscription' products create a recurring
    // session; everything else stays one-time (backward compatible).
    const billingMode = product.billing_mode === "subscription" ? "subscription" : "payment";
    const sp = new URLSearchParams();
    sp.set("payment_method_types[]", "card");
    sp.set("mode", billingMode);
    sp.set("success_url", successUrl);
    sp.set("cancel_url", cancelUrl);
    sp.set("customer_email", email);
    sp.set("line_items[0][price_data][currency]", product.currency || "usd");
    sp.set("line_items[0][price_data][product_data][name]", product.name);
    if (product.description) sp.set("line_items[0][price_data][product_data][description]", product.description);
    sp.set("line_items[0][price_data][unit_amount]", String(product.price_cents));
    if (billingMode === "subscription") {
      // Trusted interval only: month (default) or year.
      sp.set("line_items[0][price_data][recurring][interval]", product.billing_interval === "year" ? "year" : "month");
    }
    sp.set("line_items[0][quantity]", "1");
    sp.set("metadata[payment_id]", String(paymentId));
    sp.set("metadata[product_id]", productId);
    sp.set("metadata[brand]", product.brand || "");
    sp.set("metadata[email]", email);
    for (const [k, v] of Object.entries(metadataExtra)) sp.set("metadata[" + k + "]", String(v));

    const sess = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        authorization: "Bearer " + stripeKey,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: sp.toString(),
      signal: AbortSignal.timeout(15000),
    });
    const sessData = await sess.json().catch(() => ({}));
    if (!sess.ok || !sessData.id || !sessData.url) {
      console.error("pay/checkout stripe session failed", sessData && sessData.error && sessData.error.message);
      return J({ ok: false, error: "checkout_failed", message: "Couldn't start checkout — try again." }, 502);
    }

    await db.prepare(
      "UPDATE billing_payments SET stripe_session_id = ? WHERE id = ?"
    ).bind(sessData.id, paymentId).run();

    return J({ ok: true, payment_id: paymentId, token: accessToken, checkout_url: sessData.url });
  } catch (e) {
    console.error("pay/checkout error", e && e.message);
    return J({ ok: false, error: "checkout_failed" }, 500);
  }
}
