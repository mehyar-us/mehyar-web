// functions/api/_shared/fulfillBeachCall.js
// Standalone ES module: Stripe fulfillment for fulfillment='beachcall' products.
// Called from the shared /api/pay/webhook in mehyar-web. Modeled exactly on
// fulfillDesignful.js (same contract, same idempotency + token-unification
// rules, same "never throw out of the hook" discipline).
//
// Contract: fulfillBeachCall({ db, env, waitUntil, sendEmail }, payment)
//   db        — D1 binding (shared mehyar-jobs DB; has beachcall_orders,
//               beachcall_subscribers, beachcall_suppressions)
//   env       — worker env (needs BEACHCALL_BASE_URL, optional BEACHCALL_FROM_EMAIL)
//   waitUntil — Pages Functions waitUntil (unused here; no background work)
//   sendEmail — injected mailer: sendEmail(env, {from, fromName, to, replyTo,
//               subject, text, html}) -> {ok, ...}. NEVER sends in local dev:
//               the caller injects a stub. In prod, mehyar-web injects a
//               wrapper around sendCloudflareEmail.
//   payment   — billing_payments row {id, product_id, email, metadata_json}
//               metadata_json = intake inputs captured at checkout (flat
//               params or {inputs:{...}} wrapper — read loosely).
//
// Behavior:
//   1. Idempotent: exactly one beachcall_orders row per payment.id
//      (UNIQUE index idx_beachcall_orders_payment). Replays return
//      {ok:true, replay:true} and do NOTHING else (no second email, no
//      duplicate subscriber upgrade).
//   2. Token unification: UPDATE billing_payments SET access_token =
//      <order token> so ONE token gates the Stripe success page and the
//      BeachCall pass surfaces.
//   3. Subscriber upgrade: upsert the buyer into beachcall_subscribers with
//      tier='paid' (create if absent, beaches default '[]').
//   4. SUPPRESSION: beachcall_suppressions is the per-product do-not-mail
//      list (populated by the product's unsubscribe.js). The pass-delivery
//      email is product email and MUST respect it: if the buyer email is
//      suppressed, skip the send — the order is still created and the token
//      still works on success.html. Result carries email_skipped:'suppressed'.
//   5. Never throw out of the hook: on fulfillment failure the order is
//      marked 'failed' and NO email is sent (the buyer retries from
//      success.html?token=, which shows live status).

const PRODUCT_ID = "beachcall-summer-pass";
const PRODUCT_NAME = "BeachCall Summer Pass";

