// functions/api/_shared/fulfillTicketBeat.js
// Fulfillment hook for TicketBeat (fulfillment='ticketbeat').
// SKUs: ticketbeat-letter ($9.99 one-time → one dispute letter),
//       ticketbeat-monthly ($6.99/mo → unlimited letters while subscribed).
//
// Contract: fulfillTicketBeat({ db, request, env, waitUntil }, payment, sess)
//   payment — billing_payments row (already marked paid by the webhook).
//   sess    — Stripe checkout.session.completed object (has .subscription
//             for the monthly SKU).
//
// Behavior:
//   1. Idempotent: exactly one ticketbeat_orders row per payment.id
//      (UNIQUE idx_ticketbeat_orders_payment). Replays return early.
//   2. ticketbeat-letter: create order keyed on payment.access_token (already
//      the token on the buyer's Stripe success_url — NO retokenizing, which
//      would race the redirect), then background (waitUntil):
//      POST TICKETBEAT_BASE_URL/api/letter/generate {order_token, inputs}
//      → mark order ready + store letter/pdf URLs → email the buyer the
//      PDF link. On failure: mark failed, NO email (buyer retries from
//      success.html?token=, which polls /api/pay/status).
//   3. ticketbeat-monthly: create ticketbeat_subscriptions row
//      (email, stripe_subscription_id, status active) — idempotent per
//      payment.id — then email the buyer the coverage link. The product
//      worker gates letter generation on the active subscription; the
//      webhook's invoice.payment_succeeded handler keeps
//      billing_payments.subscription_status fresh (renewals + cancels).
//   Standing order: NO external email other than the buyer's own receipt /
//   deliverable. No campaigns, no drips from here.

import { sendCloudflareEmail } from "./cloudflareEmail.js";

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function baseUrl(env) {
  return String(env.TICKETBEAT_BASE_URL || "https://ticketbeat.mehyar.us").replace(/\/+$/, "");
}

function fromAddress(env) {
  // Until ticketbeat.mehyar.us is onboarded on both ESPs (standing rule),
  // send from the proven mehyar.us identity.
  return { from: env.TICKETBEAT_FROM_EMAIL || "team@mehyar.us", fromName: "TicketBeat" };
}

async function emailDeliverable(env, payment, productName, deliverUrl, extraLine) {
  const { from, fromName } = fromAddress(env);
  const subject = `Your ${productName} is ready`;
  const text =
    `Thanks for your purchase!\n\n` +
    `Your ${productName} is ready:\n${deliverUrl}\n\n` +
    (extraLine ? extraLine + `\n\n` : "") +
    `This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.\n\n` +
    `Not legal advice. TicketBeat shows real adjudication data; no outcome is guaranteed.\n\n-- ${fromName}`;
  const html =
    `<p>Thanks for your purchase!</p>` +
    `<p>Your <strong>${productName}</strong> is ready:</p>` +
    `<p><a href="${deliverUrl}" style="display:inline-block;background:#0f766e;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Get your dispute letter</a></p>` +
    `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${deliverUrl}">${deliverUrl}</a></p>` +
    (extraLine ? `<p style="color:#6b7280;font-size:13px;">${extraLine}</p>` : "") +
    `<p style="color:#6b7280;font-size:13px;">This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.</p>` +
    `<p style="color:#6b7280;font-size:13px;">Not legal advice. TicketBeat shows real adjudication data; no outcome is guaranteed.</p>` +
    `<p>-- ${fromName}</p>`;
  return sendCloudflareEmail(env, {
    from, fromName, to: payment.email, replyTo: "info@mehyar.us", subject, text, html,
  });
}

