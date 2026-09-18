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
// PromptPack Pro (2026-09-16): generation is CLIENT-DRIVEN. The webhook and
// this backfill only create the promptpack_orders row; the buyer's browser
// drives the 3 generation batches via the PWA. When the order is ready and
// the buyer email hasn't gone out, this endpoint sends it (called by the
// PWA's /api/promptpack/notify-ready, idempotent via email_sent_at).
//
// Supported products (by billing_products.fulfillment):
//   designful -> fulfillDesignful / designful_orders
//   hustlekit -> fulfillHustlekit / hustlekit_orders
//   creditfixkit -> fulfillCreditfixkit / creditfixkit_orders
//   sprint30 -> fulfillSprint30 / sprint30_enrollments
//   truesketch -> fulfillTruesketch / truesketch_orders (PWA-owned rows, same D1)
//   freelanceros -> fulfillFreelanceros / freelanceros_orders
//   bizbuilder -> fulfillBizbuilder / bizbuilder_orders
//   prepguide -> fulfillPrepguide / prepguide_orders
//   promptpack -> fulfillPromptpack / promptpack_orders
//
// This is a safety net, not the primary path. The webhook remains the
// primary fulfillment trigger.

import { fulfillDesignful } from "../_shared/fulfillDesignful.js";
import { fulfillHustlekit, hustlekitBaseUrl } from "../_shared/fulfillHustlekit.js";
import { fulfillCreditfixkit } from "../_shared/fulfillCreditfixkit.js";
import { fulfillSprint30 } from "../_shared/fulfillSprint30.js";
import { fulfillFreelanceros } from "../_shared/fulfillFreelanceros.js";
import { fulfillBizbuilder } from "../_shared/fulfillBizbuilder.js";
import { fulfillPrepguide } from "../_shared/fulfillPrepguide.js";
import { fulfillPromptpack } from "../_shared/fulfillPromptpack.js";
import { fulfillTruesketch } from "../_shared/fulfillTruesketch.js";
import { fulfillTiktokgrowth } from "../_shared/fulfillTiktokgrowth.js";
import { sendCloudflareEmail } from "../_shared/cloudflareEmail.js";

const PRODUCTS = {
  designful: { fulfill: fulfillDesignful, ordersTable: "designful_orders" },
  hustlekit: { fulfill: fulfillHustlekit, ordersTable: "hustlekit_orders" },
  creditfixkit: { fulfill: fulfillCreditfixkit, ordersTable: "creditfixkit_orders" },
  sprint30: { fulfill: fulfillSprint30, ordersTable: "sprint30_enrollments" },
  freelanceros: { fulfill: fulfillFreelanceros, ordersTable: "freelanceros_orders" },
  bizbuilder: { fulfill: fulfillBizbuilder, ordersTable: "bizbuilder_orders" },
  prepguide: { fulfill: fulfillPrepguide, ordersTable: "prepguide_orders" },
  promptpack: { fulfill: fulfillPromptpack, ordersTable: "promptpack_orders" },
  truesketch: { fulfill: fulfillTruesketch, ordersTable: "truesketch_orders" },
  tiktokgrowth: { fulfill: fulfillTiktokgrowth, ordersTable: "tiktokgrowth_orders" },
};

