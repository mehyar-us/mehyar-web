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
    if (!payment) return json({ ok: true });

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

    // Prefer the purpose-built email credential set: the project's
    // CLOUDFLARE_API_KEY is a scoped token and fails x-auth-key auth against
    // the Email Sending API, while CF_EMAIL_GLOBAL_KEY is the global key
    // that endpoint requires (diagnosed rot520: raw global-key send queued,
    // helper-default send silently failed). Shim only this call's env; the
    // shared helper and every other caller keep their behavior.
    const mailEnv = {
      ...env,
      CLOUDFLARE_API_KEY: env.CF_EMAIL_GLOBAL_KEY || env.CLOUDFLARE_API_KEY,
      CLOUDFLARE_EMAIL: env.CF_EMAIL || env.CLOUDFLARE_EMAIL,
    };
    const sent = await sendCloudflareEmail(mailEnv, {
      to: payment.email,
      from: "info@mehyar.us",
      fromName: "TicketBeat",
      replyTo: "info@mehyar.us",
      subject: "Your TicketBeat Watchdog cancel link",
      text,
      html,
    });
    if (!sent.ok) console.error("cancel-lookup send failed:", sent.status, sent.error || "");
    return json({ ok: true });
  } catch (e) {
    console.error("cancel-lookup error:", e && e.message);
    return json({ ok: true });
  }
}
