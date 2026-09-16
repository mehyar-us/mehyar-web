// functions/api/_shared/fulfillTruesketch.js
// Standalone ES module: Stripe fulfillment for fulfillment='truesketch' products.
// Called from the shared /api/pay/webhook in mehyar-web.
// Modeled on fulfillBizbuilder.js (same "POST to product backend, then email"
// shape), with one deliberate difference: the TrueSketch PWA owns the order
// row. The PWA's POST /api/generate creates truesketch_orders (idempotent on
// payment_id via idx_ts_orders_payment) and stores the BILLING access_token,
// so this hook does NOT create a local order row and does NOT rewrite
// billing_payments.access_token.
//
// Contract: fulfillTruesketch({ db, env, waitUntil, sendEmail }, payment)
//   db        — D1 binding (not strictly needed here; kept for contract parity)
//   env       — worker env (TRUESKETCH_BASE_URL, TRUESKETCH_GENERATE_SECRET)
//   waitUntil — Pages Functions waitUntil (optional; falls back to await)
//   sendEmail — injected mailer: sendEmail(env, {from, fromName, to, replyTo,
//               subject, text, html}) -> {ok, ...}. NEVER sends in local dev:
//               the caller injects a stub. In prod, mehyar-web injects a
//               wrapper around sendCloudflareEmail.
//   payment   — billing_payments row {id, product_id, email, access_token,
//               metadata_json}  (metadata_json = checkout body.params FLAT:
//               {intake_id, name} — accept a wrapped {inputs:{...}} shape too)
//
// Behavior:
//   1. Idempotent: the PWA's /api/generate dedupes on payment_id and answers
//      {replay:true}; on replay this hook sends NO email (do nothing).
//   2. Background: POST TRUESKETCH_BASE_URL/api/generate
//      {payment_id, access_token, email, product_id, intake_id} with
//      Authorization: Bearer <TRUESKETCH_GENERATE_SECRET>.
//   3. On success: email the buyer (team@mehyar.us) the token-gated gallery
//      link. On failure: mark nothing locally (the PWA marks its row failed),
//      send NO email — the buyer's success page polls /api/order-status and
//      shows live status + retry guidance. Never throws.

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function baseUrl(env) {
  return String(env.TRUESKETCH_BASE_URL || "https://truesketch.mehyar.us").replace(/\/+$/, "");
}

export async function fulfillTruesketch({ db, env, waitUntil, sendEmail }, payment) {
  if (!payment || !payment.id) {
    console.error("fulfillTruesketch: bad args — no payment");
    return { ok: false, error: "bad_args" };
  }

  const productId = payment.product_id;
  const accessToken = payment.access_token;
  if (typeof accessToken !== "string" || accessToken.length < 16) {
    console.error("fulfillTruesketch: payment missing access_token", payment.id);
    return { ok: false, error: "no_access_token" };
  }

  const secret = env.TRUESKETCH_GENERATE_SECRET;
  if (!secret) {
    console.error("fulfillTruesketch: TRUESKETCH_GENERATE_SECRET not set");
    return { ok: false, error: "no_generate_secret" };
  }

  let meta = {};
  try {
    meta = JSON.parse(payment.metadata_json || "{}");
  } catch {}
  // NOTE: the centralized /api/pay/checkout stores body.params FLAT as
  // metadata_json (see checkout.js: metadata_json = JSON.stringify(params)).
  // Accept both the flat shape and a wrapped {inputs:{...}} shape.
  const inputs = (meta && typeof meta === "object" && meta.inputs) || meta || {};
  const intakeId = inputs.intake_id || null;

  const run = async () => {
    try {
      const genResp = await fetch(`${baseUrl(env)}/api/generate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // Server-side self-requests carry a normal browser User-Agent
          // (Cloudflare bot firewall 1010s non-browser clients).
          "user-agent": BROWSER_UA,
          authorization: "Bearer " + secret,
        },
        body: JSON.stringify({
          payment_id: payment.id,
          access_token: accessToken,
          email: payment.email,
          product_id: productId,
          intake_id: intakeId,
        }),
      });
      const genData = await genResp.json().catch(() => ({}));
      if (!genResp.ok || !genData.ok) {
        throw new Error("generate:" + String((genData && genData.error) || genResp.status));
      }

      // Idempotent replay from the PWA: the buyer's first delivery already
      // emailed them (or they reach the gallery via success.html?token=).
      // Do nothing — specifically, send NO duplicate email.
      if (genData.replay) {
        return { ok: true, replay: true };
      }

      const galleryUrl =
        genData.gallery_url || `${baseUrl(env)}/gallery.html?token=${accessToken}`;
      const buyerName = (inputs.name || "").trim();
      const greeting = buyerName ? `Hi ${buyerName},\n\n` : "";
      const subject = "Your TrueSketch portrait + reading is ready";
      const text =
        `Thanks for your purchase!\n\n` +
        greeting +
        `Your personalized AI portrait sketch and 2-page reading are ready:\n${galleryUrl}\n\n` +
        `A mystical mirror of who you are and where you're headed — painted and written just for you.\n\n` +
        `This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.\n\n` +
        `-- TrueSketch\n\n` +
        `P.S. For entertainment purposes only.`;
      const html =
        `<p>Thanks for your purchase!</p>` +
        (buyerName ? `<p>Hi ${escapeHtml(buyerName)},</p>` : "") +
        `<p>Your personalized <strong>AI portrait sketch</strong> and <strong>2-page reading</strong> are ready:</p>` +
        `<p><a href="${galleryUrl}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">View your TrueSketch</a></p>` +
        `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${galleryUrl}">${galleryUrl}</a></p>` +
        `<p style="color:#6b7280;font-size:13px;">A mystical mirror of who you are and where you're headed — painted and written just for you. This link is personal to you — keep it somewhere safe.</p>` +
        `<p style="color:#9ca3af;font-size:12px;">For entertainment purposes only.</p>` +
        `<p>-- TrueSketch</p>`;
      const result = await sendEmail(
        env,
        {
          from: "team@mehyar.us",
          fromName: "TrueSketch",
          to: payment.email,
          replyTo: "info@mehyar.us",
          subject,
          text,
          html,
        }
      );
      if (!result.ok) {
        console.error("fulfillTruesketch gallery email failed", productId, result.error);
      }
      return { ok: true, replay: false, gallery_url: galleryUrl };
    } catch (e) {
      // No email on failure: the buyer lands on success.html?token= from
      // Stripe, which polls /api/order-status and shows live status + retry
      // guidance. The PWA marks its own order row failed. Never throw out of
      // the hook (the webhook catches, but a clean return is safer).
      console.error("fulfillTruesketch background generate failed", productId, e && e.message);
      return { ok: false, error: String((e && e.message) || e).slice(0, 120) };
    }
  };

  if (typeof waitUntil === "function") waitUntil(run());
  else await run();

  return { ok: true, mode: "trigger-and-email" };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}
