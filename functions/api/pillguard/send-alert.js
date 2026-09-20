// functions/api/pillguard/send-alert.js
// POST /api/pillguard/send-alert — product-functional mail relay for PillGuard.
// Lets the pillguard.mehyar.us nightly engine send paid recall alerts through
// mehyar-web's PROVEN transactional mail path (Cloudflare Email Sending),
// without duplicating email credentials onto the satellite Pages project.
//
// Auth: Authorization: Bearer <PILLGUARD_CRON_SECRET> (env, never in repo).
// Body: { to, subject, text?, html? }
//   - `to` must be a valid email; subject/text/html are size-capped.
//   - From identity is PINNED server-side (team@mehyar.us / "PillGuard",
//     reply-to info@mehyar.us) — the caller cannot spoof the sender.
//   - Product-functional mail ONLY (paid recall alerts, operator digests).
//     Never marketing; never the paused campaign ESPs.
// Response: { ok:true } or { ok:false, error }.

import { sendCloudflareEmail } from "../_shared/cloudflareEmail.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SUBJECT = 200;
const MAX_BODY = 60000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function onRequestPost({ request, env }) {
  try {
    const secret = env.PILLGUARD_CRON_SECRET;
    const auth = request.headers.get("authorization") || "";
    if (!secret || auth !== `Bearer ${secret}`) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    const body = await request.json().catch(() => ({}));
    const to = String(body.to || "").trim().toLowerCase().slice(0, 254);
    const subject = String(body.subject || "").trim().slice(0, MAX_SUBJECT);
    const text = String(body.text || "").slice(0, MAX_BODY);
    const html = String(body.html || "").slice(0, MAX_BODY);

    if (!EMAIL_RE.test(to)) return json({ ok: false, error: "invalid_to" }, 400);
    if (!subject) return json({ ok: false, error: "missing_subject" }, 400);
    if (!text && !html) return json({ ok: false, error: "missing_body" }, 400);

    // Pinned sender identity — never from the client.
    const from = env.PILLGUARD_FROM_EMAIL || "team@mehyar.us";
    const result = await sendCloudflareEmail(env, {
      from,
      fromName: "PillGuard",
      to,
      replyTo: "info@mehyar.us",
      subject,
      text: text || undefined,
      html: html || undefined,
      headers: {
        // One-click unsubscribe (RFC 8058) on every product email.
        "List-Unsubscribe": "<https://pillguard.mehyar.us/api/unsubscribe?email=" + encodeURIComponent(to) + ">",
      },
    });

    if (!result.ok) {
      console.error("pillguard send-alert failed", result.error);
      return json({ ok: false, error: result.error || "send_failed" }, 502);
    }
    return json({ ok: true, status: result.status });
  } catch (e) {
    console.error("pillguard send-alert error", e && e.message);
    return json({ ok: false, error: "internal" }, 500);
  }
}
