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

// WhatsApp Cloud API sender — same Graph version + env-token discipline.
// Token: env.WHATSAPP_TOKEN (system-user token for the WABA). Never hardcode.
// Phone number id: the payload's metadata.phone_number_id when available,
// else env.WHATSAPP_PHONE_NUMBER_ID. Missing config -> {sent:false}, nothing fires.
export async function sendWhatsAppReply(env, phoneNumberId, to, text) {
  if (!env.WHATSAPP_TOKEN) {
    console.log("[wa-lane] send skipped: no_token");
    return { sent: false, reason: "no_token" };
  }
  if (!phoneNumberId || !to) {
    return { sent: false, reason: "missing_ids" };
  }
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: String(to),
      type: "text",
      text: { body: String(text).slice(0, 4000) },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.log("[wa-lane] send failed:", res.status, JSON.stringify(data).slice(0, 200));
    return { sent: false, reason: `graph_${res.status}` };
  }
  return { sent: true, message_id: data.messages?.[0]?.id || null };
}

// Blue-tick the inbound message (allowed inside the service window).
export async function markWhatsAppRead(env, phoneNumberId, messageId) {
  if (!env.WHATSAPP_TOKEN || !phoneNumberId || !messageId) {
    return { sent: false, reason: "missing_config" };
  }
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: String(messageId),
    }),
  }).catch((e) => { console.log("[wa-lane] mark-read failed", e); return null; });
  return { sent: !!res?.ok };
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
