// /api/mayor/_shared/mayorEngine.js
// The actual email dispatcher. Wraps the existing CF Email service pattern
// from /api/prospects/send.js but tailored for the Mayor engine's automation.
//
// On success → updates prospect_sequences.status='sent' + inserts prospect_sends
// On failure → marks status='failed' with reason
//
// This is the auto-send function — only call after canSendNow() and the
// production review/auto-send mode gate have passed.

import { canSendNow, bumpDailySendCount } from "./mayorGuardrails.js";
import { logEvent } from "./mayorDb.js";
const PHYSICAL_ADDRESS = "MehyarSoft LLC, 3400 Coyle St, Apt 411, Elmhurst, NY 11373";

// Defaults resolved per-call from env (env is not in module scope at import time).
function resolveSendingFrom(env) {
  const domain = env?.MAYOR_SENDING_DOMAIN || "rochelle.love";
  return env?.MAYOR_SENDING_FROM_EMAIL || `team@${domain}`;
}

function resolveSender(env) {
  const fromEmail = env?.MAYOR_FROM_EMAIL || env?.MAYOR_SENDING_FROM_EMAIL || resolveSendingFrom(env);
  const replyTo = env?.MAYOR_REPLY_TO || fromEmail;
  return { fromEmail, replyTo };
}
function htmlFromText(body) {
  const escaped = body.split("\n").map(line =>
    line.trim() === "" ? "<br>"
    : `<div>${line.replace(/[<>&]/g, ch => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[ch]))}</div>`
  ).join("");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.5;color:#111">${escaped}<p style="font-size:12px;color:#666;margin-top:24px">${PHYSICAL_ADDRESS} — <a href="https://mehyar.us/unsubscribe">Unsubscribe</a></p></div>`;
}

// ── Send one queued sequence step ─────────────────────────────────────────

