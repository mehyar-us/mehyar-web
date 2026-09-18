// functions/api/_shared/fulfillUnlockLink.js
// Standalone ES module: Stripe fulfillment for fulfillment='unlock_link' products.
//
// Used by token-unlock products with no generated file to email (BabyPeek,
// RoastMe): the buyer unlocks on the product site with their per-purchase
// access_token. This hook sends the transactional receipt email carrying the
// unlock link. (Before this hook, baby-peek and roast-card ran on
// fulfillment='none' — buyers got NO email at all.)
//
// Contract: fulfillUnlockLink({ db, env, sendEmail }, payment)
//   db        — D1 binding (mehyar_leads_prod; has billing_products, billing_payments)
//   env       — worker env (unused)
//   sendEmail — injected mailer: sendEmail(env, {from, fromName, to, replyTo,
//               subject, text, html}) -> {ok, ...}. NEVER sends in local dev:
//               the caller injects a stub. In prod, the shared webhook injects
//               a wrapper around sendCloudflareEmail.
//   payment   — billing_payments row {id, product_id, email, access_token,
//               metadata_json}
//
// Behavior:
//   1. Idempotent: exactly one unlock_receipts row per payment.id. Replays
//      return early (no duplicate receipt emails).
//   2. Unlock URL = the product's billing_products.success_url_template with
//      {access_token} substituted — the same URL Stripe redirects to, so it
//      is guaranteed to be a working unlock path.
//   3. BabyPeek extra: the portrait is redeemed per-generation, so this hook
//      also performs the redeem server-to-server (POST baby.mehyar.us/api/redeem
//      {id: gid, token}) using the gid stored in the payment metadata. That
//      sets generations.access_token immediately, and the receipt email then
//      carries a direct portrait-download link that works on ANY device —
//      not just the browser that still holds the gid in localStorage.
//   4. Transactional receipt only: no marketing content, no list writes.

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const BRAND_FROM_NAME = {
  babypeek: "BabyPeek",
  RoastMe: "RoastMe",
};

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function ensureTable(db) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS unlock_receipts (" +
      "payment_id INTEGER PRIMARY KEY, " +
      "product_id TEXT NOT NULL, " +
      "email TEXT NOT NULL, " +
      "sent_at TEXT NOT NULL DEFAULT (" + nowSql + "))"
  ).run();
}

function readMeta(payment) {
  try {
    const m = JSON.parse(payment.metadata_json || "{}");
    return m && typeof m === "object" ? m : {};
  } catch {
    return {};
  }
}

export async function fulfillUnlockLink({ db, env, sendEmail }, payment) {
  if (!db || !payment || !payment.id) throw new Error("fulfillUnlockLink: bad args");
  if (!payment.access_token) throw new Error("fulfillUnlockLink: payment has no access_token");
  if (!payment.email) throw new Error("fulfillUnlockLink: payment has no email");
  if (typeof sendEmail !== "function") throw new Error("fulfillUnlockLink: sendEmail not injected");

  await ensureTable(db);
  const claimed = await db.prepare(
    "INSERT OR IGNORE INTO unlock_receipts (payment_id, product_id, email) VALUES (?, ?, ?)"
  ).bind(payment.id, payment.product_id, payment.email).run();
  if (!claimed.meta || claimed.meta.changes === 0) {
    return { ok: true, replay: true }; // receipt already sent for this payment
  }

  const product = await db.prepare(
    "SELECT id, name, brand, success_url_template FROM billing_products WHERE id = ?"
  ).bind(payment.product_id).first();
  if (!product) throw new Error("fulfillUnlockLink: unknown product " + payment.product_id);

  const token = payment.access_token;
  const unlockUrl = String(product.success_url_template || "")
    .replace("{access_token}", token);
  const brandName = BRAND_FROM_NAME[product.brand] || product.brand || "MehyarSoft";

  // BabyPeek: redeem server-to-server so the portrait link works on any device.
  let portraitUrl = null;
  if (payment.product_id === "baby-peek") {
    const gid = String(readMeta(payment).gid || "");
    if (/^[0-9a-f]{32}$/.test(gid)) {
      try {
        const r = await fetch("https://baby.mehyar.us/api/redeem", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: gid, token }),
        });
        const data = await r.json().catch(() => ({}));
        if (r.ok && data && data.ok) {
          portraitUrl =
            "https://baby.mehyar.us/api/full/" + gid +
            "?token=" + encodeURIComponent(token) + "&download=1";
        } else {
          console.error("fulfillUnlockLink: babypeek redeem failed", r.status, data && data.error);
        }
      } catch (e) {
        console.error("fulfillUnlockLink: babypeek redeem threw", e && e.message);
      }
    }
  }

  const isBaby = payment.product_id === "baby-peek";
  const subject = isBaby ? "Your BabyPeek portrait is ready" : "Your RoastMe roast is ready";
  const headline = isBaby ? "Your future-baby portrait is ready!" : "Your roast is ready — brace yourself.";

  const textLines = [
    "Thanks for your purchase!",
    "",
    headline,
    "",
    "Open your result here:",
    unlockUrl,
  ];
  if (portraitUrl) {
    textLines.push("", "Or download the full-resolution portrait directly:", portraitUrl);
  }
  textLines.push(
    "",
    "This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.",
    "",
    "-- " + brandName
  );

  const html =
    "<p>Thanks for your purchase!</p>" +
    "<h2>" + esc(headline) + "</h2>" +
    '<p><a href="' + esc(unlockUrl) + '" style="display:inline-block;background:#111827;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Open your result</a></p>' +
    '<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="' + esc(unlockUrl) + '">' + esc(unlockUrl) + "</a></p>" +
    (portraitUrl
      ? '<p><a href="' + esc(portraitUrl) + '" style="color:#111827;font-weight:bold;">Download the full-resolution portrait</a></p>'
      : "") +
    '<p style="color:#6b7280;font-size:13px;">This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we\'ll sort it out.</p>' +
    "<p>-- " + esc(brandName) + "</p>";

  const result = await sendEmail(env, {
    from: "team@mehyar.us",
    fromName: brandName,
    to: payment.email,
    replyTo: "info@mehyar.us",
    subject,
    text: textLines.join("\n"),
    html,
  });
  if (!result.ok) {
    console.error("fulfillUnlockLink email failed", payment.product_id, result.error);
    // Keep the receipt row: a failed send should not silently re-send on
    // replay, but the failure is logged for the fulfillment sweep to retry.
    return { ok: false, error: result.error };
  }
  return { ok: true, email_sent: true, unlock_url: unlockUrl };
}
