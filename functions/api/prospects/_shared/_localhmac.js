// Tiny wrapper so the route files don't repeat the HMAC key plumbing.
export async function hmacHex(env, value) {
  const secret = env?.HMAC_SECRET || env?.TURNSTILE_SECRET_KEY || (env?.ENVIRONMENT !== "production" ? "mehyar-web-local-hash-salt" : "");
  if (!secret) throw new Error("HMAC secret missing");
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}
