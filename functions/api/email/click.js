// functions/api/email/click.js
// GET /api/email/click?m=<send_id>&t=<token>&u=<base64url target>
// Click tracking for the email warmup campaign. Verifies the token, logs the
// click, bumps audience status to clicked, then 302-redirects to the target.
// Special target: u = base64url("CONFIRM") -> marks the contact confirmed
// (the "Yes, keep me" link) and shows a thank-you page instead of redirecting.

import {
  getSendContext,
  verifySendId,
  logEvent,
  setAudienceStatus,
  fromBase64Url,
  safeRedirectTarget,
} from "../_shared/emailTrack.js";

function bad(status, message) {
  return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

function confirmPage() {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>You're in — MehyarSoft</title><style>` +
      `body{margin:0;background:#0a0f1e;color:#e8edf7;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}` +
      `.card{max-width:520px;text-align:center;background:#111a30;border:1px solid #22315a;border-radius:16px;padding:40px 32px}` +
      `.ok{font-size:48px}.h{font-size:24px;font-weight:700;margin:16px 0 8px}` +
      `.p{color:#9fb0d0;font-size:15px;line-height:1.6}` +
      `.brand{margin-top:24px;font-size:12px;color:#5c6f95;letter-spacing:.08em;text-transform:uppercase}` +
      `</style></head><body><div class="card"><div class="ok">✅</div>` +
      `<div class="h">You're confirmed</div>` +
      `<p class="p">Thanks — you'll keep getting the good stuff. If you ever change your mind, every email has an unsubscribe link.</p>` +
      `<div class="brand">MehyarSoft · mehyar.us</div></div></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const sendId = url.searchParams.get("m");
    const token = url.searchParams.get("t");
    const u = url.searchParams.get("u");
    if (!sendId || !token || !u) return bad(400, "bad request");

    const ctx = await getSendContext(env, sendId);
    if (!ctx) return bad(400, "bad request");
    const ok = await verifySendId(ctx.sendId, token, ctx.campaignSecret);
    if (!ok) return bad(400, "bad request");

    const decoded = fromBase64Url(u);
    if (decoded === null) return bad(400, "bad request");

    const meta = {
      ua: (request.headers.get("user-agent") || "").slice(0, 200),
      ip: request.headers.get("cf-connecting-ip") || "",
    };

    // "Yes, keep me" confirmation link.
    if (decoded === "CONFIRM") {
      await logEvent(env, ctx.sendId, "click", { ...meta, action: "confirm" });
      await setAudienceStatus(env, ctx.audienceId, "confirmed");
      return confirmPage();
    }

    const target = safeRedirectTarget(decoded);
    if (!target) return bad(400, "bad request");

    await logEvent(env, ctx.sendId, "click", { ...meta, target: target.slice(0, 300) });
    await setAudienceStatus(env, ctx.audienceId, "clicked");
    return new Response(null, {
      status: 302,
      headers: { location: target, "cache-control": "no-store" },
    });
  } catch (e) {
    console.error("email click tracking failed", e && e.message);
    return bad(500, "tracking error");
  }
}
