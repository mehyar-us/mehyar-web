// functions/api/_shared/fulfillClipnote.js
// Standalone ES module: Stripe fulfillment for fulfillment='clipnote' products
// (Clipnote — clipnote.mehyar.us; release notes → 60s narrated launch video).
// Called from the shared /api/pay/webhook in mehyar-web.
//
// Contract: fulfillClipnote({ db, env, waitUntil, sendEmail }, payment)
//   db        — D1 binding (mehyar_leads_prod; has clipnote_orders/drafts/credits)
//   env       — worker env (CLIPNOTE_BASE_URL optional)
//   waitUntil — Pages Functions waitUntil (optional)
//   sendEmail — injected mailer; prod injects sendCloudflareEmail wrapper.
//   payment   — billing_payments row {id, product_id, email, metadata_json,
//               access_token}. metadata_json is FLAT body.params from checkout:
//               { draft_token }.
//
// Behavior:
//   - clipnote-video ($29 one-off): create ONE clipnote_orders row per
//     payment.id (UNIQUE idx_clipnote_orders_payment), copying the approved
//     script + notes + screenshots from clipnote_drafts (by draft_token),
//     status 'queued' for the Clipnote render studio. Email the buyer their
//     watch link ("in the studio").
//   - clipnote-plan ($19/mo subscription): grant 4 credits to the buyer's
//     email in clipnote_credits. Idempotent: a sentinel clipnote_orders row
//     (status 'credits') is keyed on payment.id via the same UNIQUE index,
//     so replays return early and never double-grant.
//   - Token unification: the order's access_token IS payment.access_token.

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function baseUrl(env) {
  return String(env.CLIPNOTE_BASE_URL || "https://clipnote.mehyar.us").replace(/\/+$/, "");
}

// Scoped-token mail fallback (rot525 Rider B order; TicketBeat rot520
// pattern): the mehyar-web project's shared mailer keys are EMPTY in the
// production runtime, so the injected sendEmail (sendCloudflareEmail)
// returns not_configured and buyer mail silently never sends. When the
// shared path fails and CLIPNOTE_MAIL_TOKEN is present, send via the same
// Email Sending API with that scoped Bearer <redacted> (Email Sending Write
// only). Every final outcome is logged to clipnote_email_log (payment id +
// kind + path + status only — never the address or the token) so delivery
// is provable from D1 instead of silent.
async function sendViaClipnoteToken(env, message) {
  try {
    const accountId = env.CF_EMAIL_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID;
    if (!accountId) return { ok: false, status: "not_configured", error: "no_account_id" };
    const r = await fetch(
      "https://api.cloudflare.com/client/v4/accounts/" + encodeURIComponent(accountId) + "/email/sending/send",
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + env.CLIPNOTE_MAIL_TOKEN },
        body: JSON.stringify({
          to: message.to,
          from: { address: message.from, name: message.fromName },
          reply_to: message.replyTo,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        signal: AbortSignal.timeout(20000),
      }
    );
    const payload = await r.json().catch(() => ({}));
    if (r.ok && payload?.success !== false) {
      const delivered = Array.isArray(payload?.result?.delivered) ? payload.result.delivered : [];
      const queued = Array.isArray(payload?.result?.queued) ? payload.result.queued : [];
      return { ok: true, status: delivered.length ? "delivered" : queued.length ? "queued" : "accepted" };
    }
    const firstError = Array.isArray(payload?.errors) ? payload.errors[0] : null;
    return { ok: false, status: `cloudflare_email_${r.status}`, error: String(firstError?.message || "token_send_failed").slice(0, 300) };
  } catch (e) {
    return { ok: false, status: "threw", error: String((e && e.message) || e).slice(0, 300) };
  }
}

async function sendWithFallback(env, db, sendEmail, paymentId, kind, message) {
  let result;
  let path = "shared";
  try {
    result = await sendEmail(env, message);
  } catch (e) {
    result = { ok: false, status: "threw", error: String((e && e.message) || e) };
  }
  if (!result.ok && env.CLIPNOTE_MAIL_TOKEN) {
    path = "token";
    result = await sendViaClipnoteToken(env, message);
  }
  try {
    await db.prepare(
      "CREATE TABLE IF NOT EXISTS clipnote_email_log (" +
        "id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), " +
        "payment_id INTEGER, kind TEXT, path TEXT, status TEXT, error TEXT)"
    ).run();
    await db.prepare(
      "INSERT INTO clipnote_email_log (payment_id, kind, path, status, error) VALUES (?, ?, ?, ?, ?)"
    ).bind(
      paymentId || null, kind, path,
      String(result.status || (result.ok ? "ok" : "failed")).slice(0, 80),
      result.ok ? null : String(result.error || "").slice(0, 300)
    ).run();
  } catch (_) { /* logging must never break fulfillment */ }
  return result;
}

