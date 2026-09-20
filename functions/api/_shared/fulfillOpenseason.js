// functions/api/_shared/fulfillOpenseason.js
// Standalone ES module: Stripe fulfillment for fulfillment='openseason' products.
// Called from the shared /api/pay/webhook in mehyar-web.
//
// Contract: fulfillOpenseason({ db, env, waitUntil, sendEmail }, payment)
//   payment — billing_payments row {id, product_id, email, metadata_json}
//             metadata_json is body.params FLAT (see checkout.js); the PWA
//             sends { state: "PA" }.
//
// Behavior:
//   1. Idempotent: exactly one openseason_orders row per payment.id
//      (UNIQUE on payment_id). Replays return {replay:true}.
//   2. Reads the purchased state from params (flat or {inputs:{}} wrapped).
//   3. Mints an order access_token; unifies billing_payments.access_token so
//      the Stripe success_url token gates every OpenSeason surface.
//   4. Data is deterministic (verified state packs in openseason_state_packs,
//      seeded by the product repo) — no generation step; the order is 'ready'
//      immediately and the buyer is emailed their pack link at once.
//   5. Mints a one-click unsubscribe token so every product email carries it.

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function randomToken(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function baseUrl(env) {
  return String(env.OPENSEASON_BASE_URL || "https://openseason.mehyar.us").replace(/\/+$/, "");
}

export async function fulfillOpenseason({ db, env, sendEmail }, payment) {
  if (!db || !payment || !payment.id) throw new Error("fulfillOpenseason: bad args");

  let meta = {};
  try { meta = JSON.parse(payment.metadata_json || "{}"); } catch {}
  const params = (meta && typeof meta === "object" && meta.inputs) || meta || {};
  const state = String(params.state || "").trim().toUpperCase().slice(0, 2);
  if (!/^[A-Z]{2}$/.test(state)) {
    console.error("fulfillOpenseason: missing/invalid state param", payment.id);
    return { ok: false, error: "missing_state" };
  }

  // ── idempotent order create ──
  const existing = await db
    .prepare("SELECT id, access_token, status FROM openseason_orders WHERE payment_id = ?")
    .bind(payment.id).first();
  if (existing) {
    return { ok: true, replay: true, order_id: existing.id, status: existing.status };
  }

  const accessToken = randomToken(32);
  const ins = await db.prepare(
    "INSERT INTO openseason_orders (payment_id, product_id, email, state, status, access_token) " +
      "VALUES (?, ?, ?, ?, 'ready', ?)"
  ).bind(payment.id, payment.product_id, payment.email, state, accessToken).run();
  const orderId = ins.meta.last_row_id;

  // Token unification: one token for Stripe success URL, pack page, everything.
  await db.prepare("UPDATE billing_payments SET access_token = ? WHERE id = ?")
    .bind(accessToken, payment.id).run();

  // One-click unsubscribe token for every product email.
  const unsubToken = randomToken(24);
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS openseason_unsub_tokens (" +
      "token TEXT PRIMARY KEY, email TEXT NOT NULL, " +
      "created_at TEXT NOT NULL DEFAULT (datetime('now')))"
  ).run().catch(() => {});
  await db.prepare(
    "INSERT OR REPLACE INTO openseason_unsub_tokens (token, email) VALUES (?, ?)"
  ).bind(unsubToken, payment.email).run().catch(() => {});
  const unsubUrl = baseUrl(env) + "/api/unsubscribe?token=" + unsubToken;

  // State name for the email, from the seeded pack row (best effort).
  let stateName = state, seasonYear = "";
  try {
    const packRow = await db.prepare(
      "SELECT state_name, season_year FROM openseason_state_packs WHERE state = ?"
    ).bind(state).first();
    if (packRow) { stateName = packRow.state_name; seasonYear = packRow.season_year; }
  } catch {}

  const packUrl = baseUrl(env) + "/pack.html?token=" + accessToken;
  const subject = `Your ${stateName} ${seasonYear} season pack is ready 🦌`;
  const text =
    `Thanks for your purchase!\n\n` +
    `Your OpenSeason full season pack for ${stateName} (${seasonYear}) is ready:\n${packUrl}\n\n` +
    `Inside: every season opener and closer, every license/tag deadline, bag limits ` +
    `in plain English, a printable one-page pack, and email reminders before every ` +
    `deadline all season.\n\n` +
    `Receipt: OpenSeason Full Season Pack — ${stateName} — $12.00 (one-time).\n\n` +
    `This link is personal to you — keep it somewhere safe.\n\n` +
    `Don't want our emails anymore? One click and you're out, no questions asked:\n${unsubUrl}\n\n` +
    `-- OpenSeason by MehyarSoft`;
  const html =
    `<p>Thanks for your purchase!</p>` +
    `<p>Your <strong>OpenSeason full season pack for ${stateName} (${seasonYear})</strong> is ready:</p>` +
    `<p><a href="${packUrl}" style="display:inline-block;background:#f2a93b;color:#23160a;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Open my season pack</a></p>` +
    `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${packUrl}">${packUrl}</a></p>` +
    `<p>Inside: every season opener and closer, every license/tag deadline, bag limits in plain English, a printable one-page pack, and email reminders before every deadline all season.</p>` +
    `<p style="color:#6b7280;font-size:13px;">Receipt: OpenSeason Full Season Pack — ${stateName} — $12.00 (one-time). This link is personal to you — keep it somewhere safe.</p>` +
    `<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">` +
    `<p style="color:#9ca3af;font-size:12px;">Don't want our emails anymore? <a href="${unsubUrl}">Unsubscribe in one click</a> — no questions asked.</p>` +
    `<p>-- OpenSeason by MehyarSoft</p>`;

  const result = await sendEmail(env, {
    from: env.OPENSEASON_FROM_EMAIL || "team@mehyar.us",
    fromName: "OpenSeason",
    to: payment.email,
    replyTo: "info@mehyar.us",
    subject, text, html,
  });
  if (!result.ok) console.error("fulfillOpenseason email failed", payment.id, result.error);

  return { ok: true, order_id: orderId, state, email_ok: !!result.ok };
}
