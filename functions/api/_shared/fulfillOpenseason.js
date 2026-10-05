// functions/api/_shared/fulfillOpenseason.js
// Fulfillment hook for OpenSeason (fulfillment='openseason').
// SKU: openseason-state-pack ($12 one-time → the full season pack for one
// verified state: every season, every deadline, bag limits, license/tag
// application dates in plain English, printable pack + deadline reminders).
//
// Contract: fulfillOpenseason({ db, env, waitUntil }, payment, sess)
//   payment — billing_payments row (already marked paid by the webhook).
//           metadata_json = checkout params FLAT: { state } (the buyer's
//           chosen state, written by POST /api/pay/checkout).
//
// Behavior:
//   1. Idempotent: exactly one openseason_orders row per payment.id
//      (UNIQUE payment_id). Replays return {replay:true} and do nothing.
//   2. Creates the order, reusing billing_payments.access_token as the order
//      token (token unification — the Stripe success_url already carries it,
//      and openseason.mehyar.us/api/pack gates on openseason_orders
//      access_token). Generating a new token here would race the redirect.
//   3. Registers the buyer in openseason_subscribers (tags
//      'openseason,buyer') unless on openseason_suppression — this feeds the
//      deadline-reminder scheduler. The fulfillment receipt is transactional
//      and goes regardless of suppression; the drip/reminder mailers check
//      suppression themselves.
//   4. Emails the buyer: the personal pack link (openseason.mehyar.us/
//      pack.html?token=…) plus a one-click unsubscribe (openseason_unsub_tokens).
//   5. Unknown/missing state or missing pack data → order status
//      'needs_state' / 'failed', NO pack email; the buyer's success page
//      polls /api/pay/status and shows support contact. A plain fallback
//      email asks the buyer to reply with their state.
// Standing order: NO external email other than the buyer's own receipt /
// deliverable. No campaigns, no drips from here. No refund features,
// buttons, APIs, or tests anywhere in this flow.

import { sendCloudflareEmail } from "./cloudflareEmail.js";

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const PACK_BASE = "https://openseason.mehyar.us";

const STATE_NAMES = {
  AL: "Alabama", GA: "Georgia", MI: "Michigan", MN: "Minnesota",
  NC: "North Carolina", NY: "New York", OH: "Ohio", PA: "Pennsylvania",
  TN: "Tennessee", TX: "Texas", VA: "Virginia", WI: "Wisconsin",
};

function randomToken(bytes = 16) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function fromAddress(env) {
  // Until openseason.mehyar.us is onboarded on both ESPs (standing rule),
  // send from the proven mehyar.us identity.
  return { from: env.OPENSEASON_FROM_EMAIL || "team@mehyar.us", fromName: "OpenSeason" };
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[m]));
}

// One-click unsubscribe token for the buyer (per-product suppression).
async function unsubUrl(db, email) {
  try {
    const token = randomToken();
    await db.prepare(
      "INSERT INTO openseason_unsub_tokens (token, email) VALUES (?, ?)"
    ).bind(token, String(email).toLowerCase()).run();
    return `${PACK_BASE}/api/unsubscribe?token=${token}`;
  } catch {
    return `${PACK_BASE}/api/unsubscribe`;
  }
}

async function suppressed(db, email) {
  try {
    const row = await db
      .prepare("SELECT email FROM openseason_suppression WHERE email = ?")
      .bind(String(email).toLowerCase()).first();
    return !!row;
  } catch { return false; }
}

async function emailDeliverable(env, payment, stateName, packUrl, unsub) {
  const { from, fromName } = fromAddress(env);
  const subject = `Your ${stateName} season pack is ready`;
  const text =
    `Thanks for your purchase!\n\n` +
    `Your ${stateName} full season pack is ready — every season, every deadline,\n` +
    `bag limits and license/tag application dates in plain English:\n${packUrl}\n\n` +
    `Deadline reminders: we'll email you before every tag-application deadline\n` +
    `all season, so you never miss one.\n\n` +
    `This link is personal to you — keep it somewhere safe. If it ever stops\n` +
    `working, just reply to this email and we'll sort it out.\n\n` +
    `Unsubscribe (one click, instant): ${unsub}\n\n` +
    `-- OpenSeason\n` +
    `Dates are compiled from official state wildlife agencies; always confirm\n` +
    `with your state's current regulations before hunting.`;
  const html =
    `<p>Thanks for your purchase!</p>` +
    `<p>Your <strong>${esc(stateName)} full season pack</strong> is ready — every season, every deadline, bag limits and license/tag application dates in plain English.</p>` +
    `<p><a href="${esc(packUrl)}" style="display:inline-block;background:#166534;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Open my season pack</a></p>` +
    `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${esc(packUrl)}">${esc(packUrl)}</a></p>` +
    `<p style="color:#6b7280;font-size:13px;">Deadline reminders: we'll email you before every tag-application deadline all season, so you never miss one.</p>` +
    `<p style="color:#6b7280;font-size:13px;">This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.</p>` +
    `<p style="color:#6b7280;font-size:13px;"><a href="${esc(unsub)}">Unsubscribe</a> — one click, instant. Dates are compiled from official state wildlife agencies; always confirm with your state's current regulations before hunting.</p>` +
    `<p>-- OpenSeason</p>`;
  return sendCloudflareEmail(env, {
    from, fromName, to: payment.email, replyTo: "info@mehyar.us", subject, text, html,
  });
}

