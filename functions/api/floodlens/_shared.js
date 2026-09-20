// functions/api/floodlens/confirm.js + unsubscribe.js (shared handler shape)
// GET /api/floodlens/confirm?token= — double-opt-in confirmation.
// GET /api/floodlens/unsubscribe?token= — one-click unsubscribe (the GET
// itself unsubscribes; POST with the same params also works for
// List-Unsubscribe-Post clients). Honors suppression on the brand table,
// the global table, and the house suppression_list.

import { sendCloudflareEmail } from "../_shared/cloudflareEmail.js";

function page(title, heading, bodyHtml, ok) {
  const accent = ok === false ? "#b42318" : "#0a5cc2";
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${title} — FloodLens</title><style>` +
      `body{margin:0;background:#0a0f1e;color:#e8edf7;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}` +
      `.card{max-width:520px;text-align:center;background:#111a30;border:1px solid #22315a;border-radius:16px;padding:40px 32px}` +
      `.h{font-size:24px;font-weight:700;margin:0 0 12px}` +
      `.p{color:#9fb0d0;font-size:15px;line-height:1.6}` +
      `.brand{margin-top:24px;font-size:12px;color:#5c6f95;letter-spacing:.08em;text-transform:uppercase}` +
      `.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:${accent};margin-right:8px}` +
      `a{color:#7aa2ff}` +
      `</style></head><body><div class="card">` +
      `<div class="h"><span class="dot"></span>${heading}</div><div class="p">${bodyHtml}</div>` +
      `<div class="brand">FloodLens · mehyar.us</div></div></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );
}

async function hmacSha256(env, value) {
  const secret = env?.HMAC_SECRET || env?.TURNSTILE_SECRET_KEY || "";
  if (!secret) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function confirmToken(request, env) {
  if (!env?.LEADS_DB) return page("Error", "Something's off", "Service temporarily unavailable.", false);
  const db = env.LEADS_DB;
  const url = new URL(request.url);
  let token = url.searchParams.get("token");
  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    token = token || body.token;
  }
  if (!token || token.length < 16) {
    return page("Confirm", "Something's off", "That link looks incomplete — use the one from your latest FloodLens email.", false);
  }
  const sub = await db
    .prepare("SELECT email, status FROM floodlens_subscribers WHERE confirm_token = ?")
    .bind(token)
    .first();
  if (!sub) {
    return page("Confirm", "Something's off", "We couldn't find that subscription. If you keep getting our emails, reply to one and we'll sort it out.", false);
  }
  const now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
  await db.prepare(`UPDATE floodlens_subscribers SET status='confirmed', confirmed_at=${now} WHERE confirm_token=?`).bind(token).run();
  await db.prepare(`UPDATE subscribers_global SET status='confirmed', updated_at=${now} WHERE email=? AND brand='floodlens'`).bind(sub.email).run();

  // Deliver the promised free breakdown (transactional, one time).
  try {
    const lookup = await db
      .prepare("SELECT address, zone, risk_plain, data_as_of FROM floodlens_lookups WHERE token=(SELECT lookup_token FROM floodlens_subscribers WHERE confirm_token=?)")
      .bind(token)
      .first();
    if (lookup) {
      const unsubUrl = `https://mehyar.us/api/floodlens/unsubscribe?token=${token}`;
      await sendCloudflareEmail(env, {
        from: env.FLOODLENS_FROM_EMAIL || "team@mehyar.us",
        fromName: "FloodLens",
        to: sub.email,
        replyTo: "info@mehyar.us",
        subject: `Your flood zone breakdown: ${lookup.address}`,
        text:
          `Confirmed — here's your full free breakdown:\n\n${lookup.address}\n` +
          `FEMA Zone ${lookup.zone} — ${lookup.risk_plain}\nMap effective: ${lookup.data_as_of || "unknown"}\n\n` +
          `Not an official flood determination — your lender will order one.\n\n` +
          `Want the 10-page plain-English report (insurance cost range, how premiums are estimated, questions for your agent)? ` +
          `It's $19, one time: https://floodlens.mehyar.us/#get-report\n\n` +
          `Unsubscribe anytime: ${unsubUrl}\n\n-- FloodLens`,
        html:
          `<p><strong>${escapeHtml(lookup.address)}</strong></p>` +
          `<p>FEMA Zone <strong>${escapeHtml(lookup.zone)}</strong> — ${escapeHtml(lookup.risk_plain)}</p>` +
          `<p style="color:#6b7280;font-size:13px;">Map effective: ${escapeHtml(lookup.data_as_of || "unknown")}. Not an official flood determination — your lender will order one.</p>` +
          `<p><a href="https://floodlens.mehyar.us/#get-report" style="display:inline-block;background:#0a5cc2;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Get the full $19 report</a></p>` +
          `<p style="color:#9aa3b2;font-size:12px;"><a href="${unsubUrl}" style="color:#9aa3b2;">Unsubscribe</a></p>`,
        headers: {
          "List-Unsubscribe": `<${unsubUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
    }
  } catch (e) {
    console.error("floodlens confirm breakdown email failed", e && e.message);
  }

  return page(
    "Confirmed",
    "You're in",
    "Confirmed — your full zone breakdown is on its way to your inbox. " +
      "The 10-page plain-English report is <a href=\"https://floodlens.mehyar.us/#get-report\">$19, one time</a>, whenever you're ready.",
    true
  );
}

export async function unsubscribeToken(request, env) {
  if (!env?.LEADS_DB) return page("Error", "Something's off", "Service temporarily unavailable.", false);
  const db = env.LEADS_DB;
  const url = new URL(request.url);
  let token = url.searchParams.get("token");
  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    token = token || body.token;
  }
  if (!token || token.length < 16) {
    return page("Unsubscribe", "Something's off", "That unsubscribe link looks incomplete. Every FloodLens email has a working unsubscribe link — use the one in your latest email.", false);
  }
  const sub = await db
    .prepare("SELECT email FROM floodlens_subscribers WHERE confirm_token = ?")
    .bind(token)
    .first();
  if (!sub) {
    return page("Unsubscribe", "Something's off", "We couldn't find that subscription. If you keep getting our emails, reply to one and we'll sort it out.", false);
  }
  const now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
  await db.prepare(`UPDATE floodlens_subscribers SET unsubscribed=1, unsubscribed_at=${now}, status='unsubscribed' WHERE confirm_token=?`).bind(token).run();
  await db.prepare(`UPDATE subscribers_global SET unsubscribed=1, updated_at=${now} WHERE email=? AND brand='floodlens'`).bind(sub.email).run();
  // House suppression_list mirror (HMAC email hash) so every mailer honors it.
  try {
    const h = await hmacSha256(env, sub.email);
    if (h) {
      await db.prepare(
        "INSERT OR IGNORE INTO suppression_list (id, type, value_hash, reason, source) VALUES (?, 'email', ?, 'unsubscribe_request', 'floodlens')"
      ).bind(crypto.randomUUID(), h).run();
    }
  } catch {}
  return page(
    "Unsubscribed",
    "You're unsubscribed",
    "Done — you won't hear from FloodLens again. If this was a mistake, just run another free lookup and confirm again.",
    true
  );
}

function escapeHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
