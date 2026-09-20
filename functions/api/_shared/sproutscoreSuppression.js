// functions/api/_shared/sproutscoreSuppression.js
// Per-product suppression helpers for SproutScore.
//
// Mayor's 2026-09-19 order: every product has one-click unsubscribe with
// per-product suppression, reflected in the GLOBAL table. Per-product state
// lives in sproutscore_suppressions; the global mirror lives in
// suppression_list (same HMAC derivation as
// functions/api/suppressions/unsubscribe.js so both tables agree).

async function hmacSha256(env, value) {
  const secret = env?.HMAC_SECRET || env?.TURNSTILE_SECRET_KEY || (env?.ENVIRONMENT !== "production" ? "mehyar-web-local-hash-salt" : "");
  if (!secret) throw new Error("HMAC secret missing");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase().slice(0, 254);
}

export function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Write both the per-product suppression and the global suppression_list.
// Idempotent (INSERT OR IGNORE on both).
export async function suppressEmail(db, env, email, reason = "unsubscribe_request", source = "sproutscore") {
  const em = normalizeEmail(email);
  if (!validEmail(em)) return { ok: false, error: "invalid_email" };
  await db.prepare(
    "INSERT OR IGNORE INTO sproutscore_suppressions (email, reason, source) VALUES (?, ?, ?)"
  ).bind(em, String(reason).slice(0, 120), String(source).slice(0, 120)).run();
  try {
    const valueHash = await hmacSha256(env, em);
    await db.prepare(
      "INSERT OR IGNORE INTO suppression_list (id, type, value_hash, reason, source) VALUES (?, 'email', ?, ?, ?)"
    ).bind(crypto.randomUUID(), valueHash, String(reason).slice(0, 120), String(source).slice(0, 120)).run();
  } catch (e) {
    console.error("sproutscoreSuppression global mirror failed", e && e.message);
  }
  return { ok: true, email: em };
}

// Check suppression before any PRODUCT-FUNCTIONAL (non-transactional) send.
// Transactional buyer emails (receipt, report-ready) always send — a paid
// buyer must get what they paid for even if they unsubscribed from updates.
export async function isSuppressed(db, env, email) {
  const em = normalizeEmail(email);
  if (!validEmail(em)) return false;
  const row = await db.prepare("SELECT email FROM sproutscore_suppressions WHERE email = ?").bind(em).first().catch(() => null);
  if (row) return true;
  try {
    const valueHash = await hmacSha256(env, em);
    const g = await db.prepare("SELECT id FROM suppression_list WHERE type='email' AND value_hash = ?").bind(valueHash).first();
    return !!g;
  } catch {
    return false;
  }
}
