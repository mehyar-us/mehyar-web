// /api/mayor/_shared/mayorEngine.js
// The actual email dispatcher. Wraps the existing CF Email service pattern
// from /api/prospects/send.js but tailored for the Mayor engine's automation.
//
// On success → updates prospect_sequences.status='sent' + inserts prospect_sends
// On failure → marks status='failed' with reason
//
// This is the "no human in the loop" send function — only call after canSendNow().

import { canSendNow, bumpDailySendCount } from "./mayorGuardrails.js";
import { logEvent } from "./mayorDb.js";

const PHYSICAL_ADDRESS = "MehyarSoft LLC, 3400 Coyle St, Apt 411, Elmhurst, NY 11373";
const FROM_EMAIL = "mehyar@mehyar.us";   // replies route to info@ via forwarding

// Same helper used by /api/prospects/send.js — kept here for symmetry.
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

  // Dispatch via CF Email service (mirrors /api/prospects/send.js)
  const result = await dispatchViaCfEmail(env, {
    to: toEmail,
    subject: sequence.subject,
    text: sequence.body_text,
  });

  const finalStatus = result.ok ? "sent" : "failed";
  const now = new Date().toISOString();

  // Record the send
  const sendId = crypto.randomUUID();
  try {
    await env.LEADS_DB.prepare(
      `INSERT INTO prospect_sends (id, prospect_id, draft_id, provider, provider_id, to_email,
         from_email, reply_to, subject, physical_address, list_unsub_header, status,
         test_only, failure_reason, attempted_at, finished_at)
       VALUES (?, ?, ?, 'cf-email', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    ).bind(
      sendId, sequence.prospect_id, sequence.id,
      result.provider_id || null,
      toEmail, FROM_EMAIL, FROM_EMAIL,
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
  try {
    await env.LEADS_DB.prepare(
      `UPDATE prospects SET status = 'contacted', last_contact_at = ?
       WHERE id = ?`
    ).bind(now, sequence.prospect_id).run();
  } catch (e) { /* ignore */ }

  // Bump daily counter + log event
  const today = now.slice(0, 10);
  await bumpDailySendCount(env, today);
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

async function dispatchViaCfEmail(env, { to, subject, text }) {
  const accountId = env?.CF_EMAIL_ACCOUNT_ID;
  // Email-send-specific token (preferred) — separate from CF_API_TOKEN
  // which lacks email-send scope. Set CF_EMAIL_SEND_TOKEN in Pages secrets.
  const emailSendToken = env?.CF_EMAIL_SEND_TOKEN || env?.CF_EMAIL_API_KEY;
  // Fallback: Global API key (X-Auth-Email + X-Auth-Key) — works if the
  // Global key has Email Routing Write permission.
  const apiEmail  = env?.CLOUDFLARE_EMAIL || env?.CF_EMAIL_API_EMAIL || "";
  const apiKey    = env?.CLOUDFLARE_API_KEY || env?.CF_EMAIL_API_KEY || "";

  if (!accountId || (!emailSendToken && !apiKey)) {
    return { ok: false, error: "email_service_not_configured" };
  }

// Build candidate auth strategies. We'll try them in order until one succeeds.
// ALWAYS try Bearer first, then fall back to Global Key, then fall back
// to either one more time (in case a flaky network caused the first failure).
const authStrategies = [];
if (emailSendToken) {
  authStrategies.push({ name: "bearer", headers: { "Authorization": `Bearer ${emailSendToken}` } });
}
if (apiEmail && apiKey) {
  authStrategies.push({ name: "global_key", headers: { "X-Auth-Email": apiEmail, "X-Auth-Key": apiKey } });
}
if (authStrategies.length === 0) {
  return { ok: false, error: "email_service_not_configured" };
}

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`;
  // Cloudflare Email Service REST API uses FLAT string fields (not nested objects).
  // See: https://developers.cloudflare.com/email-service/api/send-emails/rest-api/
  const payload = {
    from: FROM_EMAIL,
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
        return { ok: true, provider_id: data?.result?.id || null };
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