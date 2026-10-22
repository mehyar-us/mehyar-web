// Moonroom mail bridge (Mayor order 2026-10-22; TicketBeat rot520 pattern).
//
// The mehyar-web project's CLOUDFLARE_API_KEY / CF_EMAIL_GLOBAL_KEY secrets
// are EMPTY in the production runtime, so the shared helper's x-auth-key
// path returns not_configured and every Moonroom buyer email has silently
// failed since launch (email_ok:false on every order). When the scoped
// MOONROOM_MAIL_TOKEN secret is present — an API token minted with only
// the "Email Sending Write" permission, account scope — send through the
// same Email Sending API with Bearer auth (the cancel-lookup route,
// probe-verified 200/queued with real delivery). Absent the token, fall
// back to the shared helper in case the project keys are ever restored.
// Used ONLY by Moonroom's send sites (fulfill-callback, fulfillMoonroom);
// other products keep the shared helper untouched.
import { sendCloudflareEmail } from "./cloudflareEmail.js";

export async function sendBridgedEmail(env, message) {
  if (env.MOONROOM_MAIL_TOKEN) {
    try {
      const accountId = env.CF_EMAIL_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID;
      const r = await fetch(
        "https://api.cloudflare.com/client/v4/accounts/" +
          encodeURIComponent(accountId) +
          "/email/sending/send",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer " + env.MOONROOM_MAIL_TOKEN,
          },
          body: JSON.stringify({
            to: message.to,
            from: { address: message.from, name: message.fromName },
            reply_to: message.replyTo,
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
          signal: AbortSignal.timeout(20000),
        }
      );
      const payload = await r.json().catch(() => ({}));
      if (r.ok && payload?.success !== false) {
        const delivered = Array.isArray(payload?.result?.delivered)
          ? payload.result.delivered
          : [];
        const queued = Array.isArray(payload?.result?.queued)
          ? payload.result.queued
          : [];
        return {
          ok: true,
          status: delivered.length
            ? "delivered"
            : queued.length
              ? "queued"
              : "accepted",
        };
      }
      const firstError = Array.isArray(payload?.errors) ? payload.errors[0] : null;
      return {
        ok: false,
        status: "cloudflare_email_" + r.status,
        error: String(firstError?.message || "cloudflare_email_send_failed").slice(0, 300),
      };
    } catch (e) {
      return {
        ok: false,
        status: "send_exception",
        error: String(e && e.message).slice(0, 300),
      };
    }
  }
  return sendCloudflareEmail(env, message);
}
