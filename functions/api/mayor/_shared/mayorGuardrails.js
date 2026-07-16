// /api/mayor/_shared/mayorGuardrails.js
// Safety policy for the Mayor engine. All caps, throttles, suppression
// checks, and PII sanitization live here.

import { getSetting } from "./mayorDb.js";

const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

async function hmacHex(env, value) {
  const secret = env?.HMAC_SECRET || env?.TURNSTILE_SECRET_KEY || (env?.ENVIRONMENT !== "production" ? "mehyar-web-local-hash-salt" : "");
  if (!secret) throw new Error("HMAC secret missing");
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Suppression (mirrors prospects/send.js pattern) ────────────────────────

export async function isEmailSuppressed(env, email) {
  const lc = String(email || "").toLowerCase().trim();
  if (!lc || !lc.includes("@")) return true; // invalid email treated as suppressed
  const hash = await hmacHex(env, lc);
  if (!SHA256_HEX_RE.test(hash)) return true;
  if (env?.INTAKE_KV) {
    const cached = await env.INTAKE_KV.get(`suppression:email:${hash}`);
    if (cached === "1") return true;
  }
  if (env?.LEADS_DB) {
    const row = await env.LEADS_DB.prepare(
      `SELECT 1 FROM suppression_list WHERE type = ? AND value_hash = ? LIMIT 1`
    ).bind("email", hash).first();
    if (row) {
      if (env?.INTAKE_KV) await env.INTAKE_KV.put(`suppression:email:${hash}`, "1", { expirationTtl: 86400 });
      return true;
    }
  }
  return false;
}

// ── Daily cap ──────────────────────────────────────────────────────────────

export async function getDailySendCount(env, dateYmd) {
  if (!env?.LEADS_DB) return 0;
  const row = await env.LEADS_DB.prepare(
    `SELECT value FROM mayor_settings WHERE key = ?`
  ).bind("daily_send_date").first();
  const storedDate = row?.value || "";
  if (storedDate !== dateYmd) return 0;
  const cnt = await env.LEADS_DB.prepare(
    `SELECT value FROM mayor_settings WHERE key = ?`
  ).bind("daily_sent_count").first();
  return parseInt(cnt?.value || "0", 10);
}

export async function bumpDailySendCount(env, dateYmd) {
  const cur = await getDailySendCount(env, dateYmd);
  await env.LEADS_DB.prepare(
    `UPDATE mayor_settings SET value = ?, updated_at = datetime('now') WHERE key = ?`
  ).bind(String(cur + 1), "daily_sent_count").run();
  await env.LEADS_DB.prepare(
    `UPDATE mayor_settings SET value = ?, updated_at = datetime('now') WHERE key = ?`
  ).bind(dateYmd, "daily_send_date").run();
}

// ── Caps (with warmup ramp) ───────────────────────────────────────────────

export async function getDailyCap(env) {
  const warmupDay = parseInt(await getSetting(env, "warmup_day", "0"), 10);
  const cap = warmupDay >= 14 ? 100 : 25;
  return cap;
}

export async function isOverCap(env) {
  const today = new Date().toISOString().slice(0, 10);
  const sent = await getDailySendCount(env, today);
  const cap = await getDailyCap(env);
  return sent >= cap;
}

export async function capRemaining(env) {
  const today = new Date().toISOString().slice(0, 10);
  const sent = await getDailySendCount(env, today);
  const cap = await getDailyCap(env);
  return Math.max(0, cap - sent);
}

// ── Per-domain throttle (≤3/day, ≤10/week) ────────────────────────────────

export async function countSendsToDomain(env, domain, sinceIso) {
  if (!env?.LEADS_DB || !domain) return 0;
  const { results } = await env.LEADS_DB.prepare(
    `SELECT COUNT(*) as n FROM prospect_sends
     WHERE to_email LIKE ? AND attempted_at >= ?`
  ).bind(`%@${domain}`, sinceIso).all();
  return results?.[0]?.n || 0;
}

// ── Bounce rate ───────────────────────────────────────────────────────────

export async function recentBounceRate(env, daysBack = 3) {
  if (!env?.LEADS_DB) return 0;
  const since = new Date(Date.now() - daysBack * 86400000).toISOString();
  const r = await env.LEADS_DB.prepare(
    `SELECT
       SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) AS bounced,
       COUNT(*) AS total
     FROM prospect_sends WHERE attempted_at >= ?`
  ).bind(since).first();
  if (!r || !r.total) return 0;
  return (r.bounced || 0) / r.total;
}

// ── PII sanitizer (passed to LLM before emails drafted) ───────────────────

const PII_PATTERNS = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]"],
  [/\b(?:\d[ -]*?){13,16}\b/g, "[card]"],
  [/\b\d{3}-\d{2}-\d{4}\b/g, "[ssn]"],
  [/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, "[phone]"],
];

export function sanitize(text) {
  let out = String(text || "");
  for (const [pat, repl] of PII_PATTERNS) out = out.replace(pat, repl);
  return out;
}

// ── Composite guard: can we send? ──────────────────────────────────────────

export async function canSendNow(env, toEmail) {
  const lc = String(toEmail || "").toLowerCase().trim();
  if (!lc || !lc.includes("@") || !lc.includes(".")) return { ok: false, reason: "invalid_email" };
  if (await isEmailSuppressed(env, lc)) return { ok: false, reason: "suppressed" };
  if (await isOverCap(env)) return { ok: false, reason: "daily_cap_reached" };

  const bounce = await recentBounceRate(env, 3);
  const threshold = parseFloat(await getSetting(env, "bounce_rate_alert", "0.10"));
  if (bounce > threshold) return { ok: false, reason: "high_bounce_rate" };

  const domain = lc.split("@")[1];
  const today = new Date().toISOString();
  const dayCount = await countSendsToDomain(env, domain, today.slice(0, 10));
  if (dayCount >= 3) return { ok: false, reason: "domain_throttle_day" };
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const weekCount = await countSendsToDomain(env, domain, weekAgo);
  if (weekCount >= 10) return { ok: false, reason: "domain_throttle_week" };

  return { ok: true };
}