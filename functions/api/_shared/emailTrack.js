// functions/api/_shared/emailTrack.js
// Shared helpers for the mehyar.us email warmup campaign tracking endpoints.
// Token scheme (per-campaign secret, no env secret dependency):
//   token = HMAC-SHA256(campaign.secret, "email:" + send_id).hexdigest()[:16]
//
// Python equivalent for the sender:
//   import hmac, hashlib
//   token = hmac.new(secret.encode(), f"email:{send_id}".encode(), hashlib.sha256).hexdigest()[:16]
//
// URL patterns the sender generates:
//   open:        https://mehyar.us/api/email/open?m=<send_id>&t=<token>
//   click:       https://mehyar.us/api/email/click?m=<send_id>&t=<token>&u=<base64url(target)>
//   unsubscribe: https://mehyar.us/api/email/unsubscribe?m=<send_id>&t=<token>
//   confirm:     same as click, but u = base64url("CONFIRM")  -> sets status='confirmed'
// base64url = standard base64 with +/ -> -_ and padding stripped.

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return hex(sig);
}

/** Mint a 16-hex-char token for a send_id using the campaign's secret. */
export async function signSendId(sendId, campaignSecret) {
  const full = await hmacHex(String(campaignSecret), "email:" + String(sendId));
  return full.slice(0, 16);
}

/** Constant-time token check. Returns true only on an exact match. */
export async function verifySendId(sendId, token, campaignSecret) {
  const t = String(token || "").toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(t)) return false;
  if (!campaignSecret) return false;
  const expected = await signSendId(sendId, campaignSecret);
  if (expected.length !== t.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ t.charCodeAt(i);
  return diff === 0;
}

/**
 * Resolve a send_id to its campaign secret + audience row.
 * Returns { sendId, campaignId, audienceId, campaignSecret, audienceStatus } or null.
 */
export async function getSendContext(env, sendId) {
  const id = Number(sendId);
  if (!env?.LEADS_DB || !Number.isInteger(id) || id <= 0) return null;
  const row = await env.LEADS_DB.prepare(
    "SELECT s.id AS send_id, s.campaign_id, s.audience_id, c.secret AS campaign_secret, a.status AS audience_status " +
      "FROM email_send_log s " +
      "JOIN email_campaign c ON c.id = s.campaign_id " +
      "JOIN email_audience a ON a.id = s.audience_id " +
      "WHERE s.id = ? LIMIT 1"
  )
    .bind(id)
    .first();
  if (!row || !row.campaign_secret) return null;
  return {
    sendId: row.send_id,
    campaignId: row.campaign_id,
    audienceId: row.audience_id,
    campaignSecret: row.campaign_secret,
    audienceStatus: row.audience_status,
  };
}

/** Append an event row (open|click|unsubscribe|bounce|complaint). */
export async function logEvent(env, sendId, kind, meta) {
  if (!env?.LEADS_DB) return;
  await env.LEADS_DB.prepare("INSERT INTO email_event_log (send_id, kind, meta) VALUES (?, ?, ?)")
    .bind(Number(sendId), String(kind), JSON.stringify(meta || {}))
    .run();
}

// Status is sticky: terminal states and higher engagement are never downgraded.
const STATUS_RANK = { pending: 0, sent: 1, opened: 2, clicked: 3, confirmed: 4 };
const TERMINAL = new Set(["unsubscribed", "bounced", "complaint"]);

/** Move audience status forward only (never downgrade, never leave terminal states). */
export async function setAudienceStatus(env, audienceId, next) {
  if (!env?.LEADS_DB || !audienceId) return;
  const cur = await env.LEADS_DB.prepare("SELECT status FROM email_audience WHERE id = ?")
    .bind(audienceId)
    .first();
  const curStatus = (cur && cur.status) || "pending";
  if (TERMINAL.has(curStatus)) return;
  if (next === "unsubscribed" || next === "bounced" || next === "complaint") {
    await env.LEADS_DB.prepare("UPDATE email_audience SET status = ? WHERE id = ?")
      .bind(next, audienceId)
      .run();
    return;
  }
  const curRank = STATUS_RANK[curStatus] ?? 0;
  const nextRank = STATUS_RANK[next] ?? 0;
  if (nextRank > curRank) {
    await env.LEADS_DB.prepare("UPDATE email_audience SET status = ? WHERE id = ?")
      .bind(next, audienceId)
      .run();
  }
}

/** Decode a base64url string. Returns null on garbage. */
export function fromBase64Url(s) {
  try {
    const b64 = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** SSRF guard: allow only public http(s) targets. Returns normalized URL or null. */
export function safeRedirectTarget(raw) {
  let u = String(raw || "").trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) return null;
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(parsed.protocol)) return null;
  const host = parsed.hostname.toLowerCase();
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/.test(host)) return null;
  if (host.endsWith(".local") || host === "localhost") return null;
  return parsed.toString();
}
