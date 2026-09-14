// functions/api/email/open.js
// GET /api/email/open?m=<send_id>&t=<token>
// Open-pixel for the email warmup campaign. Always returns the 1x1 GIF —
// tracking failures must never break the pixel load.

import { getSendContext, verifySendId, logEvent, setAudienceStatus } from "../_shared/emailTrack.js";

// 1x1 transparent GIF (43 bytes).
const PIXEL = Uint8Array.from(atob("R0lGODlhAQABAIAAAP///////yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="), (c) =>
  c.charCodeAt(0)
);

function pixelResponse() {
  return new Response(PIXEL, {
    status: 200,
    headers: {
      "content-type": "image/gif",
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      "pragma": "no-cache",
      "expires": "0",
      "content-length": String(PIXEL.length),
    },
  });
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const sendId = url.searchParams.get("m");
    const token = url.searchParams.get("t");
    if (!sendId || !token) return pixelResponse();

    const ctx = await getSendContext(env, sendId);
    if (!ctx) return pixelResponse();
    const ok = await verifySendId(ctx.sendId, token, ctx.campaignSecret);
    if (!ok) return pixelResponse();

    await logEvent(env, ctx.sendId, "open", {
      ua: (request.headers.get("user-agent") || "").slice(0, 200),
      ip: request.headers.get("cf-connecting-ip") || "",
    });
    await setAudienceStatus(env, ctx.audienceId, "opened");
  } catch (e) {
    console.error("email open tracking failed", e && e.message);
  }
  return pixelResponse();
}
