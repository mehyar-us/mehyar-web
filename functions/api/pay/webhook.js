// functions/api/pay/webhook.js
// POST /api/pay/webhook — SHARED Stripe webhook for every brand/product on
// this worker. One endpoint, one secret. Dispatches fulfillment per the
// product's `fulfillment` column in billing_products.
//
// Event: checkout.session.completed only. Verifies the Stripe signature
// (live secret first, test secret fallback — same as the legacy audit
// webhook), marks the billing_payments row paid, then runs the product's
// fulfillment hook. Duplicate deliveries for the same session are ignored.
//
// NOTE: the legacy /api/audit/full-report/webhook is left untouched —
// sessions it created in flight keep working on their registered URLs.

import { sendCloudflareEmail } from "../_shared/cloudflareEmail.js";

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
      return json({ ok: false, error: "bad_signature" }, 400);
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
          // pending → skip re-processing, still answer 200.
          const duplicate = payment.stripe_session_id && payment.stripe_session_id === sess.id && payment.status !== "pending";
          if (!duplicate) {
            await db.prepare(
              "UPDATE billing_payments SET stripe_payment_intent=?, stripe_session_id=?, status='paid', paid_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') " +
              "WHERE id=? AND status != 'paid'"
            ).bind(sess.payment_intent || null, sess.id || null, paymentId).run();
            // Fulfillment dispatch by product.
            const product = await db.prepare(
              "SELECT * FROM billing_products WHERE id = ?"
            ).bind(payment.product_id).first();
            const hook = fulfillHooks[(product && product.fulfillment) || "none"] || fulfillHooks.none;
            try {
              await hook({ db, request, env, waitUntil }, payment, sess);
            } catch (e) {
              console.error("pay/webhook fulfillment failed", payment.product_id, e && e.message);
            }
          }
        }
      }
    }
    return json({ ok: true });
  } catch (e) {
    console.error("pay webhook error", e && e.message);
    return json({ ok: false }, 500);
  }
}