const PROF_NAMES = {
  "contractor": "Contractor",
  "realtor": "Realtor",
  "coach-consultant": "Coach & Consultant",
  "freelancer": "Freelancer",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

// PromptPack buyer email: sends once per order (guarded by email_sent_at).
// Called when the order is ready — generation is client-driven, so the
// webhook/backfill can't send it at fulfill time.
async function maybeSendPromptpackEmail(db, env, payment) {
  const order = await db
    .prepare(
      "SELECT id, status, access_token, email, inputs_json, email_sent_at " +
        "FROM promptpack_orders WHERE payment_id = ?"
    )
    .bind(payment.id)
    .first();
  if (!order || order.status !== "ready" || order.email_sent_at) {
    return { action: order && order.status !== "ready" ? "not_ready" : "already_sent" };
  }

  let profession = "contractor";
  try {
    const inputs = JSON.parse(order.inputs_json || "{}").inputs || {};
    const raw = String(inputs.profession || "").toLowerCase().trim();
    if (PROF_NAMES[raw]) profession = raw;
  } catch {}
  const profName = PROF_NAMES[profession];
  const baseUrl = String(env.PROMPTPACK_BASE_URL || "https://promptpack.mehyar.us").replace(/\/+$/, "");
  const deliverUrl = `${baseUrl}/deliverable.html?token=${order.access_token}`;
  const subject = `Your PromptPack Pro (${profName}) is ready`;
  const text =
    `Thanks for your purchase!\n\n` +
    `Your PromptPack Pro pack for ${profName} is ready — 50 prompts + 10 swipe files:\n${deliverUrl}\n\n` +
    `There's a one-click PDF download on the page. ` +
    `This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.\n\n-- PromptPack Pro`;
  const html =
    `<p>Thanks for your purchase!</p>` +
    `<p>Your <strong>PromptPack Pro</strong> pack for <strong>${profName}</strong> is ready — 50 prompts + 10 swipe files.</p>` +
    `<p><a href="${deliverUrl}" style="display:inline-block;background:#f59e0b;color:#1a1206;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Open your pack</a></p>` +
    `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${deliverUrl}">${deliverUrl}</a></p>` +
    `<p style="color:#6b7280;font-size:13px;">There's a one-click PDF download on the page. This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.</p>` +
    `<p>-- PromptPack Pro</p>`;

  const result = await sendCloudflareEmail(env, {
    from: "team@mehyar.us",
    fromName: "PromptPack Pro",
    to: payment.email,
    replyTo: "info@mehyar.us",
    subject,
    text,
    html,
  });
  if (!result.ok) {
    console.error("fulfill-backfill: promptpack email failed", payment.id, result.error);
    return { action: "email_failed", error: result.error };
  }
  await db
    .prepare("UPDATE promptpack_orders SET email_sent_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .bind(order.id)
    .run();
  return { action: "email_sent", order_id: order.id };
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
      // PromptPack: the order may now be ready (client-driven generation).
      // Send the buyer email if it hasn't gone out.
      if (product.fulfillment === "promptpack") {
        const emailResult = await maybeSendPromptpackEmail(db, env, payment);
        return json({ ok: true, action: "already_fulfilled", order_id: existing.id, email: emailResult.action });
      }
      if (product.fulfillment === "tiktokgrowth") {
        // TikTok Growth: the order may be incomplete (failed generation, or
        // ready but the delivery email never went out). Re-enter fulfillment;
        // it resumes incomplete work and returns replay for fully-done orders
        // (ready + emailed), so this stays idempotent.
        const sendEmail = (e, msg) => sendCloudflareEmail(e, msg);
        try {
          const fr = await spec.fulfill({ db, env, waitUntil, sendEmail }, payment);
          return json({ ok: true, action: fr && fr.replay ? "already_fulfilled" : "resumed", order_id: existing.id });
        } catch (e) {
          console.error("fulfill-backfill tiktokgrowth resume failed", payment.id, e && e.message);
          return json({ ok: false, error: "fulfillment_failed" }, 500);
        }
      }
      if (product.fulfillment === "hustlekit") {
        // HustleKit: the order may be orphaned mid-generation (webhook
        // waitUntil isolate evicted — stuck in paid/generating). Kick the
        // checkpointed generate fire-and-forget (never await the ~150s body:
        // the caller's edge would 524) and let the scheduled sweep finish it
        // + send the buyer email exactly once. Safe for the success page's
        // retry path: generate resumes from checkpoints, ready rows replay.
        try {
          const orow = await db.prepare(
            "SELECT id, access_token, inputs_json, status FROM hustlekit_orders WHERE payment_id=?"
          ).bind(payment.id).first();
          if (orow && orow.status !== "ready") {
            let inputs = {};
            try { inputs = JSON.parse(orow.inputs_json || "{}"); } catch {}
            const track = inputs.track || "ai-writing";
            const base = hustlekitBaseUrl(env);
            const p = fetch(`${base}/api/hustlekit/generate`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ order_token: orow.access_token, track, inputs }),
            }).catch(() => {});
            if (typeof waitUntil === "function") waitUntil(p);
            return json({ ok: true, action: "resumed", order_id: orow.id, dispatched: true });
          }
          return json({ ok: true, action: "already_fulfilled", order_id: orow && orow.id });
        } catch (e) {
          console.error("fulfill-backfill hustlekit resume failed", payment.id, e && e.message);
          return json({ ok: false, error: "fulfillment_failed" }, 500);
        }
      }
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

    // PromptPack: order row created; generation is client-driven. If it's
    // somehow already ready (e.g. instant), send the email now.
    if (product.fulfillment === "promptpack") {
      const emailResult = await maybeSendPromptpackEmail(db, env, payment);
      return json({ ok: true, action: "fulfilled", order_id: order && order.id, email: emailResult.action });
    }
    return json({ ok: true, action: "fulfilled", order_id: order && order.id });
  } catch (e) {
    console.error("fulfill-backfill error", e && e.message);
    return json({ ok: false }, 500);
  }
}

