// POST /api/hustlekit/send-confirm — internal relay: send the HustleKit
// free-tier double-opt-in confirmation email. Called server-side by the
// HustleKit PWA after storing a pending subscriber row.
//
// Auth: Authorization: Bearer <HUSTLEKIT_RELAY_SECRET> — shared internal
// credential (NOT the buyer flow; never exposed to browsers).
// Body: { email: string, token: string (confirm token), unsub_token: string }
//
// Uses the proven sendCloudflareEmail path (same as buyer deliverable mail).

import { sendCloudflareEmail } from "../_shared/cloudflareEmail.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

export async function onRequestPost({ request, env }) {
  const secret = env.HUSTLEKIT_RELAY_SECRET || "";
  const auth = request.headers.get("authorization") || "";
  if (!secret || auth !== "Bearer " + secret) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }
  const email = String(body.email || "").trim().toLowerCase();
  const token = String(body.token || "");
  const unsubToken = String(body.unsub_token || "");
  if (!isValidEmail(email)) return json({ ok: false, error: "invalid_email" }, 400);
  if (token.length < 16 || unsubToken.length < 16) {
    return json({ ok: false, error: "bad_token" }, 400);
  }

  const confirmUrl = `https://hustlekit.mehyar.us/api/hustlekit/confirm?token=${encodeURIComponent(token)}`;
  const unsubUrl = `https://hustlekit.mehyar.us/api/hustlekit/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
  const subject = "Confirm your HustleKit subscription";
  const text =
    `You're one click away from free side-hustle tips.\n\n` +
    `Confirm your subscription:\n${confirmUrl}\n\n` +
    `Didn't ask for this? Ignore this email, or unsubscribe:\n${unsubUrl}\n`;
  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px">
<p>You're one click away from free side-hustle tips.</p>
<p><a href="${esc(confirmUrl)}" style="display:inline-block;background:#a3e635;color:#1a1a1a;padding:12px 24px;text-decoration:none;border-radius:8px;font-weight:600">Confirm my subscription</a></p>
<p style="font-size:12px;color:#666">Didn't ask for this? Just ignore this email, or <a href="${esc(unsubUrl)}">unsubscribe</a>.</p>
</body></html>`;

  const result = await sendCloudflareEmail(env, {
    from: "team@mehyar.us",
    fromName: "HustleKit",
    to: email,
    replyTo: "info@mehyar.us",
    subject,
    text,
    html,
    headers: {
      "List-Unsubscribe": `<${unsubUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  if (!result.ok) {
    console.error("send-confirm failed", email, result.error);
    return json({ ok: false, error: "send_failed" }, 502);
  }
  return json({ ok: true, status: result.status });
}