export async function sendSequenceStep(env, { sequence, prospect }) {
  if (!env?.LEADS_DB) return { ok: false, error: "missing_db" };
  const toEmail = (prospect?.email || "").toLowerCase().trim();
  const { fromEmail, replyTo } = resolveSender(env);

  // Final guard check (may have changed since schedule time)
  const guard = await canSendNow(env, toEmail);
  if (!guard.ok) {
    await env.LEADS_DB.prepare(
      `UPDATE prospect_sequences
       SET status = 'skipped', sent_at = ?
       WHERE id = ?`
    ).bind(new Date().toISOString(), sequence.id).run();
    await logEvent(env, "outreach", `Skipped ${toEmail}: ${guard.reason}`, {
      loop: "outreach",
      details: { sequence_id: sequence.id, prospect_id: sequence.prospect_id, reason: guard.reason },
    });
    return { ok: false, reason: guard.reason };
  }

  // Priority: Resend (free tier works with verified domains, no account upgrade needed)
  // → CF Email Service (requires paid account, disabled on free tier)
  // → No-op (log error)
  let result = null;
  const resendKey = env?.RESEND_API_KEY;
  if (resendKey) {
    const r = await dispatchViaResend(env, {
      to: toEmail,
      subject: sequence.subject,
      text: sequence.body_text,
    });
    console.log(`[mayor/email] resend(${toEmail}) -> ${JSON.stringify(r)}`);
    if (r.ok) result = r;
    else console.log(`[mayor/email] resend failed, falling back to CF: ${r.error}`);
  }

  if (!result) {
    // Dispatch via CF Email service (requires paid account with Email Sending enabled)
    result = await dispatchViaCfEmail(env, {
      to: toEmail,
      subject: sequence.subject,
      text: sequence.body_text,
    });
  }

  const finalStatus = result.ok ? "sent" : "failed";
  const now = new Date().toISOString();

  // Record the send
  const sendId = crypto.randomUUID();
  try {
    await env.LEADS_DB.prepare(
      `INSERT INTO prospect_sends (id, prospect_id, draft_id, provider, provider_id, to_email,
         from_email, reply_to, subject, physical_address, list_unsub_header, status,
         test_only, failure_reason, attempted_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    ).bind(
      sendId, sequence.prospect_id, sequence.id,
      result.provider || "cf-email",
      result.provider_id || null,
      toEmail, fromEmail, replyTo,
      sequence.subject, PHYSICAL_ADDRESS,
      "<mailto:unsubscribe@mehyar.us>, <https://mehyar.us/api/prospects/unsubscribe>",
      finalStatus,
      result.error || null,
      now, now,
    ).run();
  } catch (e) { /* table may not exist yet */ }

  await env.LEADS_DB.prepare(
    `UPDATE prospect_sequences
     SET status = ?, sent_at = ?, send_id = ?
     WHERE id = ?`
  ).bind(finalStatus, now, sendId, sequence.id).run();

  // Update prospect state
  if (result.ok) {
    try {
      await env.LEADS_DB.prepare(
        `UPDATE prospects SET status = 'contacted', last_contact_at = ?
         WHERE id = ?`
      ).bind(now, sequence.prospect_id).run();
    } catch (e) { /* ignore */ }
  }

  // Bump daily counter only for actual sends + log event
  const today = now.slice(0, 10);
  if (result.ok) await bumpDailySendCount(env, today);
  await logEvent(env, "outreach",
    `${finalStatus === "sent" ? "✉ Sent" : "❌ Failed"} → ${toEmail} (step ${sequence.step_no})`,
    {
      loop: finalStatus === "sent" ? "outreach" : "followup",
      details: {
        sequence_id: sequence.id,
        prospect_id: sequence.prospect_id,
        step_no: sequence.step_no,
        subject: sequence.subject,
        provider_id: result.provider_id || null,
        error: result.error || null,
      },
    });

  return { ok: result.ok, send_id: sendId, status: finalStatus, error: result.error || null };
}

// ── CF Email service dispatcher ────────────────────────────────────────────

async function dispatchViaResend(env, { to, subject, text, html }) {
  const apiKey = env?.RESEND_API_KEY;
  const fromEmail = env?.RESEND_FROM_EMAIL || env?.MAYOR_FROM_EMAIL || resolveSendingFrom(env);
  if (!apiKey) return { ok: false, error: "resend_not_configured" };

  // Resend REST API: https://resend.com/docs/api-reference/emails/send-email
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `Mehyar <${fromEmail}>`,
        to: [to],
        subject,
        text,
        html: html || htmlFromText(text),
        headers: {
          "List-Unsubscribe": "<mailto:unsubscribe@mehyar.us>",
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.ok && data?.id) {
      return { ok: true, provider: "resend", provider_id: data.id };
    }
    const err = data?.message || data?.name || `HTTP ${resp.status}`;
    return { ok: false, error: `resend_${resp.status}: ${err}` };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

async function dispatchViaCfEmail(env, { to, subject, text }) {
  const accountId = env?.CF_EMAIL_ACCOUNT_ID;
  const { fromEmail } = resolveSender(env);
  // Auth strategy — X-Auth-Email + X-Auth-Key with the 37-char CF Global Key is the
  // ONLY pattern that authenticates against /accounts/{id}/email/sending/send today.
  // Verified 2026-07-19: the 40-char scoped CLOUDFLARE_API_KEY returns 401 "Authentication
  // error" when sent as either Authorization: Bearer OR X-Auth-Key. The Global Key works
  // only as X-Auth-Key. Source-of-truth: ~/.hermes/.env: CLOUDFLARE_API_TOKEN (37 chars).
  const apiEmail  = env?.CLOUDFLARE_EMAIL || env?.CF_EMAIL_API_EMAIL || "";
  const apiKey    = env?.CF_EMAIL_GLOBAL_KEY || env?.CF_EMAIL_API_KEY || env?.CLOUDFLARE_API_TOKEN || "";
  // Optional Bearer fallback for a scoped email-send token (40-char). Set in Dashboard.
  const emailSendToken = env?.CF_EMAIL_SEND_TOKEN || "";

  if (!accountId || (!apiKey && !emailSendToken)) {
    return { ok: false, error: "email_service_not_configured" };
  }

// Build candidate auth strategies. Prefer Global Key (X-Auth headers) — this is the
// ONLY one that currently authenticates per the 2026-07-19 test. Bearer is fallback
// for a future scoped email-send token if it's ever set in Dashboard.
const authStrategies = [];
if (apiEmail && apiKey) {
  authStrategies.push({ name: "global_key", headers: { "X-Auth-Email": apiEmail, "X-Auth-Key": apiKey } });
}
if (emailSendToken) {
  authStrategies.push({ name: "bearer", headers: { "Authorization": `Bearer ${emailSendToken}` } });
}
if (authStrategies.length === 0) {
  return { ok: false, error: "email_service_not_configured" };
}

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`;
  // Cloudflare Email Service REST API uses FLAT string fields (not nested objects).
  // See: https://developers.cloudflare.com/email-service/api/send-emails/rest-api/
  const payload = {
    from: fromEmail,
    to,
    subject,
    text,
    html: htmlFromText(text),
    headers: {
      "List-Unsubscribe": "<mailto:unsubscribe@mehyar.us>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
  try {
    let lastErr = null;
    for (const strat of authStrategies) {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...strat.headers },
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.success !== false) {
        console.log(`[mayor/email] sent via ${strat.name} to ${to}`);
        return { ok: true, provider: "cf-email", provider_id: data?.result?.id || null };
      }
      const err = data?.errors?.[0]?.message || `HTTP ${resp.status}`;
      lastErr = `${strat.name}: ${err}`;
      console.log(`[mayor/email] ${strat.name} failed (${to}): ${err}`);
      // Auth errors fall through to next strategy; schema errors don't
      if (!String(err).toLowerCase().includes("authentication") &&
          resp.status !== 401 && resp.status !== 403) {
        return { ok: false, error: err };
      }
    }
    return { ok: false, error: lastErr || "all_auth_strategies_failed" };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
