// functions/api/pay/portal.js
// Shared Stripe Billing Portal + subscription cancellation for satellite
// products (AI Mechanic migrated here 2026-10-06 — no per-product Stripe keys).
//
// POST { access_token, mode?: "portal" | "cancel", return_url? }
//   access_token — billing_payments.access_token (the buyer's token; the only
//     auth this endpoint needs). Never accept a raw Stripe customer id.
//   mode "portal" (default) — create a Stripe Billing Portal session for the
//     payment's customer → { ok:true, url }.
//   mode "cancel" — cancel every non-ended subscription on the customer
//     (used by AI Mechanic's delete-account flow) → { ok:true, canceled:n }.
//   return_url — where the portal returns the buyer; host must be in the
//     product's allowed_return_hosts, else the product's cancel_url origin.
//
// Live vs test key: billing_payments doesn't record which key created the
// customer, so probe live first and fall back to the test key on
// "No such customer".

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const sanitize = (v, n) => String(v || "").slice(0, n);

async function stripeCall(key, method, path, body) {
  const r = await fetch("https://api.stripe.com/v1/" + path, {
    method,
    headers: {
      authorization: "Bearer " + key,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const db = env.LEADS_DB;
    const body = await request.json().catch(() => ({}));
    const token = sanitize(body.access_token, 128);
    const mode = body.mode === "cancel" ? "cancel" : "portal";
    if (!token || token.length < 16) return json({ ok: false, error: "invalid_token" }, 400);

    const payment = await db
      .prepare("SELECT * FROM billing_payments WHERE access_token = ?")
      .bind(token)
      .first();
    if (!payment || !payment.stripe_customer_id) {
      return json({ ok: false, error: "not_found" }, 404);
    }
    const product = await db
      .prepare("SELECT * FROM billing_products WHERE id = ?")
      .bind(payment.product_id)
      .first();

    const keys = [env.STRIPE_SECRET_KEY, env.STRIPE_TEST_SECRET_KEY].filter(Boolean);
    if (!keys.length) return json({ ok: false, error: "stripe_not_configured" }, 503);
    const customerId = String(payment.stripe_customer_id);

    // Resolve which key owns this customer (live first, then test).
    let key = null;
    for (const k of keys) {
      const probe = await stripeCall(k, "GET", "customers/" + encodeURIComponent(customerId));
      if (probe.ok) { key = k; break; }
      if (probe.data?.error?.code !== "resource_missing") break; // real error, don't try the other key
    }
    if (!key) return json({ ok: false, error: "customer_not_found" }, 404);

    if (mode === "portal") {
      let returnUrl = null;
      try {
        const u = new URL(String(body.return_url || ""));
        const allowed = String(product?.allowed_return_hosts || "")
          .split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
        if (u.protocol === "https:" && allowed.includes(u.hostname.toLowerCase())) returnUrl = u.toString();
      } catch { /* fall through to default */ }
      if (!returnUrl && product?.cancel_url) {
        try { returnUrl = new URL(product.cancel_url).origin + "/"; } catch { /* ignore */ }
      }
      if (!returnUrl) returnUrl = "https://mehyar.us/";
      const sess = await stripeCall(key, "POST", "billing_portal/sessions", {
        customer: customerId,
        return_url: returnUrl,
      });
      if (!sess.ok || !sess.data?.url) {
        return json({ ok: false, error: "portal_failed" }, 502);
      }
      return json({ ok: true, url: sess.data.url });
    }

    // mode === "cancel": end every non-ended subscription on the customer.
    const list = await stripeCall(key, "GET", "subscriptions?customer=" + encodeURIComponent(customerId) + "&status=all&limit=100");
    if (!list.ok) return json({ ok: false, error: "cancel_failed" }, 502);
    let canceled = 0;
    for (const sub of list.data?.data || []) {
      if (["canceled", "incomplete_expired"].includes(sub.status)) continue;
      const c = await stripeCall(key, "POST", "subscriptions/" + encodeURIComponent(sub.id) + "/cancel");
      if (c.ok) canceled++;
    }
    return json({ ok: true, canceled });
  } catch (e) {
    console.error("pay/portal error", e && e.message);
    return json({ ok: false }, 500);
  }
}