function randomToken(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function baseUrl(env) {
  return String(env.BEACHCALL_BASE_URL || "https://beachcall.mehyar.us").replace(/\/+$/, "");
}

function fromAddress(env) {
  // Until the beachcall subdomain is onboarded on both ESPs (standing rule),
  // send from the proven mehyar.us identity.
  return {
    from: env.BEACHCALL_FROM_EMAIL || "team@mehyar.us",
    fromName: "BeachCall",
  };
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export async function fulfillBeachCall({ db, env, waitUntil, sendEmail }, payment) {
  if (!db || !payment || !payment.id) {
    return { ok: false, error: "bad_args" };
  }

  const productId = payment.product_id || PRODUCT_ID;
  const buyerEmail = normalizeEmail(payment.email);

  let meta = {};
  try {
    meta = JSON.parse(payment.metadata_json || "{}");
  } catch {}
  // NOTE: the centralized /api/pay/checkout stores body.params FLAT as
  // metadata_json. Accept both the flat shape and a wrapped {inputs:{...}} shape.
  const intakeInputs = (meta && typeof meta === "object" && meta.inputs) || meta || {};

  try {
    // ── idempotent order create (one row per payment) ──
    const existing = await db
      .prepare("SELECT id, access_token, status, product_id FROM beachcall_orders WHERE payment_id = ?")
      .bind(payment.id)
      .first();
    if (existing) {
      return { ok: true, replay: true, order_id: existing.id, status: existing.status };
    }

    const accessToken = randomToken(32);
    let orderId;
    try {
      const ins = await db
        .prepare(
          "INSERT INTO beachcall_orders (payment_id, product_id, email, access_token, status) " +
            "VALUES (?, ?, ?, ?, 'paid')"
        )
        .bind(payment.id, productId, buyerEmail, accessToken)
        .run();
      orderId = ins.meta.last_row_id;
    } catch (e) {
      // Race lost to a concurrent delivery — treat as replay.
      const raced = await db
        .prepare("SELECT id, status FROM beachcall_orders WHERE payment_id = ?")
        .bind(payment.id)
        .first();
      if (raced) {
        return { ok: true, replay: true, order_id: raced.id, status: raced.status };
      }
      throw e;
    }

    // Token unification: every BeachCall surface (success.html, pass pages)
    // gates on the beachcall_orders token; point the payment row at it so
    // ONE token works everywhere.
    await db
      .prepare("UPDATE billing_payments SET access_token = ? WHERE id = ?")
      .bind(accessToken, payment.id)
      .run();

    // Subscriber upgrade: free subscriber (if any) becomes a paid pass
    // holder. Create the row if absent (beaches default '[]'). Best effort:
    // a missing beachcall_subscribers table must not kill fulfillment —
    // the site lane owns the table (see beachcall D1.md).
    let subscriberUpgraded = false;
    try {
      await db
        .prepare(
          "INSERT INTO beachcall_subscribers (email, beaches, tier) VALUES (?, '[]', 'paid') " +
            "ON CONFLICT(email) DO UPDATE SET tier='paid'"
        )
        .bind(buyerEmail)
        .run();
      subscriberUpgraded = true;
    } catch (e) {
      console.error("fulfillBeachCall subscriber upgrade failed", productId, e && e.message);
    }

    const { from, fromName } = fromAddress(env);
    const passUrl = `${baseUrl(env)}/success.html?token=${accessToken}`;

    // ── SUPPRESSION CHECK: do-not-mail list wins over product email ──
    // beachcall_suppressions is populated by the product's unsubscribe.js.
    // The pass-delivery email counts as product email and MUST respect it:
    // skip the send, keep the order + token working.
    let suppressed = false;
    try {
      const sup = await db
        .prepare("SELECT email FROM beachcall_suppressions WHERE email = ?")
        .bind(buyerEmail)
        .first();
      suppressed = !!sup;
    } catch (e) {
      // Table missing — fail open on the email side is wrong; fail CLOSED:
      // log loudly, still skip the send, and note it in the result.
      console.error("fulfillBeachCall suppression lookup failed", e && e.message);
      suppressed = true;
    }

    if (suppressed) {
      return {
        ok: true,
        order_id: orderId,
        mode: "pass",
        email_skipped: "suppressed",
        subscriber_upgraded: subscriberUpgraded,
        intake: intakeInputs,
      };
    }

    // ── pass email ──
    const subject = `Your ${PRODUCT_NAME} is active`;
    const text =
      `Thanks for your purchase!\n\n` +
      `Your ${PRODUCT_NAME} is paid and active for the whole beach season:\n\n` +
      `• Daily go/no-go verdicts for ALL your beaches (free tier covers just one)\n` +
      `• Best-hours windows for each beach, every day\n` +
      `• Morning go/no-go emails before the kids wake up\n` +
      `• The Friday weekend outlook\n\n` +
      `Your pass link (works all season):\n${passUrl}\n\n` +
      `This link is personal to you — keep it somewhere safe.\n\n-- ${fromName}`;
    const html =
      `<p>Thanks for your purchase!</p>` +
      `<p>Your <strong>${PRODUCT_NAME}</strong> is paid and active for the whole beach season:</p>` +
      `<ul><li>Daily go/no-go verdicts for <strong>all</strong> your beaches (free tier covers just one)</li>` +
      `<li>Best-hours windows for each beach, every day</li>` +
      `<li>Morning go/no-go emails before the kids wake up</li>` +
      `<li>The Friday weekend outlook</li></ul>` +
      `<p><a href="${passUrl}" style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Open your pass</a></p>` +
      `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${passUrl}">${passUrl}</a></p>` +
      `<p style="color:#6b7280;font-size:13px;">This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.</p>` +
      `<p>-- ${fromName}</p>`;
    const result = await sendEmail(env, {
      from,
      fromName,
      to: payment.email,
      replyTo: "info@mehyar.us",
      subject,
      text,
      html,
    });
    if (!result || !result.ok) {
      console.error("fulfillBeachCall pass email failed", productId, result && result.error);
    }
    return {
      ok: true,
      order_id: orderId,
      mode: "pass",
      email_ok: !!(result && result.ok),
      subscriber_upgraded: subscriberUpgraded,
      intake: intakeInputs,
    };
  } catch (e) {
    // Never throw out of the hook: mark the order failed, no email.
    console.error("fulfillBeachCall failed", e && e.message);
    try {
      await db
        .prepare("UPDATE beachcall_orders SET status='failed' WHERE payment_id=? AND status='paid'")
        .bind(payment.id)
        .run();
    } catch {}
    return { ok: false, error: String((e && e.message) || e).slice(0, 120) };
  }
}
