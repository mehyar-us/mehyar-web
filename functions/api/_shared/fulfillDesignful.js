// pwa/fulfill-designful.js
// Standalone ES module: Stripe fulfillment for fulfillment='designful' products.
// Called from the shared /api/pay/webhook in mehyar-web (see INTEGRATION.md
// for the exact hook patch). Modeled on the webhook's `digital` hook.
//
// Contract: fulfillDesignful({ db, env, waitUntil, sendEmail }, payment)
//   db        — D1 binding (shared mehyar-jobs DB; has designful_orders)
//   env       — worker env (needs DESIGNFUL_BASE_URL)
//   waitUntil — Pages Functions waitUntil (optional; falls back to await)
//   sendEmail — injected mailer: sendEmail(env, {from, fromName, to, replyTo,
//               subject, text, html}) -> {ok, ...}. NEVER sends in local dev:
//               the caller injects a stub. In prod, mehyar-web injects a
//               wrapper around sendCloudflareEmail.
//   payment   — billing_payments row {id, product_id, email, metadata_json}
//               metadata_json.inputs = intake inputs captured at checkout
//               (see INTEGRATION.md for the checkout metadata contract).
//
// Behavior:
//   1. Idempotent: exactly one designful_orders row per payment.id
//      (UNIQUE index idx_designful_orders_payment). Replays return early.
//   2. Single-feature SKU → create order (bundle_slots NULL), then background:
//      POST DESIGNFUL_BASE_URL/api/designful/generate {order_token, feature,
//      inputs}; on success mark ready + email the token-gated deliverable
//      link; on failure mark failed (buyer retries from the deliverable page).
//   3. Bundle SKU → create order with bundle_slots 3|5, email the buyer the
//      feature-picker link (success.html?token= doubles as picker). No
//      generation yet — each pick POSTs /api/designful/generate, which
//      enforces slot consumption in inputs_json.used_features.

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const BUNDLE_SLOTS = {
  "designful-bundle-3": 3,
  "designful-studio-pass": 5,
};

const SINGLE_FEATURE = {
  "designful-homepage-teardown": "homepage-teardown",
  "designful-logo-refresh": "logo-refresh",
  "designful-ad-creative-pack": "ad-creative-pack",
  "designful-social-launch-kit": "social-launch-kit",
  "designful-hero-rewrite": "hero-rewrite",
};

const PRODUCT_NAMES = {
  "designful-homepage-teardown": "Homepage Teardown",
  "designful-logo-refresh": "Logo Refresh",
  "designful-ad-creative-pack": "Ad Creative Pack",
  "designful-social-launch-kit": "Social Launch Kit",
  "designful-hero-rewrite": "Hero Rewrite",
  "designful-bundle-3": "Designful — Any 3 Features",
  "designful-studio-pass": "Designful Studio Pass",
};

