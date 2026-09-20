// functions/api/_shared/fulfillPuretap.js
// Shared fulfillment for the PureTap $19 decoded water report.
// Called from the unified Stripe webhook (functions/api/pay/webhook.js)
// when a product with fulfillment='puretap' is paid.
//
// Flow:
//   1. Insert the puretap_orders row idempotently (UNIQUE payment_id).
//      A replayed webhook returns { replay: true } and does nothing else.
//   2. Unify the buyer's access token: the order's access_token is the
//      billing_payments access_token, so one token opens the report.
//   3. In the background (waitUntil): POST to the PureTap site's
//      /api/report/generate with the order token. Only when generation
//      succeeds is the order marked 'ready' and the delivery email sent.
//      If generation fails the order is marked 'failed' and NO email goes out.
//   4. The delivery email carries the token-gated report + PDF links and a
//      one-click unsubscribe URL. Suppressed addresses get no email.
//
// This module never throws out of the webhook path — failures are recorded
// on the order row and logged.

const PURETAP_BASE = "https://puretap.mehyar.us";
const FROM = "team@mehyar.us";

function nowIso() {
  return new Date().toISOString();
}

function randomToken() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Idempotent PureTap order creation + background report generation.
 * @returns {Promise<{replay:boolean}>}
 */
export async function fulfillPuretap({ db, env, waitUntil, sendEmail }, payment, _sess) {
  const email = String(payment.email || "").trim().toLowerCase();
  const paymentId = "pi_" + String(payment.id || "");
  const productId = String(payment.product_id || "puretap-report");

  let inputs = {};
  try {
    inputs = JSON.parse(payment.metadata_json || "{}").params || {};
  } catch { /* keep empty */ }
  const zip = typeof inputs.zip === "string" ? inputs.zip.slice(0, 10) : null;
  const pwsid = typeof inputs.pwsid === "string" ? inputs.pwsid.slice(0, 16) : null;

  // 1. Idempotent insert. UNIQUE(payment_id) makes replays a no-op.
  const accessToken = payment.access_token || randomToken();
  let isReplay = false;
  try {
    await db
      .prepare(
        "INSERT INTO puretap_orders (payment_id, access_token, email, product_id, inputs_json, status, created_at) " +
          "VALUES (?, ?, ?, ?, ?, 'paid', ?)"
      )
      .bind(
        paymentId,
        accessToken,
        email,
        productId,
        JSON.stringify({ zip, pwsid }),
        nowIso()
      )
      .run();
  } catch (e) {
    // UNIQUE constraint -> this payment was already fulfilled.
    isReplay = true;
  }

  // 2. Unify the token: the report links use the order token, which is the
  // billing_payments access_token (written by the webhook before this hook).
  if (!isReplay && payment.access_token && payment.access_token !== accessToken) {
    try {
      await db
        .prepare("UPDATE puretap_orders SET access_token = ? WHERE payment_id = ?")
        .bind(payment.access_token, paymentId)
        .run();
    } catch { /* keep the generated token */ }
  }
  const orderToken = (!isReplay && payment.access_token) || accessToken;

  if (isReplay) {
    try {
      console.log("[puretap] replay for", paymentId);
    } catch {}
    return { replay: true };
  }

  // 3. Background: ask the PureTap site to generate the report, then email.
  const run = async () => {
    try {
      await db
        .prepare("UPDATE puretap_orders SET status = 'generating' WHERE payment_id = ?")
        .bind(paymentId)
        .run();
    } catch {}

    let genOk = false;
    let unsub = null;
    try {
      const res = await fetch(PURETAP_BASE + "/api/report/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_token: orderToken }),
      });
      genOk = res.ok;
      if (genOk) {
        try {
          const gj = await res.json();
          if (gj && typeof gj.unsubscribe_url === "string") unsub = gj.unsubscribe_url;
        } catch {}
      } else {
        try {
          console.log("[puretap] generate failed", res.status, (await res.text()).slice(0, 200));
        } catch {}
      }
    } catch (e) {
      try {
        console.log("[puretap] generate error", String((e && e.message) || e).slice(0, 200));
      } catch {}
    }

    if (!genOk) {
      try {
        await db
          .prepare("UPDATE puretap_orders SET status = 'failed' WHERE payment_id = ?")
          .bind(paymentId)
          .run();
      } catch {}
      return; // no email on generation failure
    }

    try {
      await db
        .prepare("UPDATE puretap_orders SET status = 'ready', ready_at = ? WHERE payment_id = ?")
        .bind(nowIso(), paymentId)
        .run();
    } catch {}

    // 4. Suppression check: never email an address that unsubscribed.
    let suppressed = false;
    try {
      const s = await db
        .prepare("SELECT email FROM puretap_suppressions WHERE email = ?")
        .bind(email)
        .first();
      suppressed = !!s;
    } catch { /* table missing -> not suppressed */ }
    if (suppressed || !email) {
      try {
        console.log("[puretap] suppressed/no-email, skipping send for", paymentId);
      } catch {}
      return;
    }

    const reportUrl = PURETAP_BASE + "/api/report?token=" + encodeURIComponent(orderToken);
    const pdfUrl = PURETAP_BASE + "/api/report/pdf?token=" + encodeURIComponent(orderToken);
    // unsub was captured from the /api/report/generate response above (the
    // PureTap site mints the HMAC token — this worker never sees the secret).

    const html =
      "<p>Your PureTap decoded water report is ready.</p>" +
      '<p><a href="' + esc(reportUrl) + '">View your report</a> &middot; ' +
      '<a href="' + esc(pdfUrl) + '">Print / save as PDF</a></p>' +
      (zip ? "<p>ZIP: " + esc(zip) + "</p>" : "") +
      '<p style="font-size:12px;color:#666">Keep this email — the links are your private access to the report.' +
      (unsub ? ' <a href="' + esc(unsub) + '">Unsubscribe</a>' : "") +
      "</p>";

    try {
      await sendEmail(env, {
        to: email,
        from: FROM,
        subject: "Your PureTap water report is ready",
        html,
      });
    } catch (e) {
      try {
        console.log("[puretap] email error", String((e && e.message) || e).slice(0, 200));
      } catch {}
    }
  };

  try {
    if (typeof waitUntil === "function") waitUntil(run());
    else await run();
  } catch {}
  return { replay: false };
}
