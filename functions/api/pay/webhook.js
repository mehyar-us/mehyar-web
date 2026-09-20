// functions/api/pay/webhook.js
// POST /api/pay/webhook — SHARED Stripe webhook for every brand/product on
// this worker. One endpoint, one secret. Dispatches fulfillment per the
// product's `fulfillment` column in billing_products.
//
// Event: checkout.session.completed, invoice.payment_succeeded,
// invoice.payment_failed, customer.subscription.updated, and
// customer.subscription.deleted. Verifies the Stripe signature
// (live secret first, test secret fallback — same as the legacy audit
// webhook), marks the billing_payments row paid, then runs the product's
// fulfillment hook. Duplicate deliveries for the same session are ignored.
// Subscription products also record the Stripe subscription id + status so
// satellite products can gate recurring access.
//
// NOTE: the legacy /api/audit/full-report/webhook is left untouched —
// sessions it created in flight keep working on their registered URLs.

import { sendCloudflareEmail } from "../_shared/cloudflareEmail.js";
import { fulfillDesignful } from "../_shared/fulfillDesignful.js";
import { fulfillFreelanceros } from "../_shared/fulfillFreelanceros.js";
import { fulfillHustlekit } from "../_shared/fulfillHustlekit.js";
import { fulfillCreditfixkit } from "../_shared/fulfillCreditfixkit.js";
import { fulfillSprint30 } from "../_shared/fulfillSprint30.js";
import { fulfillBizbuilder } from "../_shared/fulfillBizbuilder.js";
import { fulfillPrepguide } from "../_shared/fulfillPrepguide.js";
import { fulfillTruesketch } from "../_shared/fulfillTruesketch.js";
import { fulfillTiktokgrowth } from "../_shared/fulfillTiktokgrowth.js";
import { fulfillPromptpack } from "../_shared/fulfillPromptpack.js";
import { fulfillUnlockLink } from "../_shared/fulfillUnlockLink.js";
import { fulfillWattwise } from "../_shared/fulfill-wattwise.js";
import { fulfillTaxtrim } from "../_shared/fulfillTaxtrim.js";
import { fulfillTicketBeat } from "../_shared/fulfillTicketBeat.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function verifyStripeSignature(rawBody, sigHeader, secret) {
  // Stripe-Signature: t=...,v1=...
  const parts = Object.fromEntries(
    String(sigHeader || "").split(",").map((kv) => { const i = kv.indexOf("="); return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()]; })
  );
  if (!parts.t || !parts.v1) return false;
  const signedPayload = parts.t + "." + rawBody;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // Constant-time-ish compare (single v1 signature expected).
  if (hex.length !== parts.v1.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  return diff === 0;
}

