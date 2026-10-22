// functions/api/pay/cancel-lookup.js
// Email-lookup cancel path (TicketBeat rot520 / QA F10): buying takes an
// email, so cancelling must be findable by the same route — not only by a
// bearer key the buyer may have lost.
//
// POST { email, product_id }
//   Finds the buyer's latest PAID billing_payments row for the product and
//   emails that address its cancel link (the same access_token credential
//   the receipt emails carry). The response is ALWAYS { ok: true } — the
//   endpoint never reveals whether an email holds a purchase (no account
//   enumeration), and sends are rate-limited per IP and per email.
//
// Scope: ticketbeat-monthly (Watchdog) only, per the rot520 order.

import { sendCloudflareEmail } from "../_shared/cloudflareEmail.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const PRODUCTS = {
  "ticketbeat-monthly": {
    name: "TicketBeat Watchdog",
    cancelBase: "https://ticketbeat.mehyar.us/cancel",
  },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const ipHits = new Map();
const emailHits = new Map();
function hit(map, key, now, windowMs, max) {
  const arr = (map.get(key) || []).filter((ts) => now - ts < windowMs);
  if (arr.length >= max) return false;
  arr.push(now);
  map.set(key, arr);
  return true;
}

export async function onRequestPost({ request, env }) {
  // Neutral by contract: every outcome below returns the same { ok: true }.
  try {
    if (!env?.LEADS_DB) return json({ ok: true });
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
    const productId = String(body.product_id || "");
    const product = PRODUCTS[productId];
    if (!EMAIL_RE.test(email) || !product) return json({ ok: true });

    const now = Date.now();
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    if (!hit(ipHits, ip, now, 15 * 60 * 1000, 10)) return json({ ok: true });
    if (!hit(emailHits, email, now, 60 * 60 * 1000, 3)) return json({ ok: true });

    const payment = await env.LEADS_DB
      .prepare(
        "SELECT access_token, email FROM billing_payments " +
          "WHERE LOWER(email) = ? AND product_id = ? AND status = 'paid' " +
          "AND access_token IS NOT NULL AND length(access_token) >= 16 " +
          "ORDER BY id DESC LIMIT 1"
      )
      .bind(email, productId)
      .first()
      .catch(() => null);
    // Audit trail (also the only window into send failures — the neutral
    // response contract hides them from callers by design). Stores the
    // recipient domain only, never the token or the full address.
    const log = async (sendStatus, sendError) => {
      try {
        await env.LEADS_DB
          .prepare(
            "CREATE TABLE IF NOT EXISTS cancel_lookup_log (" +
              "id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (datetime('now')), " +
              "email_domain TEXT, found INTEGER, send_status TEXT, send_error TEXT)"
          )
          .run();
        await env.LEADS_DB
          .prepare("INSERT INTO cancel_lookup_log (email_domain, found, send_status, send_error) VALUES (?, ?, ?, ?)")
          .bind(email.split("@")[1] || "", payment ? 1 : 0, sendStatus || "", String(sendError || "").slice(0, 300))
          .run();
      } catch (_) {}
    };
    if (!payment) { await log("not_found", ""); return json({ ok: true }); }

    const link = product.cancelBase + "?token=" + encodeURIComponent(payment.access_token);
    const text =
      "Here's your " + product.name + " cancel link:\n\n" + link + "\n\n" +
      "Open it to cancel your subscription or manage billing — no password needed. " +
      "Cancelling stops future charges and ends your letter coverage; payments already made are final.\n\n" +
      "This link works like a key to your purchase — don't share or forward it.\n" +
      "Didn't ask for this? Someone typed your email into the cancel page; you can ignore this message and nothing changes.\n\n" +
      "— TicketBeat (Mehyar Soft LLC)";
    const html =
      '<p>Here\'s your ' + product.name + ' cancel link:</p>' +
      '<p><a href="' + link + '">Open the cancel page</a></p>' +
      "<p>Open it to cancel your subscription or manage billing — no password needed. " +
      "Cancelling stops future charges and ends your letter coverage; payments already made are final.</p>" +
      "<p>This link works like a key to your purchase — don't share or forward it.<br>" +
      "Didn't ask for this? Someone typed your email into the cancel page; you can ignore this message and nothing changes.</p>" +
      "<p>— TicketBeat (Mehyar Soft LLC)</p>";

    // Send path (rot520 diagnosis): the project's CLOUDFLARE_API_KEY and
    // CF_EMAIL_GLOBAL_KEY secrets are EMPTY in the runtime (zeroed by a past
    // env read-modify-write; the presence map proved ckey=0/cfkey=0 while
    // CLOUDFLARE_EMAIL and STRIPE_SECRET_KEY are present), so the shared
    // helper's x-auth-key path returns not_configured here. This endpoint
    // therefore sends with its own scoped credential: CANCEL_LOOKUP_MAIL_TOKEN,
    // an API token minted with only the Email Sending Write permission,
    // calling the same Email Sending API with Bearer auth (probe-verified
    // 200/queued). If that var is ever absent, fall back to the shared
    // helper in case the project keys get restored.
    const message = {
      to: payment.email,
      from: "info@mehyar.us",
      fromName: "TicketBeat",
      replyTo: "info@mehyar.us",
      subject: "Your TicketBeat Watchdog cancel link",
      text,
      html,
    };
    let sent;
    if (env.CANCEL_LOOKUP_MAIL_TOKEN) {
      try {
        const accountId = env.CF_EMAIL_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID;
        const r = await fetch(
          "https://api.cloudflare.com/client/v4/accounts/" + encodeURIComponent(accountId) + "/email/sending/send",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer " + env.CANCEL_LOOKUP_MAIL_TOKEN,
            },
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
          sent = { ok: true, status: delivered.length ? "delivered" : queued.length ? "queued" : "accepted" };
        } else {
          const firstError = Array.isArray(payload?.errors) ? payload.errors[0] : null;
          sent = { ok: false, status: "cloudflare_email_" + r.status, error: String(firstError?.message || "cloudflare_email_send_failed").slice(0, 300) };
        }
      } catch (e) {
        sent = { ok: false, status: "send_exception", error: String(e && e.message).slice(0, 300) };
      }
    } else {
      sent = await sendCloudflareEmail(env, message);
    }
    if (!sent.ok) console.error("cancel-lookup send failed:", sent.status, sent.error || "");
    let sendErr = sent.ok ? "" : sent.error || "";
    if (!sent.ok && sent.status === "not_configured") {
      // Presence map only (1/0 per name, never values): names the exact
      // credential the runtime lacks so the config gap is fixable in one step.
      const P = (v) => (v ? "1" : "0");
      sendErr += " | acct=" + P(env.CF_EMAIL_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID) +
        " cem=" + P(env.CLOUDFLARE_EMAIL) + " ckey=" + P(env.CLOUDFLARE_API_KEY) +
        " cfkey=" + P(env.CF_EMAIL_GLOBAL_KEY) + " mailtok=" + P(env.CANCEL_LOOKUP_MAIL_TOKEN) +
        " stripe=" + P(env.STRIPE_SECRET_KEY) +
        " envname=" + P(env.ENVIRONMENT) + " from=" + P(env.CONTACT_FROM_EMAIL);
    }
    await log(sent.status || (sent.ok ? "ok" : "unknown"), sendErr);
    return json({ ok: true });
  } catch (e) {
    console.error("cancel-lookup error:", e && e.message);
    return json({ ok: true });
  }
}
