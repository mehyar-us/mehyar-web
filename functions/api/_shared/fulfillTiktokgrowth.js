// functions/api/_shared/fulfillTiktokgrowth.js
// Standalone ES module: Stripe fulfillment for fulfillment='tiktokgrowth' products.
// Called from the shared /api/pay/webhook in mehyar-web.
// Modeled on fulfillDesignful.js.
//
// Contract: fulfillTiktokgrowth({ db, env, waitUntil, sendEmail }, payment)
//   db        — D1 binding (shared mehyar-jobs DB; has tiktokgrowth_orders)
//   env       — worker env (needs TIKTOKGROWTH_BASE_URL)
//   waitUntil — Pages Functions waitUntil (optional; falls back to await)
//   sendEmail — injected mailer: sendEmail(env, {from, fromName, to, replyTo,
//               subject, text, html}) -> {ok, ...}
//   payment   — billing_payments row {id, product_id, email, metadata_json}
//               metadata_json = checkout params FLAT
//               (see checkout.js: metadata_json = JSON.stringify(params)).
//               Accept both the flat shape and a wrapped {inputs:{...}} shape.
//
// Behavior:
//   1. Idempotent: exactly one tiktokgrowth_orders row per payment.id
//      (UNIQUE index idx_tiktokgrowth_orders_payment). Replays return early.
//   2. Single SKU 'tiktokgrowth-system' → create order, then background:
//      POST TIKTOKGROWTH_BASE_URL/api/tiktok/generate {order_token, inputs};
//      on success mark ready + email the token-gated deliverable link;
//      on failure mark failed (buyer retries from the success page).
//
// NOTE: only one SKU exists today (tiktokgrowth-system). The product lookup
// is still defensive: unknown SKUs abort before creating an order.

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const KNOWN_PRODUCTS = {
  "tiktokgrowth-system": "TikTok Growth System — 30-Day Playbook",
};

