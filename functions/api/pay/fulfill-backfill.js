// functions/api/pay/fulfill-backfill.js
// POST /api/pay/fulfill-backfill — Backfill fulfillment for paid payments
// that missed the webhook (e.g. Stripe delivering to a stale deployment).
//
// Body: { token } — the payment's access_token (from the success page URL).
//
// If the payment is paid and has no product order row yet, this creates the
// order and kicks off the same fulfillment pipeline the webhook uses.
// Idempotent: if an order already exists for the payment, it does nothing.
//
// Supported products (by billing_products.fulfillment):
//   designful -> fulfillDesignful / designful_orders
//   hustlekit -> fulfillHustlekit / hustlekit_orders
//   creditfixkit -> fulfillCreditfixkit / creditfixkit_orders
//   sprint30 -> fulfillSprint30 / sprint30_enrollments
//
// This is a safety net, not the primary path. The webhook remains the
// primary fulfillment trigger.

import { fulfillDesignful } from "../_shared/fulfillDesignful.js";
import { fulfillHustlekit } from "../_shared/fulfillHustlekit.js";
import { fulfillCreditfixkit } from "../_shared/fulfillCreditfixkit.js";
import { fulfillSprint30 } from "../_shared/fulfillSprint30.js";
import { sendCloudflareEmail } from "../_shared/cloudflareEmail.js";

const PRODUCTS = {
  designful: { fulfill: fulfillDesignful, ordersTable: "designful_orders" },
  hustlekit: { fulfill: fulfillHustlekit, ordersTable: "hustlekit_orders" },
  creditfixkit: { fulfill: fulfillCreditfixkit, ordersTable: "creditfixkit_orders" },
  sprint30: { fulfill: fulfillSprint30, ordersTable: "sprint30_enrollments" },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    const db = env.LEADS_DB;
    if (!db) return json({ ok: false, error: "db_unavailable" }, 500);

    let body = {};
    try {
      body = await request.json();
    } catch {}
    const token = String(body.token || "").trim();
    if (!token || token.length < 16) {
      return json({ ok: false, error: "invalid_token" }, 403);
    }

    const payment = await db.prepare(
      "SELECT * FROM billing_payments WHERE access_token = ?"
    ).bind(token).first();
    if (!payment) return json({ ok: false, error: "not_found" }, 404);
    if (payment.status !== "paid") {
      return json({ ok: true, action: "not_paid_yet", status: payment.status });
    }

    const product = await db.prepare(
      "SELECT * FROM billing_products WHERE id = ?"
    ).bind(payment.product_id).first();
    const spec = product && PRODUCTS[product.fulfillment];
    if (!spec) {
      return json({ ok: true, action: "unsupported_product", fulfillment: product && product.fulfillment });
    }

    // Idempotency: order already exists?
    const existing = await db.prepare(
      `SELECT id FROM ${spec.ordersTable} WHERE payment_id = ?`
    ).bind(payment.id).first();
    if (existing) {
      return json({ ok: true, action: "already_fulfilled", order_id: existing.id });
    }

    // Run the same fulfillment the webhook uses.
    const sendEmail = (e, msg) => sendCloudflareEmail(e, msg);
    try {
      await spec.fulfill({ db, env, waitUntil, sendEmail }, payment);
    } catch (e) {
      console.error("fulfill-backfill failed", payment.id, e && e.message);
      return json({ ok: false, error: "fulfillment_failed" }, 500);
    }

    const order = await db.prepare(
      `SELECT id, status FROM ${spec.ordersTable} WHERE payment_id = ?`
    ).bind(payment.id).first();
    return json({ ok: true, action: "fulfilled", order_id: order && order.id });
  } catch (e) {
    console.error("fulfill-backfill error", e && e.message);
    return json({ ok: false }, 500);
  }
}
