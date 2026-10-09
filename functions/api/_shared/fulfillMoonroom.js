// functions/api/_shared/fulfillMoonroom.js
// Standalone ES module: Stripe fulfillment for fulfillment='moonroom' products
// (Moonroom AI photo studio — moonroom.mehyar.us). Called from the shared
// /api/pay/webhook in mehyar-web.
//
// Contract: fulfillMoonroom({ db, env, waitUntil, sendEmail }, payment)
//   db        — D1 binding (mehyar_leads_prod; has moonroom_orders)
//   env       — worker env (MOONROOM_BASE_URL; MOONROOM_FULFILL_SECRET optional)
//   waitUntil — Pages Functions waitUntil (optional; falls back to await)
//   sendEmail — injected mailer: sendEmail(env, {from, fromName, to, replyTo,
//               subject, text, html}) -> {ok, ...}. NEVER sends in local dev:
//               the caller injects a stub. In prod, mehyar-web injects a
//               wrapper around sendCloudflareEmail.
//   payment   — billing_payments row {id, product_id, email, metadata_json}
//               metadata_json.inputs = intake inputs captured at checkout.
//
// Behavior:
//   1. Idempotent: exactly one moonroom_orders row per payment.id
//      (UNIQUE index idx_moonroom_orders_payment). Replays return early.
//   2. Token unification: UPDATE billing_payments SET access_token so the
//      token in success_url_template gates every Moonroom buyer surface.
//   3. Background: POST MOONROOM_BASE_URL/api/moonroom/generate-fulfill
//      {order_token, sku} with x-moonroom-secret when MOONROOM_FULFILL_SECRET
//      is set; on success mark ready + email the token-gated success link;
//      on failure mark failed (failure_reason recorded) and DON'T email —
//      the buyer lands on success.html?token= from Stripe, which shows live
//      status + a retry button.
//
// Identity model: purchase-token + email. No Google login here — cross-
// subdomain better-auth sessions don't reach moonroom.mehyar.us (see the
// Track C auth assessment in ~/workspace/moonroom/notes/TRACKC-REPORT.md).

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const PRODUCT_NAMES = {
  "moonroom-headshot-pack": "Headshot Pack",
  "moonroom-product-studio": "Product Studio",
  "moonroom-theme-pack": "Theme Pack",
};

function randomToken(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function baseUrl(env) {
  return String(env.MOONROOM_BASE_URL || "https://moonroom.mehyar.us").replace(/\/+$/, "");
}

function fromAddress() {
  // moonroom.mehyar.us is not ESP-onboarded yet (standing rule: onboard on
  // both ESPs before sending from a product domain). Until then, send from
  // the proven mehyar.us identity.
  return { from: "team@mehyar.us", fromName: "Moonroom" };
}

export async function fulfillMoonroom({ db, env, waitUntil, sendEmail }, payment) {
  if (!db || !payment || !payment.id) throw new Error("fulfillMoonroom: bad args");

  const productId = payment.product_id;
  const productName = PRODUCT_NAMES[productId] || productId;

  let meta = {};
  try {
    meta = JSON.parse(payment.metadata_json || "{}");
  } catch {}
  // NOTE: the centralized /api/pay/checkout stores body.params FLAT as
  // metadata_json. Accept both the flat shape and a wrapped {inputs:{...}} shape.
  const intakeInputs = (meta && typeof meta === "object" && meta.inputs) || meta || {};

  // ── idempotent order create (one row per payment) ──
  const existing = await db
    .prepare("SELECT id, access_token, status, product_id FROM moonroom_orders WHERE payment_id = ?")
    .bind(payment.id)
    .first();
  if (existing) {
    return { ok: true, replay: true, order_id: existing.id, status: existing.status };
  }

  // Reuse the payment's checkout-time access_token as the order token (house
  // pattern: prepguide, sproutscore). The Stripe success_url is baked at
  // checkout creation with this token — minting a new one here orphans the
  // buyer's success page (status?token= -> not_found -> "Confirming..." hangs).
  const accessToken = payment.access_token;
  if (!accessToken) throw new Error("fulfillMoonroom: payment has no access_token");
  const inputsJson = JSON.stringify({ inputs: intakeInputs, sku: productId });
  const ins = await db
    .prepare(
      "INSERT INTO moonroom_orders (payment_id, product_id, email, inputs_json, status, access_token) " +
        "VALUES (?, ?, ?, ?, 'paid', ?)"
    )
    .bind(payment.id, productId, payment.email, inputsJson, accessToken)
    .run();
  const orderId = ins.meta.last_row_id;


  const { from, fromName } = fromAddress();
  const headers = { "content-type": "application/json" };
  if (env.MOONROOM_FULFILL_SECRET) headers["x-moonroom-secret"] = env.MOONROOM_FULFILL_SECRET;

  // ── background generation, then email ──
  const run = async () => {
    try {
      const genResp = await fetch(`${baseUrl(env)}/api/moonroom/generate-fulfill`, {
        method: "POST",
        headers,
        body: JSON.stringify({ order_token: accessToken, sku: productId }),
      });
      const genData = await genResp.json().catch(() => ({}));
      if (!genResp.ok || !genData.ok) {
        throw new Error("generate:" + String((genData && genData.error) || genResp.status));
      }
      // Generation is async (the worker finishes in waitUntil and calls back
      // /api/moonroom/fulfill-callback, which sends the ready email). Mark
      // fulfilling here and tell the buyer we're on it — never "ready" yet.
      await db
        .prepare(`UPDATE moonroom_orders SET status='fulfilling', updated_at=${nowSql} WHERE id=? AND status='paid'`)
        .bind(orderId)
        .run();

      const galleryUrl = `${baseUrl(env)}/gallery.html?token=${accessToken}`;
      const subject = `We're generating your Moonroom ${productName}`;
      const text =
        `Thanks for your purchase!\n\n` +
        `Your Moonroom ${productName} is in the studio now — usually ready in a few minutes. We'll email you the moment it's done.\n\n` +
        `You can watch the progress here:\n${galleryUrl}\n\n-- ${fromName}`;
      const html =
        `<p>Thanks for your purchase!</p>` +
        `<p>Your <strong>Moonroom ${productName}</strong> is in the studio now — usually ready in a few minutes. We'll email you the moment it's done.</p>` +
        `<p><a href="${galleryUrl}" style="display:inline-block;background:#e6c98a;color:#141021;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:bold;">Watch progress</a></p>` +
        `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${galleryUrl}">${galleryUrl}</a></p>` +
        `<p>-- ${fromName}</p>`;
      const result = await sendEmail(env, { from, fromName, to: payment.email, replyTo: "info@mehyar.us", subject, text, html });
      if (!result.ok) {
        console.error("fulfillMoonroom generating email failed", productId, result.error);
      }
      // NOTE: email_sent_at is NOT set here — the fulfill-callback sends the
      // ready email and stamps it then.
    } catch (e) {
      console.error("fulfillMoonroom background generate failed", productId, e && e.message);
      try {
        await db.prepare("UPDATE moonroom_orders SET status='failed', failure_reason=? WHERE id=? AND status='paid'")
          .bind(String((e && e.message) || e).slice(0, 200), orderId).run();
      } catch {}
      // No email on failure: the buyer lands on success.html?token= from
      // Stripe, which shows live status + a retry button that re-POSTs
      // /api/moonroom/generate-fulfill with their token.
    }
  };

  if (typeof waitUntil === "function") waitUntil(run());
  else await run();

  return { ok: true, order_id: orderId, mode: "single", sku: productId };
}
