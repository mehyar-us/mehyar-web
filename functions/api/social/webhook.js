// Meta webhook for the unified social inbox.
// GET  /api/social/webhook — subscription verification
// POST /api/social/webhook — message + comment events
import { route, accountIgId, accountForIgId } from "./_shared/router.js";
import { sendInstagramReply } from "./send.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  if (q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === env.META_VERIFY_TOKEN) {
    return new Response(q.get("hub.challenge") || "", { status: 200 });
  }
  // diagnostic: unconfigured vs mismatch (never leaks the value)
  const hint = env.META_VERIFY_TOKEN ? "mismatch" : "unconfigured";
  return new Response(`forbidden:${hint}`, { status: 403 });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}

async function verifySignature(env, rawBody, signature) {
  if (!env.META_APP_SECRET) {
    console.warn("[social-inbox] META_APP_SECRET unset — accepting unsigned webhook (dev only)");
    return true;
  }
  if (!signature || !signature.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.META_APP_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const a = signature.slice(7), b = hex;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Shared pipeline: idempotency -> intent route -> log -> send (DMs only).
export async function processInbound(env, evt) {
  const { account, kind, author, author_name, text, ref_id } = evt || {};
  if (!account || !text || !ref_id) return { ok: false, reason: "bad_event" };
  const db = env.LEADS_DB;
  if (db) {
    const seen = await db.prepare("SELECT ref_id FROM social_inbox_log WHERE ref_id = ?")
      .bind(String(ref_id)).first().catch(() => null);
    if (seen) return { ok: true, duplicate: true };
  }
  const r = route({ account, kind, author, author_name, text });
  const now = new Date().toISOString();
  if (db) {
    await db.prepare(
      "INSERT OR IGNORE INTO social_inbox_log (ref_id, account, kind, author, product_id, replied_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(String(ref_id), String(account), String(kind || ""), String(author || ""),
      r.product_id || null, now).run().catch((e) => console.log("[social-inbox] log write failed", e));
  }
  if (!r.product_id) return { ok: true, matched: false };
  if (kind !== "dm") return { ok: true, matched: true, sent: false, reason: "comment_manual" };
  const send = await sendInstagramReply(env, accountIgId(account), author, r.reply_text);
  return { ok: true, matched: true, product_id: r.product_id, ...send };
}

export async function onRequestPost({ request, env }) {
  const raw = await request.text();
  const okSig = await verifySignature(env, raw, request.headers.get("x-hub-signature-256"));
  if (!okSig) return new Response("bad signature", { status: 403 });
  const body = JSON.parse(raw || "{}");
  const results = [];
  for (const entry of body.entry || []) {
    const account = accountForIgId(entry.id);
    if (account === "unknown") console.log(`[social-inbox] unmapped IG ID ${entry.id} — add to router ACCOUNTS`);
    for (const m of entry.messaging || []) {
      if (!m.message || m.message.is_echo || !m.message.mid) continue;
      results.push(await processInbound(env, {
        account, kind: "dm", author: m.sender?.id,
        author_name: null, text: m.message.text || "", ref_id: `dm:${m.message.mid}`,
      }));
    }
    for (const c of entry.changes || []) {
      const v = c.value || {};
      if (c.field !== "comments" || !v.id) continue;
      results.push(await processInbound(env, {
        account, kind: "comment", author: v.from?.id,
        author_name: v.from?.username, text: v.text || "", ref_id: `c:${v.id}`,
      }));
    }
  }
  return json({ ok: true, processed: results.length });
}
