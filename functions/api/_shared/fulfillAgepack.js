// functions/api/_shared/fulfillAgepack.js
// Standalone ES module: Stripe fulfillment for the BabyPeek Age Progression
// Pack upsell (product baby-peek-agepack, $27 one-time).
//
// Shared by two charge paths so fulfillment is identical either way:
//   1. /api/pay/upsell-charge — the one-click off-session charge. No Stripe
//      event fires for a direct PaymentIntent, so the endpoint runs this
//      module inline after the charge succeeds.
//   2. /api/pay/webhook checkout.session.completed — the fallback hosted
//      checkout session (used when the card can't be charged off-session),
//      via the product's fulfillment='unlock_link' hook.
//
// Contract: fulfillAgepack({ db, env, sendEmail }, payment)
//   payment — billing_payments row {id, product_id, email, amount_cents,
//             access_token, metadata_json} with metadata_json.gid = the
//             BabyPeek generation id.
//
// Behavior:
//   1. Idempotent: exactly one unlock_receipts row per payment.id. Replays
//      return early (no duplicate receipt emails, no duplicate generation
//      triggers — BabyPeek's /api/agepack-fulfill is itself idempotent).
//   2. Triggers BabyPeek generation server-to-server
//      (POST baby.mehyar.us/api/agepack-fulfill {gid, token}); the token is
//      the agepack payment's access_token, verified by BabyPeek against the
//      central ledger before it generates anything.
//   3. Sends the TRANSACTIONAL receipt email (not marketing): what was
//      bought, the unlock link, sender identified. No list writes.
//   4. Records the buyer in the CRM (subscribers_global + buyers_rollup +
//      babypeek_subscribers, converted=1) — the permanent "every paid buyer
//      lands in the CRM" habit. Suppression-safe: never re-activates an
//      opted_out row, never sends anything.

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function readMeta(payment) {
  try {
    const m = JSON.parse(payment.metadata_json || "{}");
    return m && typeof m === "object" ? m : {};
  } catch {
    return {};
  }
}

async function ensureReceiptsTable(db) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS unlock_receipts (" +
      "payment_id INTEGER PRIMARY KEY, " +
      "product_id TEXT NOT NULL, " +
      "email TEXT NOT NULL, " +
      "sent_at TEXT NOT NULL DEFAULT (" + nowSql + "))"
  ).run();
}

// Buyer CRM hardening (mirrors the shared webhook's permanent habit).
// Every paid buyer lands in the brand CRM with converted=1. Idempotent,
// suppression-safe.
async function recordBuyerCRM(db, { email, brand, amountCents }) {
  const em = String(email || "").toLowerCase().trim();
  const br = String(brand || "babypeek").toLowerCase().trim() || "babypeek";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return;
  try {
    await db.prepare(
      "INSERT INTO subscribers_global (email, brand, status, converted, " +
      "first_order_at, last_order_at, total_spent_cents, updated_at) " +
      "VALUES (?, ?, 'active', 1, " + nowSql + ", " + nowSql + ", ?, " + nowSql + ") " +
      "ON CONFLICT(email, brand) DO UPDATE SET " +
      "status=CASE WHEN subscribers_global.status='opted_out' THEN 'opted_out' ELSE 'active' END, " +
      "converted=1, last_order_at=" + nowSql + ", " +
      "total_spent_cents=subscribers_global.total_spent_cents+excluded.total_spent_cents, " +
      "updated_at=" + nowSql
    ).bind(em, br, Number(amountCents) || 0).run();
  } catch (e) {
    console.error("fulfillAgepack subscribers_global failed", e && e.message);
  }
  try {
    await db.prepare(
      "INSERT INTO buyers_rollup (email, brand, total_cents) " +
      "VALUES (?, ?, ?) " +
      "ON CONFLICT(email, brand) DO UPDATE SET " +
      "last_seen_at=" + nowSql + ", " +
      "orders_count=buyers_rollup.orders_count+1, " +
      "total_cents=buyers_rollup.total_cents+excluded.total_cents"
    ).bind(em, br, Number(amountCents) || 0).run();
  } catch (e) {
    console.error("fulfillAgepack buyers_rollup failed", e && e.message);
  }
  try {
    await db.prepare(
      "INSERT INTO babypeek_subscribers (email, status, brand, source, converted) " +
      "VALUES (?, 'purchased', ?, 'purchase', 1) " +
      "ON CONFLICT(email) DO UPDATE SET converted=1"
    ).bind(em, br).run();
  } catch (e) {
    // Table missing or different shape — the global stores already have it.
  }
}