function randomToken(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function baseUrl(env) {
  return String(env.TIKTOKGROWTH_BASE_URL || "https://tiktokgrowth.mehyar.us").replace(/\/+$/, "");
}

function fromAddress(env) {
  // Until tiktokgrowth.mehyar.us is onboarded on both ESPs (standing rule),
  // send from the proven mehyar.us identity.
  return {
    from: env.TIKTOKGROWTH_FROM_EMAIL || "team@mehyar.us",
    fromName: "TikTok Growth System",
  };
}

function readIntake(meta) {
  let m = {};
  try {
    m = JSON.parse(meta || "{}");
  } catch {}
  const raw = (m && typeof m === "object" && m.inputs) || m || {};
  // Tight, checkout-safe intake (params are ≤2048 bytes JSON server-side).
  const niche = String(raw.niche || "").slice(0, 120).trim();
  const on_camera = ["comfortable", "getting-there", "prefer-off-camera"].includes(raw.on_camera)
    ? raw.on_camera
    : "getting-there";
  const hpw = Math.max(1, Math.min(40, parseInt(raw.hours_per_week, 10) || 5));
  const handle = String(raw.handle || "").slice(0, 80).trim();
  return { niche, on_camera, hours_per_week: hpw, handle };
}

export async function fulfillTiktokgrowth({ db, env, waitUntil, sendEmail }, payment) {
  if (!db || !payment || !payment.id) throw new Error("fulfillTiktokgrowth: bad args");

  const productId = payment.product_id;
  if (!KNOWN_PRODUCTS[productId]) {
    console.error("fulfillTiktokgrowth: unknown product", productId);
    return { ok: false, error: "unknown_product" };
  }
  const productName = KNOWN_PRODUCTS[productId];
  const intakeInputs = readIntake(payment.metadata_json);

  // ── idempotent order create (one row per payment) ──
  const existing = await db
    .prepare("SELECT id, access_token, status, product_id FROM tiktokgrowth_orders WHERE payment_id = ?")
    .bind(payment.id)
    .first();
  if (existing) {
    return { ok: true, replay: true, order_id: existing.id, status: existing.status };
  }

  // Token unification (Sprint30/HustleKit lesson): Stripe already baked
  // payment.access_token into the buyer's success URL at session creation.
  // Reuse it as the order token so ONE token works on the success page,
  // the deliverable, and the buyer email. Minting a fresh token here would
  // orphan the success-page link.
  const accessToken = payment.access_token || randomToken(32);
  const inputsJson = JSON.stringify({ inputs: intakeInputs });
  const ins = await db
    .prepare(
      "INSERT INTO tiktokgrowth_orders (payment_id, product_id, email, inputs_json, status, access_token) " +
        "VALUES (?, ?, ?, ?, 'paid', ?)"
    )
    .bind(payment.id, productId, payment.email, inputsJson, accessToken)
    .run();
  const orderId = ins.meta.last_row_id;

  // Defensive: if the payment row somehow lacked a token, point it at the
  // order token now so the backfill lookup (by access_token) keeps working.
  if (!payment.access_token) {
    await db
      .prepare("UPDATE billing_payments SET access_token=<redacted>")
      .bind(accessToken, payment.id)
      .run();
  }

  const { from, fromName } = fromAddress(env);

  // ── background generation, then email ──
  const run = async () => {
    try {
      const genResp = await fetch(`${baseUrl(env)}/api/tiktok/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_token: accessToken, inputs: intakeInputs }),
      });
      const genData = await genResp.json().catch(() => ({}));
      if (!genResp.ok || !genData.ok) {
        throw new Error("generate:" + String((genData && genData.error) || genResp.status));
      }
      // generate.js is async: HTTP 202 {status:"generating"} means the
      // playbook is still building in the background; 200 + manifest means
      // a replay of an already-ready order. Poll the order row until the
      // background generation writes the manifest (generate.js owns the
      // status/output_json writes — we must NOT mark ready here, or the
      // background UPDATE's WHERE status!='ready' guard drops the manifest.
      let manifest = genData.manifest || null;
      if (!manifest) {
        const deadline = Date.now() + 8 * 60 * 1000;
        for (;;) {
          await new Promise((r) => setTimeout(r, 10000));
          const orow = await db.prepare(
            "SELECT status, output_json FROM tiktokgrowth_orders WHERE id = ?"
          ).bind(orderId).first();
          if (orow && orow.status === "ready") {
            try { manifest = JSON.parse(orow.output_json || "null"); } catch {}
            break;
          }
          if (orow && orow.status === "failed") throw new Error("generate:background_failed");
          if (Date.now() >= deadline) throw new Error("generate:timeout");
        }
      }
      if (!manifest || typeof manifest !== "object") throw new Error("generate:empty_manifest");
      const deliverUrl = `${baseUrl(env)}/deliverable.html?token=${accessToken}`;
      const subject = `Your TikTok Growth System playbook is ready`;
      const text =
        `Thanks for your purchase!\n\n` +
        `Your ${productName} is ready — your personalized 30-day posting plan, 30 hook scripts, bio + CTA pack, and trend-jacking playbook:\n${deliverUrl}\n\n` +
        `Open it on your phone or laptop and hit "Download PDF" to keep a copy.\n\n` +
        `This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.\n\n-- ${fromName}`;
      const html =
        `<p>Thanks for your purchase!</p>` +
        `<p>Your <strong>${productName}</strong> is ready — your personalized 30-day posting plan, 30 hook scripts, bio + CTA pack, and trend-jacking playbook:</p>` +
        `<p><a href="${deliverUrl}" style="display:inline-block;background:#111827;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Open your playbook</a></p>` +
        `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${deliverUrl}">${deliverUrl}</a></p>` +
        `<p style="color:#6b7280;font-size:13px;">Open it on your phone or laptop and hit "Download PDF" to keep a copy. This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.</p>` +
        `<p>-- ${fromName}</p>`;
      const result = await sendEmail(env, { from, fromName, to: payment.email, replyTo: "info@mehyar.us", subject, text, html });
      if (!result.ok) console.error("fulfillTiktokgrowth deliverable email failed", productId, result.error);
    } catch (e) {
      console.error("fulfillTiktokgrowth background generate failed", productId, e && e.message);
      try {
        await db.prepare("UPDATE tiktokgrowth_orders SET status='failed' WHERE id=? AND status='paid'")
          .bind(orderId).run();
      } catch {}
      // No email on failure: the buyer lands on success.html?token= from
      // Stripe, which shows live status + a retry button that re-POSTs
      // /api/tiktok/generate with their token.
    }
  };

  if (typeof waitUntil === "function") waitUntil(run());
  else await run();

  return { ok: true, order_id: orderId, product_id: productId };
}

