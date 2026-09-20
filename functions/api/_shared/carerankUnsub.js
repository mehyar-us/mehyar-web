// functions/api/_shared/carerankUnsub.js
// Shared one-click unsubscribe tokens for CareRank (brand-level list).
//
// token = HMAC-SHA256(lowercase-email, CARERANK_UNSUB_SECRET) as lowercase hex.
// The secret is a DASHBOARD-ONLY env var on the mehyar-web Pages project
// (never committed). Links point at /api/carerank/unsubscribe which honors
// RFC 8058: the GET itself unsubscribes immediately.

const UNSUB_PATH = "https://mehyar.us/api/carerank/unsubscribe";

export function carerankUnsubSecret(env) {
  return (env && env.CARERANK_UNSUB_SECRET) || "";
}

export async function signCarerankUnsub(email, secret) {
  const msg = String(email || "").trim().toLowerCase();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(secret || "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyCarerankUnsub(email, token, secret) {
  if (!secret || !token) return false;
  const expected = await signCarerankUnsub(email, secret);
  const given = String(token);
  if (expected.length !== given.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  }
  return diff === 0;
}

// Returns the full one-click URL, or "" when no secret is configured
// (callers must still send the mail; they log the missing secret).
export async function carerankUnsubUrl(env, email) {
  const secret = carerankUnsubSecret(env);
  if (!secret) return "";
  const clean = String(email || "").trim().toLowerCase();
  const t = await signCarerankUnsub(clean, secret);
  return `${UNSUB_PATH}?e=${encodeURIComponent(clean)}&t=${t}`;
}

// RFC 8058 headers for transactional mail sent via sendCloudflareEmail
// (it forwards `headers` to the Cloudflare email API).
export function carerankListUnsubscribeHeaders(unsubUrl) {
  if (!unsubUrl) return undefined;
  return {
    "List-Unsubscribe": `<${unsubUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
