// functions/api/floodlens/unsubscribe.js
// GET /api/floodlens/unsubscribe?token= — one-click unsubscribe.
// The GET itself unsubscribes (RFC 8058); POST with the same params also
// works for List-Unsubscribe-Post clients.
import { unsubscribeToken } from "./_shared.js";

export async function onRequestGet({ request, env }) {
  try {
    return await unsubscribeToken(request, env);
  } catch (e) {
    console.error("floodlens unsubscribe failed", e && e.message);
    return new Response("Unsubscribe failed", { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  try {
    return await unsubscribeToken(request, env);
  } catch (e) {
    console.error("floodlens unsubscribe failed", e && e.message);
    return new Response("Unsubscribe failed", { status: 500 });
  }
}
