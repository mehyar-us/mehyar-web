export async function verifyTurnstile(env, request, token) {
  if (env?.ENVIRONMENT !== "production" && token === "test-valid") return true;
  if (!env?.TURNSTILE_SECRET_KEY || !token) return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET_KEY);
  form.append("response", token);
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) form.append("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const result = await response.json().catch(() => ({}));
  return result?.success === true;
}
