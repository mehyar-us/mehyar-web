// Shared Cloudflare Email Sending helper for Pages Functions.
//
// Uses the account-level Email Sending API
//   POST https://api.cloudflare.com/client/v4/accounts/{id}/email/sending/send
// with the X-Auth-Email + X-Auth-Key (Global Key) strategy, optionally falling
// back to a scoped bearer send token.
//
// This is the SAME path as functions/api/mayor/digest.js dispatchDigest(),
// verified working 2026-07-19 (provider_ids ending @mehyar.us). It replaces the
// never-actually-attached NOTIFY_EMAIL send_email binding (2026-09-14: the
// binding was absent in production; /api/audit/drip returned {"error":"no_email"}).
//
// Required env (already set on the mehyar-web Pages project):
//   CLOUDFLARE_EMAIL        account email for X-Auth-Email
//   CF_EMAIL_GLOBAL_KEY      37-char Global API key for X-Auth-Key
//   CF_EMAIL_SEND_TOKEN      (optional) scoped bearer token fallback
//   CF_EMAIL_ACCOUNT_ID      (optional) defaults to the mehyar account
//
// Usage:
//   import { sendCfEmail } from "../_shared/cfEmail.js";
//   const r = await sendCfEmail(env, { from: "audit@mehyar.us", to, subject, text, html });
//   // r = { ok: true, provider_id, auth_used } | { ok: false, error }

const DEFAULT_ACCOUNT_ID = "621600637337cc1c9ecb7095508bc732";

export async function sendCfEmail(env, { from, to, subject, text, html, replyTo } = {}) {
  const accountId = env?.CF_EMAIL_ACCOUNT_ID || DEFAULT_ACCOUNT_ID;
  const apiEmail = env?.CLOUDFLARE_EMAIL || env?.CF_EMAIL_API_EMAIL || "";
  const apiKey = env?.CF_EMAIL_GLOBAL_KEY || env?.CF_EMAIL_API_KEY || env?.CLOUDFLARE_API_TOKEN || "";
  const sendToken = env?.CF_EMAIL_SEND_TOKEN || "";

  const strategies = [];
  if (apiEmail && apiKey) {
    strategies.push({ name: "global_key", headers: { "X-Auth-Email": apiEmail, "X-Auth-Key": apiKey } });
  }
  if (sendToken) {
    strategies.push({ name: "bearer_send_token", headers: { Authorization: `Bearer ${sendToken}` } });
  }
  if (!strategies.length) {
    return { ok: false, error: "email_service_not_configured" };
  }
  if (!from || !to || !subject || (!text && !html)) {
    return { ok: false, error: "missing_fields" };
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`;
  const payload = { from, to, subject, reply_to: replyTo || undefined, text: text || undefined, html: html || undefined };

  let lastErr = "all_auth_strategies_failed";
  let lastData = null;
  for (const strat of strategies) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...strat.headers },
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));
      lastData = data;
      if (resp.ok && data?.success !== false) {
        return {
          ok: true,
          auth_used: strat.name,
          provider_id: data?.result?.message_id || null,
          delivered: data?.result?.delivered || [],
        };
      }
      const err = data?.errors?.[0]?.message || `HTTP ${resp.status}`;
      lastErr = `${strat.name}: ${err}`;
      // Auth errors fall through to next strategy; schema errors don't.
      if (!String(err).toLowerCase().includes("authentication") && resp.status !== 401 && resp.status !== 403) break;
    } catch (e) {
      lastErr = `${strat.name}: ${String(e?.message || e)}`;
    }
  }
  return { ok: false, error: lastErr, detail: lastData?.errors?.[0] || null };
}