export async function fulfillClipnote({ db, env, waitUntil, sendEmail }, payment) {
  if (!db || !payment || !payment.id) throw new Error("fulfillClipnote: bad args");
  const productId = payment.product_id;
  const email = String(payment.email || "").toLowerCase();

  let meta = {};
  try { meta = JSON.parse(payment.metadata_json || "{}"); } catch {}
  const inputs = (meta && typeof meta === "object" && meta.inputs) || meta || {};
  const draftToken = String(inputs.draft_token || "");

  const from = "team@mehyar.us";
  const fromName = "Clipnote";

  // ── subscription: grant 4 monthly credits, exactly once per payment ──
  if (productId === "clipnote-plan") {
    const prior = await db
      .prepare("SELECT payment_id FROM clipnote_orders WHERE payment_id = ?")
      .bind(payment.id)
      .first();
    if (prior) return { ok: true, replay: true, mode: "credits" };
    // Sentinel order row (product_id clipnote-plan, status 'credits') makes
    // the grant idempotent on payment.id via idx_clipnote_orders_payment.
    const accessToken = payment.access_token;
    if (!accessToken) throw new Error("fulfillClipnote: payment has no access_token");
    await db
      .prepare(
        "INSERT INTO clipnote_orders (payment_id, product_id, email, draft_token, status, access_token, source) VALUES (?, ?, ?, ?, 'credits', ?, 'stripe')"
      )
      .bind(payment.id, productId, email, draftToken || null, accessToken)
      .run();
    await db
      .prepare(
        "INSERT INTO clipnote_credits (email, credits, updated_at) VALUES (?, 4, " + nowSql + ") " +
        "ON CONFLICT(email) DO UPDATE SET credits = credits + 4, updated_at = " + nowSql
      )
      .bind(email)
      .run();
    const run = async () => {
      try {
        const watch = `${baseUrl(env)}/#create`;
        const planUrl = `${baseUrl(env)}/plan?token=${accessToken}`;
        const subject = "Your Clipnote Plan is active — 4 video credits added";
        const text =
          `Welcome to the Clipnote Plan!\n\n` +
          `4 video credits are now on ${email}. Draft a script from your next changelog, then choose "Use a plan credit" to render it.\n\n` +
          `Start here:\n${watch}\n\n` +
          `Manage your plan or cancel anytime:\n${planUrl}\n\n-- ${fromName}`;
        const html =
          `<p>Welcome to the <strong>Clipnote Plan</strong>!</p>` +
          `<p>4 video credits are now on <strong>${email}</strong>. Draft a script from your next changelog, then choose "Use a plan credit" to render it.</p>` +
          `<p><a href="${watch}" style="display:inline-block;background:#7c3aed;color:#ffffff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:bold;">Draft your next script</a></p>` +
          `<p><a href="${planUrl}">Manage your plan or cancel anytime</a></p>` +
          `<p>-- ${fromName}</p>`;
        const result = await sendWithFallback(env, db, sendEmail, payment.id, "plan_welcome", { from, fromName, to: payment.email, replyTo: "team@mehyar.us", subject, text, html });
        if (!result.ok) console.error("fulfillClipnote credits email failed", result.error);
      } catch (e) {
        console.error("fulfillClipnote credits email threw", e && e.message);
      }
    };
    if (typeof waitUntil === "function") waitUntil(run()); else await run();
    return { ok: true, mode: "credits", credits_granted: 4 };
  }

  // ── one-off video: create the render order, idempotent on payment.id ──
  const existing = await db
    .prepare("SELECT id, access_token, status FROM clipnote_orders WHERE payment_id = ?")
    .bind(payment.id)
    .first();
  if (existing) return { ok: true, replay: true, order_id: existing.id, status: existing.status };

  const accessToken = payment.access_token;
  if (!accessToken) throw new Error("fulfillClipnote: payment has no access_token");

  let draft = null;
  if (draftToken) {
    draft = await db
      .prepare("SELECT product_name, release_notes, script_json, screenshots_json FROM clipnote_drafts WHERE token = ?")
      .bind(draftToken)
      .first();
  }

  const ins = await db
    .prepare(
      "INSERT INTO clipnote_orders (payment_id, product_id, email, draft_token, product_name, release_notes, script_json, screenshots_json, status, access_token, source) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, 'stripe')"
    )
    .bind(
      payment.id, productId, payment.email, draftToken || null,
      draft ? draft.product_name : null,
      draft ? draft.release_notes : null,
      draft ? draft.script_json : null,
      draft ? draft.screenshots_json || "[]" : "[]",
      accessToken
    )
    .run();
  const orderId = ins.meta.last_row_id;

  const run = async () => {
    try {
      const watchUrl = `${baseUrl(env)}/watch/${accessToken}`;
      const subject = "Your Clipnote video is in the studio";
      const text =
        `Thanks for your purchase!\n\n` +
        `Your launch video is queued for rendering — most videos are ready within a few hours, always within 24 hours. We'll email you the moment it's done.\n\n` +
        `Watch progress and get your video here:\n${watchUrl}\n\n-- ${fromName}`;
      const html =
        `<p>Thanks for your purchase!</p>` +
        `<p>Your <strong>Clipnote launch video</strong> is queued for rendering — most videos are ready within a few hours, always within 24 hours. We'll email you the moment it's done.</p>` +
        `<p><a href="${watchUrl}" style="display:inline-block;background:#7c3aed;color:#ffffff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:bold;">Watch progress</a></p>` +
        `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${watchUrl}">${watchUrl}</a></p>` +
        `<p>-- ${fromName}</p>`;
      const result = await sendWithFallback(env, db, sendEmail, payment.id, "video_queued", { from, fromName, to: payment.email, replyTo: "team@mehyar.us", subject, text, html });
      if (!result.ok) console.error("fulfillClipnote queued email failed", productId, result.error);
      if (result.ok) {
        await db
          .prepare(`UPDATE clipnote_orders SET email_sent_at=${nowSql}, updated_at=${nowSql} WHERE id=?`)
          .bind(orderId)
          .run();
      }
    } catch (e) {
      console.error("fulfillClipnote queued email threw", productId, e && e.message);
    }
  };
  if (typeof waitUntil === "function") waitUntil(run()); else await run();

  return { ok: true, order_id: orderId, mode: "single", sku: productId };
}