async function emailNeedsState(env, payment) {
  const { from, fromName } = fromAddress(env);
  const subject = `One quick step to get your OpenSeason pack`;
  const text =
    `Thanks for your purchase!\n\n` +
    `We couldn't tell which state's pack you wanted, so your pack link isn't\n` +
    `ready yet. Just reply to this email with your state (e.g. "Wisconsin")\n` +
    `and we'll send your pack link right over.\n\n-- OpenSeason`;
  return sendCloudflareEmail(env, {
    from, fromName, to: payment.email, replyTo: "info@mehyar.us", subject, text,
    html: `<p>Thanks for your purchase!</p><p>We couldn't tell which state's pack you wanted, so your pack link isn't ready yet. Just <strong>reply to this email with your state</strong> (e.g. "Wisconsin") and we'll send your pack link right over.</p><p>-- OpenSeason</p>`,
  });
}

export async function fulfillOpenseason({ db, env, waitUntil }, payment, sess) {
  if (!db || !payment || !payment.id) throw new Error("fulfillOpenseason: bad args");

  // ── idempotent order create (one row per payment) ──
  const existing = await db
    .prepare("SELECT id, access_token, status FROM openseason_orders WHERE payment_id = ?")
    .bind(payment.id)
    .first();
  if (existing) {
    return { ok: true, replay: true, order_id: existing.id, status: existing.status };
  }

  let meta = {};
  try { meta = JSON.parse(payment.metadata_json || "{}"); } catch {}
  const state = String((meta && meta.state) || "").toUpperCase().trim();
  const stateName = STATE_NAMES[state] || null;

  const accessToken = String(payment.access_token || "");
  if (accessToken.length < 16) throw new Error("fulfillOpenseason: payment has no access_token");

  // Pack data must exist server-side (seeded by the verified data pipeline).
  const packRow = stateName
    ? await db.prepare("SELECT state FROM openseason_state_packs WHERE state = ?").bind(state).first().catch(() => null)
    : null;

  if (!stateName || !packRow) {
    // Can't deliver a pack yet — record, notify minimally, no pack link.
    try {
      const ins = await db.prepare(
        `INSERT INTO openseason_orders (payment_id, product_id, email, state, status, access_token, created_at) ` +
        `VALUES (?, ?, ?, ?, 'needs_state', ?, ${nowSql})`
      ).bind(payment.id, payment.product_id, payment.email, state || "", accessToken).run();
      const result = await emailNeedsState(env, payment);
      return { ok: true, order_id: ins.meta.last_row_id, mode: "needs_state", email_ok: !!result.ok };
    } catch (e) {
      throw new Error("fulfillOpenseason needs_state: " + (e && e.message));
    }
  }

  const ins = await db
    .prepare(
      `INSERT INTO openseason_orders (payment_id, product_id, email, state, status, access_token, created_at) ` +
      `VALUES (?, ?, ?, ?, 'paid', ?, ${nowSql})`
    )
    .bind(payment.id, payment.product_id, payment.email, state, accessToken).run();
  const orderId = ins.meta.last_row_id;

  // Mark the order ready immediately — the pack is already seeded; there is
  // nothing to generate. Delivery is pull-based (pack.html?token=).
  await db.prepare(
    `UPDATE openseason_orders SET status='ready', ready_at=${nowSql} WHERE id=? AND status='paid'`
  ).bind(orderId).run().catch(() => {});

  // Register the buyer for deadline reminders (suppression-aware).
  const email = String(payment.email || "").toLowerCase();
  if (email && !(await suppressed(db, email))) {
    try {
      await db.prepare(
        "INSERT INTO openseason_subscribers (email, state, source, brand, tags) VALUES (?, ?, 'purchase', 'openseason', 'openseason,buyer') " +
          "ON CONFLICT(email) DO UPDATE SET state=excluded.state, tags='openseason,buyer'"
      ).bind(email, state).run();
    } catch (e) { console.error("fulfillOpenseason subscriber register failed", e && e.message); }
  }

  const packUrl = `${PACK_BASE}/pack.html?token=${accessToken}`;
  const unsub = await unsubUrl(db, email);
  const result = await emailDeliverable(env, payment, stateName, packUrl, unsub);
  if (!result.ok) console.error("fulfillOpenseason deliverable email failed", result.error);

  return { ok: true, order_id: orderId, mode: "pack", state, email_ok: !!result.ok };
}