export async function fulfillTicketBeat({ db, request, env, waitUntil }, payment, sess) {
  if (!db || !payment || !payment.id) throw new Error("fulfillTicketBeat: bad args");

  const productId = payment.product_id;
  const isMonthly = productId === "ticketbeat-monthly";
  const productName = isMonthly
    ? "TicketBeat Monthly — Every Ticket Covered"
    : "TicketBeat — Dispute Letter";

  let meta = {};
  try { meta = JSON.parse(payment.metadata_json || "{}"); } catch {}
  const intakeInputs = (meta && typeof meta === "object" && meta.inputs) || meta || {};

  // ── idempotent order create (one row per payment) ──
  const existing = await db
    .prepare("SELECT id, access_token, status FROM ticketbeat_orders WHERE payment_id = ?")
    .bind(payment.id)
    .first();
  if (existing) {
    return { ok: true, replay: true, order_id: existing.id, status: existing.status };
  }

  // Token unification: reuse the payment's access_token as the order token.
  // Stripe's success_url was minted with it at checkout time, so the buyer
  // lands on success.html?token= with a token that gates BOTH the payment
  // status poll and the letter endpoints. Generating a new token here would
  // race the redirect and strand the buyer on a dead token.
  const accessToken = String(payment.access_token || "");
  if (accessToken.length < 16) throw new Error("fulfillTicketBeat: payment has no access_token");

  const ins = await db
    .prepare(
      "INSERT INTO ticketbeat_orders (payment_id, product_id, email, inputs_json, status, access_token) " +
        "VALUES (?, ?, ?, ?, 'paid', ?)"
    )
    .bind(payment.id, productId, payment.email, JSON.stringify({ inputs: intakeInputs }), accessToken)
    .run();
  const orderId = ins.meta.last_row_id;

  // ── monthly: record the subscription, email the coverage link ──
  if (isMonthly) {
    const subId = (sess && sess.subscription) ? String(sess.subscription) : null;
    await db.prepare(
      "INSERT INTO ticketbeat_subscriptions (payment_id, email, stripe_subscription_id, status) VALUES (?, ?, ?, 'active') " +
        "ON CONFLICT(payment_id) DO UPDATE SET stripe_subscription_id=excluded.stripe_subscription_id, status='active'"
    ).bind(payment.id, payment.email, subId).run();

    const letterUrl = `${baseUrl(env)}/letter.html?token=${accessToken}`;
    const result = await emailDeliverable(
      env, payment, productName, letterUrl,
      "Your monthly coverage is active — dispute every ticket you get while subscribed."
    );
    if (!result.ok) console.error("fulfillTicketBeat monthly email failed", result.error);
    return { ok: true, order_id: orderId, mode: "subscription", email_ok: !!result.ok };
  }

  // ── one-time letter: background generation, then email ──
  const run = async () => {
    try {
      const genResp = await fetch(`${baseUrl(env)}/api/letter/generate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // Shared secret with the TicketBeat Pages project (dashboard secret
          // TICKETBEAT_INTERNAL_KEY on both sides; never committed).
          "x-ticketbeat-key": String(env.TICKETBEAT_INTERNAL_KEY || ""),
        },
        body: JSON.stringify({ order_token: accessToken, inputs: intakeInputs }),
        signal: AbortSignal.timeout(120000),
      });
      const genData = await genResp.json().catch(() => ({}));
      if (!genResp.ok || !genData.ok) {
        throw new Error("generate:" + String((genData && genData.error) || genResp.status));
      }
      await db.prepare(
        `UPDATE ticketbeat_orders SET status='ready', letter_url=?, pdf_url=?, ready_at=${nowSql} WHERE id=? AND status!='ready'`
      ).bind(genData.letter_url || null, genData.pdf_url || null, orderId).run();

      const deliverUrl = genData.pdf_url || `${baseUrl(env)}/letter.html?token=${accessToken}`;
      const result = await emailDeliverable(env, payment, productName, deliverUrl);
      if (!result.ok) console.error("fulfillTicketBeat letter email failed", result.error);
    } catch (e) {
      console.error("fulfillTicketBeat background generate failed", e && e.message);
      try {
        await db.prepare("UPDATE ticketbeat_orders SET status='failed' WHERE id=? AND status='paid'")
          .bind(orderId).run();
      } catch {}
      // No email on failure: the buyer lands on success.html?token= from
      // Stripe, which shows live status + a retry button that re-POSTs
      // /api/letter/generate with their token.
    }
  };

  if (typeof waitUntil === "function") waitUntil(run());
  else await run();

  return { ok: true, order_id: orderId, mode: "single" };
}