export async function fulfillAgepack({ db, env, sendEmail }, payment) {
  if (!db || !payment || !payment.id) throw new Error("fulfillAgepack: bad args");
  if (payment.product_id !== "baby-peek-agepack")
    throw new Error("fulfillAgepack: wrong product " + payment.product_id);
  if (!payment.access_token) throw new Error("fulfillAgepack: payment has no access_token");
  if (!payment.email) throw new Error("fulfillAgepack: payment has no email");
  if (typeof sendEmail !== "function") throw new Error("fulfillAgepack: sendEmail not injected");

  await ensureReceiptsTable(db);
  const claimed = await db.prepare(
    "INSERT OR IGNORE INTO unlock_receipts (payment_id, product_id, email) VALUES (?, ?, ?)"
  ).bind(payment.id, payment.product_id, payment.email).run();
  if (!claimed.meta || claimed.meta.changes === 0) {
    return { ok: true, replay: true }; // already fulfilled for this payment
  }

  const product = await db.prepare(
    "SELECT id, name, brand, success_url_template FROM billing_products WHERE id = ?"
  ).bind(payment.product_id).first();
  if (!product) throw new Error("fulfillAgepack: unknown product " + payment.product_id);

  const token = payment.access_token;
  const unlockUrl = String(product.success_url_template || "")
    .replace("{access_token}", token);

  // Trigger BabyPeek generation server-to-server. BabyPeek verifies the
  // token against the central ledger and atomically claims the generation,
  // so replays and double-triggers are safe.
  const gid = String(readMeta(payment).gid || "");
  if (/^[0-9a-f]{32}$/.test(gid)) {
    try {
      const r = await fetch("https://baby.mehyar.us/api/agepack-fulfill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gid, token }),
        signal: AbortSignal.timeout(20000),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        console.error("fulfillAgepack: babypeek agepack-fulfill failed", r.status, data && data.error);
      }
    } catch (e) {
      console.error("fulfillAgepack: babypeek agepack-fulfill threw", e && e.message);
    }
  } else {
    console.error("fulfillAgepack: missing/invalid gid in payment metadata", payment.id);
  }

  // Transactional receipt only: what was bought + unlock link + sender.
  // No marketing content, no list writes.
  const subject = "Your BabyPeek Age Progression Pack is ready 🎬";
  const text =
    "Thanks for your purchase!\n\n" +
    "Your Age Progression Pack is ready: 4 more AI portraits of your baby — " +
    "at ages 1, 3, 10 and 20, dreamed up from the same photos.\n\n" +
    "Open your portraits here:\n" + unlockUrl + "\n\n" +
    "Just for fun — these are AI imaginings, not predictions.\n\n" +
    "This link is personal to you — keep it somewhere safe. If it ever stops " +
    "working, just reply to this email and we'll sort it out.\n\n" +
    "-- BabyPeek";
  const html =
    "<p>Thanks for your purchase!</p>" +
    "<h2>Your Age Progression Pack is ready 🎬</h2>" +
    "<p>4 more AI portraits of your baby — at <strong>ages 1, 3, 10 and 20</strong>, dreamed up from the same photos.</p>" +
    '<p><a href="' + esc(unlockUrl) + '" style="display:inline-block;background:#111827;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Open your portraits</a></p>' +
    '<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="' + esc(unlockUrl) + '">' + esc(unlockUrl) + "</a></p>" +
    '<p style="color:#6b7280;font-size:13px;">Just for fun — these are AI imaginings, not predictions.</p>' +
    '<p style="color:#6b7280;font-size:13px;">This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we\'ll sort it out.</p>' +
    "<p>-- BabyPeek</p>";

  const result = await sendEmail(env, {
    from: "team@mehyar.us",
    fromName: "BabyPeek",
    to: payment.email,
    replyTo: "info@mehyar.us",
    subject,
    text,
    html,
  });
  if (!result.ok) {
    console.error("fulfillAgepack email failed", payment.product_id, result.error);
    return { ok: false, error: result.error };
  }

  // Buyer CRM (paid buyer, every time — suppression-safe).
  try {
    await recordBuyerCRM(db, {
      email: payment.email,
      brand: product.brand || "babypeek",
      amountCents: payment.amount_cents,
    });
  } catch (e) {
    console.error("fulfillAgepack CRM failed", e && e.message);
  }

  return { ok: true, email_sent: true, unlock_url: unlockUrl };
}
