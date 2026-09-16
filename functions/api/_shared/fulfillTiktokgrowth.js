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
//      (UNIQUE index idx_tiktokgrowth_orders_payment). Concurrent webhook
//      doubles lose the INSERT race and fall through to the resume path.
//   2. Resume: an existing order that is not fully done (status paid/failed,
//      or ready but email never sent) resumes generation/email instead of
//      returning early. Only ready+emailed replays return immediately.
//   3. Email idempotency: the deliverable email sends at most once per order.
//      email_sent_at is read before sending and written only after the
//      provider accepts the message; sequential replays see it and skip.
//   4. Single SKU 'tiktokgrowth-system' → create order, then:
//      POST TIKTOKGROWTH_BASE_URL/api/tiktok/drive (one bounded request
//      running phases hooks→bio→trends→plan→assemble); on success mark
//      ready + email the token-gated link; on failure mark failed (buyer
//      retries from the success page).
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

  // ── idempotent order create (one row per payment) + resume ──
  let orderId;
  let accessToken;
  const existing = await db
    .prepare("SELECT id, access_token, status, product_id, email_sent_at FROM tiktokgrowth_orders WHERE payment_id = ?")
    .bind(payment.id)
    .first();
  if (existing) {
    // Fully done (ready + emailed): true replay, nothing to do.
    if (existing.status === "ready" && existing.email_sent_at) {
      return { ok: true, replay: true, order_id: existing.id, status: existing.status };
    }
    // Incomplete (paid/failed, or ready but the email never went out):
    // resume instead of returning early.
    orderId = existing.id;
    accessToken = existing.access_token;
    if (existing.status === "failed") {
      await db.prepare("UPDATE tiktokgrowth_orders SET status='paid', failure_reason=NULL WHERE id = ?")
        .bind(orderId).run();
    }
  } else {
    // Token unification (Sprint30/HustleKit lesson): Stripe already baked
    // payment.access_token into the buyer's success URL at session creation.
    // Reuse it as the order token so ONE token works on the success page,
    // the deliverable, and the buyer email. Minting a fresh token here would
    // orphan the success-page link.
    accessToken = payment.access_token || randomToken(32);
    const inputsJson = JSON.stringify({ inputs: intakeInputs });
    try {
      const ins = await db
        .prepare(
          "INSERT INTO tiktokgrowth_orders (payment_id, product_id, email, inputs_json, status, access_token) " +
            "VALUES (?, ?, ?, ?, 'paid', ?)"
        )
        .bind(payment.id, productId, payment.email, inputsJson, accessToken)
        .run();
      orderId = ins.meta.last_row_id;
    } catch (e) {
      // Lost a concurrent webhook race: the other delivery created the row
      // (UNIQUE idx_tiktokgrowth_orders_payment). Resume on their order.
      const raced = await db
        .prepare("SELECT id, access_token FROM tiktokgrowth_orders WHERE payment_id = ?")
        .bind(payment.id)
        .first();
      if (!raced) throw e;
      orderId = raced.id;
      accessToken = raced.access_token;
    }

    // Defensive: if the payment row somehow lacked a token, point it at the
    // order token now so the backfill lookup (by access_token) keeps working.
    if (!payment.access_token) {
      await db
        .prepare("UPDATE billing_payments SET access_token=? WHERE id=?")
        .bind(accessToken, payment.id)
        .run();
    }
  }

  const { from, fromName } = fromAddress(env);

  // ── generation via PWA drive endpoint, then idempotent email ──
  // /api/tiktok/drive runs all 5 phases (hooks→bio→trends→plan→assemble)
  // sequentially in ONE request. Each phase is a bounded AI call; the
  // request survives because it's I/O-bound. Single request = no fragile
  // multi-fetch waitUntil orchestration. Drive resumes persisted phases,
  // so re-running it on a partial order is safe.
  const run = async () => {
    try {
      // Skip generation when a previous attempt already reached ready
      // (e.g. resume where only the email was missing).
      const st0 = await db.prepare("SELECT status FROM tiktokgrowth_orders WHERE id = ?").bind(orderId).first();
      if (!st0 || st0.status !== "ready") {
        const r = await fetch(`${baseUrl(env)}/api/tiktok/drive`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            // Cloudflare bot protection 403s non-browser UAs on *.mehyar.us
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          },
          body: JSON.stringify({ order_token: accessToken }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.ok) {
          throw new Error("drive:" + String((data && (data.detail || data.error)) || r.status));
        }
        if (data.status !== "ready") throw new Error("drive:not_ready");
      }
      // Read the manifest back for the email (assemble wrote it).
      const orow = await db.prepare(
        "SELECT output_json FROM tiktokgrowth_orders WHERE id = ?"
      ).bind(orderId).first();
      let manifest = null;
      try { manifest = JSON.parse((orow && orow.output_json) || "null"); } catch {}
      if (!manifest || typeof manifest !== "object" || manifest.version !== 1) {
        throw new Error("generate:empty_manifest");
      }
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
      // Idempotent email: send at most once per order. The marker is read
      // before sending and written only after the provider accepts the
      // message, so a sequential replay (or a resume after a failed send)
      // sees email_sent_at and skips. The conditional UPDATE also makes
      // concurrent doubles safe: only one writer wins the NULL slot.
      const sent0 = await db.prepare("SELECT email_sent_at FROM tiktokgrowth_orders WHERE id = ?").bind(orderId).first();
      if (!sent0 || !sent0.email_sent_at) {
        const result = await sendEmail(env, { from, fromName, to: payment.email, replyTo: "info@mehyar.us", subject, text, html });
        if (result.ok) {
          await db.prepare("UPDATE tiktokgrowth_orders SET email_sent_at = " + nowSql + " WHERE id = ? AND email_sent_at IS NULL")
            .bind(orderId).run();
        } else {
          console.error("fulfillTiktokgrowth deliverable email failed", productId, result.error);
        }
      }
    } catch (e) {
      console.error("fulfillTiktokgrowth background generate failed", productId, e && e.message);
      try {
        await db.prepare("UPDATE tiktokgrowth_orders SET status='failed', failure_reason=? WHERE id=? AND status='paid'")
          .bind(String((e && e.message) || "unknown").slice(0, 500), orderId).run();
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