function randomToken(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function baseUrl(env) {
  return String(env.DESIGNFUL_BASE_URL || "https://designful.mehyar.us").replace(/\/+$/, "");
}

function fromAddress(env) {
  // Until the designful subdomain is onboarded on both ESPs (standing rule),
  // send from the proven mehyar.us identity.
  return {
    from: env.DESIGNFUL_FROM_EMAIL || "team@mehyar.us",
    fromName: "Designful",
  };
}

export async function fulfillDesignful({ db, env, waitUntil, sendEmail }, payment) {
  if (!db || !payment || !payment.id) throw new Error("fulfillDesignful: bad args");

  // Temporary debug trace (webhook_debug table) — remove after diagnosis.
  const trace = async (step, detail) => {
    try {
      await db.prepare(
        "INSERT INTO webhook_debug (created_at, payment_id, step, detail) VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?, ?, ?)"
      ).bind(payment.id, step, String(detail || "").slice(0, 300)).run();
    } catch {}
  };
  await trace("fulfill_start", payment.product_id);

  const productId = payment.product_id;
  const bundleSlots = BUNDLE_SLOTS[productId] ?? null;
  const feature = SINGLE_FEATURE[productId] || null;
  const productName = PRODUCT_NAMES[productId] || productId;

  let meta = {};
  try {
    meta = JSON.parse(payment.metadata_json || "{}");
  } catch {}
  // NOTE: the centralized /api/pay/checkout stores body.params FLAT as
  // metadata_json (see checkout.js: metadata_json = JSON.stringify(params)).
  // Accept both the flat shape and a wrapped {inputs:{...}} shape.
  const intakeInputs = (meta && typeof meta === "object" && meta.inputs) || meta || {};

  // ── idempotent order create (one row per payment) ──
  const existing = await db
    .prepare("SELECT id, access_token, status, product_id FROM designful_orders WHERE payment_id = ?")
    .bind(payment.id)
    .first();
  if (existing) {
    return { ok: true, replay: true, order_id: existing.id, status: existing.status };
  }

  const accessToken = randomToken(32);
  const inputsJson = JSON.stringify({
    inputs: intakeInputs,
    feature, // single-feature SKU; null for bundles (buyer picks later)
    used_features: [],
  });
  const ins = await db
    .prepare(
      "INSERT INTO designful_orders (payment_id, product_id, email, inputs_json, bundle_slots, status, access_token) " +
        "VALUES (?, ?, ?, ?, ?, 'paid', ?)"
    )
    .bind(payment.id, productId, payment.email, inputsJson, bundleSlots, accessToken)
    .run();
  const orderId = ins.meta.last_row_id;
  await trace("order_inserted", "order_id=" + orderId);

  // Token unification: the Stripe success_url_template receives
  // billing_payments.access_token, but every Designful surface (generate.js,
  // deliverable.html, success.html picker) gates on designful_orders tokens.
  // Point the payment row at the Designful token so ONE token works everywhere.
  await db
    .prepare("UPDATE billing_payments SET access_token = ? WHERE id = ?")
    .bind(accessToken, payment.id)
    .run();
  await trace("token_unified", "order_id=" + orderId);

  const { from, fromName } = fromAddress(env);

  // ── bundles: email the picker link, no generation yet ──
  if (bundleSlots) {
    const pickerUrl = `${baseUrl(env)}/success.html?token=${accessToken}`;
    const subject = `Choose your ${bundleSlots} Designful features`;
    const text =
      `Thanks for your purchase!\n\n` +
      `Your ${productName} is paid and ready to use. Pick your ${bundleSlots} features here:\n${pickerUrl}\n\n` +
      `Each feature you pick is generated fresh for you — usually ready in a few minutes.\n\n` +
      `This link is personal to you — keep it somewhere safe.\n\n-- ${fromName}`;
    const html =
      `<p>Thanks for your purchase!</p>` +
      `<p>Your <strong>${productName}</strong> is paid and ready to use.</p>` +
      `<p><a href="${pickerUrl}" style="display:inline-block;background:#111827;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Choose your ${bundleSlots} features</a></p>` +
      `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${pickerUrl}">${pickerUrl}</a></p>` +
      `<p style="color:#6b7280;font-size:13px;">Each feature you pick is generated fresh for you — usually ready in a few minutes. This link is personal to you — keep it somewhere safe.</p>` +
      `<p>-- ${fromName}</p>`;
    const result = await sendEmail(env, { from, fromName, to: payment.email, replyTo: "info@mehyar.us", subject, text, html });
    if (!result.ok) console.error("fulfillDesignful bundle email failed", productId, result.error);
    return { ok: true, order_id: orderId, mode: "bundle", slots: bundleSlots, email_ok: !!result.ok };
  }

  // ── single feature: background generation, then email ──
  const run = async () => {
    try {
      const genResp = await fetch(`${baseUrl(env)}/api/designful/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_token: accessToken, feature, inputs: intakeInputs }),
      });
      const genData = await genResp.json().catch(() => ({}));
      if (!genResp.ok || !genData.ok) {
        throw new Error("generate:" + String((genData && genData.error) || genResp.status));
      }
      await db
        .prepare(`UPDATE designful_orders SET status='ready', output_json=?, ready_at=${nowSql} WHERE id=? AND status!='ready'`)
        .bind(JSON.stringify(genData.manifest || {}), orderId)
        .run();

      const deliverUrl = `${baseUrl(env)}/deliverable.html?token=${accessToken}`;
      const subject = `Your ${productName} is ready`;
      const text =
        `Thanks for your purchase!\n\n` +
        `Your ${productName} deliverable is ready:\n${deliverUrl}\n\n` +
        `This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.\n\n-- ${fromName}`;
      const html =
        `<p>Thanks for your purchase!</p>` +
        `<p>Your <strong>${productName}</strong> deliverable is ready:</p>` +
        `<p><a href="${deliverUrl}" style="display:inline-block;background:#111827;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">View your deliverable</a></p>` +
        `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${deliverUrl}">${deliverUrl}</a></p>` +
        `<p style="color:#6b7280;font-size:13px;">This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.</p>` +
        `<p>-- ${fromName}</p>`;
      const result = await sendEmail(env, { from, fromName, to: payment.email, replyTo: "info@mehyar.us", subject, text, html });
      if (!result.ok) console.error("fulfillDesignful deliverable email failed", productId, result.error);
    } catch (e) {
      console.error("fulfillDesignful background generate failed", productId, e && e.message);
      try {
        await db.prepare("UPDATE designful_orders SET status='failed' WHERE id=? AND status='paid'")
          .bind(orderId).run();
      } catch {}
      // No email on failure: the buyer lands on success.html?token= from
      // Stripe, which shows live status + a retry button that re-POSTs
      // /api/designful/generate with their token.
    }
  };

  if (typeof waitUntil === "function") waitUntil(run());
  else await run();

  return { ok: true, order_id: orderId, mode: "single", feature };
}
