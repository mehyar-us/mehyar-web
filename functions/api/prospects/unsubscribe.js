// GET  /api/prospects/unsubscribe?p=<prospect_id>&h=<email_hash_prefix>
// POST /api/prospects/unsubscribe  { prospect_id, email }   -- from List-Unsubscribe one-click
// Always confirms.
import { hmacHex as _hmacHex } from "./_shared/_localhmac.js";

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}
const HTML = (msg) => new Response(`<!DOCTYPE html><meta charset="utf-8">
<title>Unsubscribed · MehyarSoft</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:480px;margin:48px auto;padding:0 16px}</style>
<h1>${msg}</h1>
<p>We honor every unsubscribe request. If you no longer wish to receive future emails, you won't.</p>
<p><a href="https://mehyar.us/unsubscribe">Manage preferences</a> · <a href="https://mehyar.us">mehyar.us</a></p>`,
  { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

function cap(value, max) { return (value || "").length > max ? value.slice(0, max) : value; }

async function handleUnsubscribe(env, prospectId, email) {
  if (!env?.LEADS_DB || !prospectId || !email) return json({ ok: false, error: "missing_args" }, 400);
  const id = crypto.randomUUID();
  const valueHash = await _hmacHex(env, email.toLowerCase());
  // Dedup-on-conflict via unique index
  try {
    await env.LEADS_DB.prepare(
      `INSERT INTO suppression_list (id, type, value_hash, reason, source) VALUES (?, 'email', ?, 'opt_out', 'prospect_unsub')`
    ).bind(id, valueHash).run();
  } catch (e) { /* already exists */ }
  // Mark prospect unsubscribed if we can match
  await env.LEADS_DB.prepare(
    `UPDATE prospects SET status = 'unsubscribed', updated_at = datetime('now') WHERE id = ?`
  ).bind(prospectId).run();
  // KV fast path for intake/suppression checks
  if (env?.INTAKE_KV) {
    await env.INTAKE_KV.put(`suppression:email:${valueHash}`, "1", { expirationTtl: 86400 * 365 });
  }
  // Queue reply event for analytics
  await env.LEADS_DB.prepare(`
    INSERT INTO prospect_replies (id, prospect_id, from_email, subject, body_excerpt, classification, manually_synced, created_action)
    VALUES (?, ?, ?, 'unsubscribe', NULL, 'unsubscribe', 0, 'suppression_added')
  `).bind(crypto.randomUUID(), prospectId, email.toLowerCase()).run();
  return json({ ok: true });
}

export async function onRequestGet({ request, env }) {
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500);
  const u = new URL(request.url);
  const prospectId = u.searchParams.get("p");
  const hashPrefix = u.searchParams.get("h");
  if (!prospectId) return HTML("Missing prospect reference.");
  // Resolve prospect's last known email from sends
  const row = await env.LEADS_DB.prepare(
    `SELECT email FROM prospects WHERE id = ? LIMIT 1`
  ).bind(prospectId).first();
  const email = row?.email;
  if (!email) return HTML("We could not match your subscription. Please reply STOP to any email you received.");
  await handleUnsubscribe(env, prospectId, email);
  return HTML("You are unsubscribed.");
}

export async function onRequestPost({ request, env }) {
  let body = {};
  try {
    const reader = request.body.getReader();
    const chunks = [];
    let total = 0;
    while (total < 8 * 1024) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
    body = JSON.parse(new TextDecoder().decode(out) || "{}");
  } catch { body = {}; }
  return handleUnsubscribe(env, body.prospect_id, body.email);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  }});
}