// ── Fulfillment hooks ────────────────────────────────────────────────────
const fulfillHooks = {
  // Full AI Website Evaluation. Port of the legacy webhook's behavior:
  // mark the audit report row paid (never touch ready rows), then fire
  // /api/audit/full-report/generate in the background.
  async audit_report({ db, request, env, waitUntil }, payment, sess) {
    const reportId = Number(sess.metadata && sess.metadata.report_id);
    if (!reportId) return;
    const row = await db.prepare(
      "SELECT id, status, stripe_session_id FROM audit_full_reports WHERE id = ?"
    ).bind(reportId).first();
    if (!row) return;

    // Duplicate delivery guard: same session already processed.
    const duplicate = row.stripe_session_id && row.stripe_session_id === sess.id && row.status !== "pending";
    if (!duplicate) {
      await db.prepare(
        "UPDATE audit_full_reports SET stripe_payment_intent=?, stripe_session_id=?, paid_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), status='paid', failure_reason=NULL, status_changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') " +
        "WHERE id=? AND status != 'ready'"
      ).bind(sess.payment_intent || null, sess.id || null, reportId).run();
    }

    // Trigger generation unless the report is already ready or building.
    // waitUntil so Stripe gets an instant 200; the retry endpoint + get.js
    // stuck-recovery cover any failure here.
    if (row.status !== "ready" && row.status !== "generating" && typeof waitUntil === "function") {
      waitUntil((async () => {
        try {
          const genUrl = new URL(request.url);
          genUrl.pathname = "/api/audit/full-report/generate";
          const genResp = await fetch(genUrl.toString(), {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer " + env.AUDIT_CRON_SECRET },
            body: JSON.stringify({ report_id: reportId }),
          });
          const genData = await genResp.json().catch(() => ({}));
          if (!genResp.ok || !genData.ok) {
            console.error("pay/webhook auto-generate failed", genData && genData.error);
            await db.prepare(
              "UPDATE audit_full_reports SET failure_reason=? WHERE id=? AND status='paid'"
            ).bind("generate_failed:" + String((genData && genData.error) || genResp.status).slice(0, 80), reportId).run();
          }
        } catch (e) {
          console.error("pay/webhook auto-generate threw", e && e.message);
          try {
            await db.prepare(
              "UPDATE audit_full_reports SET failure_reason=? WHERE id=? AND status='paid'"
            ).bind("generate_threw:" + String(e && e.message).slice(0, 80), reportId).run();
          } catch { /* best effort */ }
        }
      })());
    }
  },

  // Default: payment is recorded as paid; nothing else to do.
  async none() { /* no-op */ },

  // Digital download product. Emails the buyer a token-gated download link.
  // The token is the payment's access_token (unguessable, per-purchase).
  async digital({ db, env }, payment) {
    const product = await db.prepare(
      "SELECT id, name, brand FROM billing_products WHERE id = ?"
    ).bind(payment.product_id).first();
    if (!product) return;
    const downloadUrl = "https://mehyar.us/api/pay/download?token=" + payment.access_token;
    const isSPG = product.brand === "stuffprettygood";
    const brandName = isSPG ? "Stuff Pretty Good" : "MehyarSoft";
    const fromEmail = isSPG ? "hello@stuffprettygood.com" : "team@mehyar.us";
    const subject = `Your ${product.name} is ready`;
    const text =
      `Thanks for your purchase!\n\n` +
      `Your download for "${product.name}" is ready:\n${downloadUrl}\n\n` +
      `This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.\n\n` +
      `-- ${brandName}`;
    const html =
      `<p>Thanks for your purchase!</p>` +
      `<p>Your download for <strong>${product.name}</strong> is ready:</p>` +
      `<p><a href="${downloadUrl}" style="display:inline-block;background:#111827;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Download your guide</a></p>` +
      `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${downloadUrl}">${downloadUrl}</a></p>` +
      `<p style="color:#6b7280;font-size:13px;">This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.</p>` +
      `<p>-- ${brandName}</p>`;
    const result = await sendCloudflareEmail(env, {
      from: fromEmail,
      fromName: brandName,
      to: payment.email,
      replyTo: "info@mehyar.us",
      subject,
      text,
      html,
    });
    if (!result.ok) {
      console.error("pay/webhook digital email failed", payment.product_id, result.error);
    }
  },

  // Token-unlock products (BabyPeek, RoastMe): no generated file — the buyer
  // unlocks on the product site with their per-purchase access token. Emails
  // the transactional receipt + unlock link (idempotent per payment via
  // unlock_receipts), then hands off to the standalone module.
  async unlock_link({ db, env }, payment) {
    const sendEmail = (e, msg) => sendCloudflareEmail(e, msg);
    await fulfillUnlockLink({ db, env, sendEmail }, payment);
  },

  // Designful AI design deliverables. Creates the designful_orders row
  // (idempotent on payment_id via idx_designful_orders_payment), unifies the
  // access token onto the billing_payments row, then hands off to the
  // standalone module for background generation + buyer email.
  async designful({ db, env, waitUntil }, payment) {
    const sendEmail = (e, msg) => sendCloudflareEmail(e, msg);
    await fulfillDesignful({ db, env, waitUntil, sendEmail }, payment);
  },
  // FreelancerOS dashboard. Creates the freelanceros_orders row (idempotent on
  // payment_id via idx_freelanceros_orders_payment), unifies the access token
  // onto the billing_payments row, then emails the buyer their dashboard link.
  async freelanceros({ db, env, waitUntil }, payment) {
    const sendEmail = (e, msg) => sendCloudflareEmail(e, msg);
    await fulfillFreelanceros({ db, env, waitUntil, sendEmail }, payment);
  },

  // HustleKit AI side-hustle playbooks. Creates the hustlekit_orders row
  // (idempotent on payment_id's UNIQUE constraint), unifies the access
  // token onto the billing_payments row, then hands off to the standalone
  // module for background generation + buyer email.
  async hustlekit({ db, env, waitUntil }, payment) {
    const sendEmail = (e, msg) => sendCloudflareEmail(e, msg);
    await fulfillHustlekit({ db, env, waitUntil, sendEmail }, payment);
  },

  // Sprint30 30-day challenge. Creates the sprint30_enrollments row
  // (idempotent on payment_id via idx_sprint30_enrollments_payment), unifies
  // the access token onto the billing_payments row, and sends the Day-1
  // challenge email immediately. Days 2-30 go out via the daily scheduler.
  async sprint30({ db, env, waitUntil }, payment) {
    const sendEmail = (e, msg) => sendCloudflareEmail(e, msg);
    await fulfillSprint30({ db, env, waitUntil, sendEmail }, payment);
  },

  // BizBuilder AI business builder ($17 one-time). Creates the
  // bizbuilder_orders row (idempotent on payment_id via
  // idx_bizbuilder_orders_payment), unifies the access token onto the
  // billing_payments row, then hands off to the standalone module for
  // background generation + buyer email.
  async bizbuilder({ db, env, waitUntil }, payment) {
    const sendEmail = (e, msg) => sendCloudflareEmail(e, msg);
    await fulfillBizbuilder({ db, env, waitUntil, sendEmail }, payment);
  },

  // CreditFix Kit — DIY credit repair kit. Creates the creditfixkit_orders row
  // (idempotent on payment_id via idx_creditfixkit_orders_payment), unifies the
  // access token onto the billing_payments row, then hands off to the
  // standalone module for background generation + buyer email.
  async creditfixkit({ db, env, waitUntil }, payment) {
    const sendEmail = (e, msg) => sendCloudflareEmail(e, msg);
    await fulfillCreditfixkit({ db, env, waitUntil, sendEmail }, payment);
  },

  // PrepGuide personalized preparedness playbook ($37 one-time). Creates the
  // prepguide_orders row (idempotent on payment_id via the UNIQUE payment
  // index), reuses the payment access_token as the order token, then hands
  // off to the standalone module for background generation + buyer email.
  async prepguide({ db, env, waitUntil }, payment) {
    const sendEmail = (e, msg) => sendCloudflareEmail(e, msg);
    await fulfillPrepguide({ db, env, waitUntil, sendEmail }, payment);
  },

  // TrueSketch AI portrait sketch + reading ($37 one-time). Hands off to the
  // standalone module: POSTs the paid trigger to the TrueSketch backend
  // (idempotent on payment_id via the PWA's /api/generate, which owns the
  // order row), then emails the buyer the token-gated gallery link.
  async truesketch({ db, env, waitUntil }, payment) {
    const sendEmail = (e, msg) => sendCloudflareEmail(e, msg);
    await fulfillTruesketch({ db, env, waitUntil, sendEmail }, payment);
  },

  // TikTok Growth System playbook. Creates the tiktokgrowth_orders row
  // (idempotent on payment_id via idx_tiktokgrowth_orders_payment), unifies
  // the access token onto the billing_payments row, then hands off to the
  // standalone module for background generation + buyer email.
  async tiktokgrowth({ db, env, waitUntil }, payment) {
    const sendEmail = (e, msg) => sendCloudflareEmail(e, msg);
    await fulfillTiktokgrowth({ db, env, waitUntil, sendEmail }, payment);
  },

  // PromptPack Pro — niche AI prompt packs + swipe files. Creates the
  // promptpack_orders row (idempotent on payment_id via
  // idx_promptpack_orders_payment), unifies the access token onto the
  // billing_payments row, then hands off to the standalone module for
  // background generation + buyer email.
  async promptpack({ db, env, waitUntil }, payment) {
    const sendEmail = (e, msg) => sendCloudflareEmail(e, msg);
    await fulfillPromptpack({ db, env, waitUntil, sendEmail }, payment);
  },

  // WattWise products (wattwise-audit, wattwise-monthly). Delivery is
  // PULL-based on wattwise.mehyar.us: the paid billing_payments row is the
  // entitlement (token = access_token). Nothing to push here — no email,
  // no order row. Kept as a named hook so the fulfillment column stays
  // meaningful and idempotent.
  async wattwise(ctx, payment, sess) {
    return fulfillWattwise(ctx, payment, sess);
  },

  // TicketBeat (ticketbeat-letter, ticketbeat-monthly). Creates the order
  // row (idempotent per payment), and for one-time letters generates the
  // PDF in the background then emails the buyer their personal link.
  async ticketbeat(ctx, payment, sess) {
    return fulfillTicketBeat(ctx, payment, sess);
  },

  // TaxTrim products (taxtrim-packet, taxtrim-renewal). Creates a
  // taxtrim_orders row, unifies billing_payments.access_token onto the order
  // token, generates the packet in the background (packet SKU) or activates
  // the annual watch (renewal SKU), then emails the buyer with a one-click
  // TaxTrim unsubscribe. Idempotent per payment.
  async taxtrim({ db, env, waitUntil }, payment, sess) {
    const sendEmail = (e, msg) => sendCloudflareEmail(e, msg);
    return fulfillTaxtrim({ db, env, waitUntil, sendEmail }, payment);
  },
};

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false }, 503);
    const db = env.LEADS_DB;
    const rawBody = await request.text();
    const sig = request.headers.get("stripe-signature") || "";
    // Live secret, then the test secrets for each registered test endpoint:
    // STRIPE_WEBHOOK_SECRET_TEST  = legacy we_1UFfQw8y1yiOc3KfrNdr3Y4n (legacy webhook URL)
    // STRIPE_WEBHOOK_SECRET_TEST2 = we_1UFibf4NaXpNyV6yLNtqmBuY (/api/pay/webhook)
    const secrets = [env.STRIPE_WEBHOOK_SECRET, env.STRIPE_WEBHOOK_SECRET_TEST, env.STRIPE_WEBHOOK_SECRET_TEST2].filter(Boolean);
    let verified = false;
    for (const s of secrets) {
      if (await verifyStripeSignature(rawBody, sig, s)) { verified = true; break; }
    }
    if (!verified) {
      return json({ ok: false, error: "bad_signature", v: "20250915-fulfill" }, 400);
    }

    const event = JSON.parse(rawBody);
    if (event.type === "checkout.session.completed") {
      const sess = (event.data && event.data.object) ? event.data.object : {};
      const paymentId = Number(sess.metadata && sess.metadata.payment_id);
      if (paymentId) {
        const payment = await db.prepare(
          "SELECT * FROM billing_payments WHERE id = ?"
        ).bind(paymentId).first();
        if (payment) {
          // Duplicate guard: same session id seen and row already out of
          // pending → skip the paid-marking re-processing, still answer 200.
          // NOTE: the legacy audit webhook's ledger mirror marks billing paid
          // too, but it never dispatches product fulfillment. Hooks that
          // create their own order row are idempotent on payment_id, so they
          // must run even on a "duplicate" hit — otherwise the buyer is paid
          // with no order, no generation, no email. digital/none/audit_report
          // keep the old skip-on-duplicate behavior (avoids double emails).
          const duplicate = payment.stripe_session_id && payment.stripe_session_id === sess.id && payment.status !== "pending";
          const ORDER_HOOKS = new Set(["designful","freelanceros","hustlekit","creditfixkit","sprint30","bizbuilder","prepguide","tiktokgrowth","promptpack","truesketch","taxtrim"]);
          if (!duplicate) {
            const isSub = sess.mode === "subscription" && sess.subscription;
            await db.prepare(
              "UPDATE billing_payments SET stripe_payment_intent=?, stripe_session_id=?, status='paid', paid_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), " +
              "stripe_subscription_id=COALESCE(?, stripe_subscription_id), " +
              "subscription_status=CASE WHEN ? IS NOT NULL THEN 'active' ELSE subscription_status END " +
              "WHERE id=? AND status != 'paid'"
            ).bind(sess.payment_intent || null, sess.id || null, isSub ? String(sess.subscription) : null, isSub ? 1 : null, paymentId).run();
          }
          // Fulfillment dispatch by product.
          const product = await db.prepare(
            "SELECT * FROM billing_products WHERE id = ?"
          ).bind(payment.product_id).first();
          const fulfillment = (product && product.fulfillment) || "none";
          const runFulfillment = !duplicate || ORDER_HOOKS.has(fulfillment);
          if (runFulfillment) {
            try {
              await db.prepare(
                "INSERT INTO webhook_debug (created_at, payment_id, step, detail) VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?, 'product_lookup', ?)"
              ).bind(payment.id, JSON.stringify({pid: payment.product_id, found: !!product, fulfillment: fulfillment, duplicate: !!duplicate}).slice(0,300)).run();
            } catch {}
            const hook = fulfillHooks[fulfillment] || fulfillHooks.none;
            try {
              await hook({ db, request, env, waitUntil }, payment, sess);
            } catch (e) {
              console.error("pay/webhook fulfillment failed", payment.product_id, e && e.message);
              try {
                await db.prepare(
                  "INSERT INTO webhook_debug (created_at, payment_id, step, detail) VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?, 'fulfill_hook', ?)"
                ).bind(payment.id, String((e && e.message) || e).slice(0, 500)).run();
              } catch {}
            }
          }
        }
      }
    } else if (event.type === "invoice.payment_succeeded") {
      // Subscription renewal: refresh the entitlement window. Satellite
      // products treat paid_at within 40 days + subscription_status active
      // as current; every successful invoice bumps paid_at.
      const inv = (event.data && event.data.object) ? event.data.object : {};
      const subId = inv.subscription ? String(inv.subscription) : null;
      if (subId) {
        try {
          await db.prepare(
            "UPDATE billing_payments SET status='paid', paid_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), subscription_status='active' " +
            "WHERE stripe_subscription_id = ?"
          ).bind(subId).run();
        } catch (e) {
          console.error("pay/webhook renewal update failed", e && e.message);
        }
      }
    } else if (event.type === "invoice.payment_failed") {
      // Failed renewal: satellite products treat past_due as grace — access
      // continues until the subscription is canceled, but the status is
      // honest. Naturally idempotent (UPDATE by subscription id).
      const inv = (event.data && event.data.object) ? event.data.object : {};
      const subId = inv.subscription ? String(inv.subscription) : null;
      if (subId) {
        try {
          await db.prepare(
            "UPDATE billing_payments SET subscription_status='past_due' WHERE stripe_subscription_id = ?"
          ).bind(subId).run();
        } catch (e) {
          console.error("pay/webhook payment_failed update failed", e && e.message);
        }
      }
    } else if (event.type === "customer.subscription.updated") {
      // Status transitions (trialing→active, active→past_due, etc.): mirror
      // Stripe's authoritative status. Naturally idempotent.
      const sub = (event.data && event.data.object) ? event.data.object : {};
      const subId = sub.id ? String(sub.id) : null;
      const status = sub.status ? String(sub.status) : null;
      if (subId && status) {
        try {
          await db.prepare(
            "UPDATE billing_payments SET subscription_status=? WHERE stripe_subscription_id = ?"
          ).bind(status, subId).run();
        } catch (e) {
          console.error("pay/webhook subscription.updated failed", e && e.message);
        }
      }
    } else if (event.type === "customer.subscription.deleted") {
      // Subscription canceled: satellite products stop granting access.
      const sub = (event.data && event.data.object) ? event.data.object : {};
      const subId = sub.id ? String(sub.id) : null;
      if (subId) {
        try {
          await db.prepare(
            "UPDATE billing_payments SET subscription_status='canceled' WHERE stripe_subscription_id = ?"
          ).bind(subId).run();
        } catch (e) {
          console.error("pay/webhook cancel update failed", e && e.message);
        }
      }
    }
    return json({ ok: true });
  } catch (e) {
    console.error("pay webhook error", e && e.message);
    return json({ ok: false }, 500);
  }
}
