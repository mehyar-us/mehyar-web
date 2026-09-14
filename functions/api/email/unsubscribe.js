// functions/api/email/unsubscribe.js
// GET /api/email/unsubscribe?m=<send_id>&t=<token>
// RFC 8058 one-click unsubscribe: the GET itself unsubscribes immediately and
// renders a branded confirmation page. (A POST with the same params is also
// accepted for List-Unsubscribe-Post clients.)

import { getSendContext, verifySendId, logEvent, setAudienceStatus } from "../_shared/emailTrack.js";

function page(title, heading, body) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${title} — MehyarSoft</title><style>` +
      `body{margin:0;background:#0a0f1e;color:#e8edf7;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}` +
      `.card{max-width:520px;text-align:center;background:#111a30;border:1px solid #22315a;border-radius:16px;padding:40px 32px}` +
      `.h{font-size:24px;font-weight:700;margin:0 0 12px}` +
      `.p{color:#9fb0d0;font-size:15px;line-height:1.6}` +
      `.brand{margin-top:24px;font-size:12px;color:#5c6f95;letter-spacing:.08em;text-transform:uppercase}` +
      `a{color:#7aa2ff}` +
      `</style></head><body><div class="card">` +
      `<div class="h">${heading}</div><p class="p">${body}</p>` +
      `<div class="brand">MehyarSoft · mehyar.us</div></div></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );
}

async function handle(request, env) {
  const url = new URL(request.url);
  let sendId = url.searchParams.get("m");
  let token = url.searchParams.get("t");
  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    sendId = sendId || body.m;
    token = token || body.t;
  }
  if (!sendId || !token) {
    return page("Unsubscribe", "Something's off", "That unsubscribe link looks incomplete. Every email we send has a working unsubscribe link — just use the one in your latest email.");
  }
  const ctx = await getSendContext(env, sendId);
  if (!ctx) {
    return page("Unsubscribe", "Something's off", "We couldn't find that subscription. If you keep getting our emails, reply to one and we'll sort it out.");
  }
  const ok = await verifySendId(ctx.sendId, token, ctx.campaignSecret);
  if (!ok) {
    return page("Unsubscribe", "Something's off", "That unsubscribe link isn't valid. Please use the link from your latest email.");
  }
  await logEvent(env, ctx.sendId, "unsubscribe", {
    ip: request.headers.get("cf-connecting-ip") || "",
    one_click: true,
  });
  await setAudienceStatus(env, ctx.audienceId, "unsubscribed");
  return page(
    "Unsubscribed",
    "You're unsubscribed",
    "Done — you won't hear from us again on this list. If this was a mistake, just reply to any of our emails and we'll add you back."
  );
}

export async function onRequestGet(context) {
  try {
    return await handle(context.request, context.env);
  } catch (e) {
    console.error("email unsubscribe failed", e && e.message);
    return page("Unsubscribe", "Hmm", "We couldn't process that right now — please try again in a minute.");
  }
}

export async function onRequestPost(context) {
  try {
    return await handle(context.request, context.env);
  } catch (e) {
    console.error("email unsubscribe failed", e && e.message);
    return new Response(JSON.stringify({ ok: false }), {
      status: 500,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
}
