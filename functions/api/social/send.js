// Reply sender (stub) — Instagram Messaging API via Meta Graph.
// Reads the page access token from env.INSTAGRAM_PAGE_TOKEN; never hardcode.
// If the token is missing, logs and returns {sent:false} — nothing fires.

export async function sendInstagramReply(env, igAccountId, recipientId, text) {
  if (!env.INSTAGRAM_PAGE_TOKEN) {
    console.log("[social-inbox] send skipped: no_token");
    return { sent: false, reason: "no_token" };
  }
  if (!igAccountId || !recipientId) {
    return { sent: false, reason: "missing_ids" };
  }
  const res = await fetch(`https://graph.facebook.com/v21.0/${igAccountId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.INSTAGRAM_PAGE_TOKEN}`,
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      messaging_type: "RESPONSE",
      message: { text: String(text).slice(0, 1900) },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.log("[social-inbox] send failed:", res.status, JSON.stringify(data).slice(0, 200));
    return { sent: false, reason: `graph_${res.status}` };
  }
  return { sent: true, message_id: data.message_id || null };
}

// Direct hits to this module path are not a public API.
export async function onRequestGet() {
  return new Response("not found", { status: 404 });
}
export async function onRequestPost() {
  return new Response("not found", { status: 404 });
}
export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}
