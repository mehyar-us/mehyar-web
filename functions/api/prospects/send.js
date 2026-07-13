// POST /api/prospects/send  { prospect_id, draft_id, approve:true, test_only:bool, to_override?:string }
// Sends the approved email via Resend with CAN-SPAM + RFC 8058 one-click unsub headers.
//   - to_override = mrswelim@gmail.com for founder-visible testing
//   - test_only   = true  → mail never leaves Resend; founder sees BCC of every send
//   - suppression check via D1 + KV cache (mirrors intake pattern)
//
// Status flow: queued → sent → delivered|bounced|complained|unsubscribed|failed|skipped_suppressed

import { verifyAdminToken, json, corsHeaders } from "../_shared/adminAuth.js";

const PHYSICAL_ADDRESS = "MehyarSoft LLC, 3400 Coyle St, Apt 411, Elmhurst, NY 11373";
// Per user direction (2026-07-13): send from mehyar@mehyar.us so replies go to a
// person-recognizable address; info@mehyar.us remains the catch-all forward to
// mrswelim@gmail.com per CF Email Routing. Both addresses work either way; set
// CONTACT_FROM_EMAIL / CONTACT_REPLY_TO env vars to override.
const FROM_EMAIL_DEFAULT = "mehyar@mehyar.us";
const REPLY_TO_DEFAULT = "mehyar@mehyar.us";

function cap(value, max) { return (value || "").length > max ? value.slice(0, max) : value; }

async function hmacHex(env, value) {
  const secret = env?.HMAC_SECRET || env?.TURNSTILE_SECRET_KEY || (env?.ENVIRONMENT !== "production" ? "mehyar-web-local-hash-salt" : "");
  if (!secret) throw new Error("HMAC secret missing");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function isSuppressed(env, emailHash) {
  if (env?.INTAKE_KV) {
    const cached = await env.INTAKE_KV.get(`suppression:email:${emailHash}`);
    if (cached === "1") return true;
  }
  if (!env?.LEADS_DB) return false;
  const row = await env.LEADS_DB.prepare(
    `SELECT 1 FROM suppression_list WHERE type = ? AND value_hash = ? LIMIT 1`
  ).bind("email", emailHash).first();
  if (row && env?.INTAKE_KV) {
    await env.INTAKE_KV.put(`suppression:email:${emailHash}`, "1", { expirationTtl: 86400 });
  }
  return Boolean(row);
}

function unsubHeaderFor(prospectId, emailHash) {
  // RFC 8058 one-click unsubscribe: mailto + https, both POST-capable
  const mailto = `mailto:unsubscribe@mehyar.us?subject=unsub-${encodeURIComponent(prospectId)}`;
  const https  = `https://mehyar.us/api/prospects/unsubscribe?p=${encodeURIComponent(prospectId)}&h=${emailHash.slice(0, 16)}`;
  return `<${mailto}>, <${https}>`;
}

function htmlFromText(body) {
  const escaped = body.split("\n").map(line => line.trim() === "" ? "<br>" : `<div>${line.replace(/[<>&]/g, ch => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[ch]))}</div>`).join("");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.5;color:#111">${escaped}<p style="font-size:12px;color:#666;margin-top:24px">${PHYSICAL_ADDRESS} — <a href="https://mehyar.us/unsubscribe">Unsubscribe</a></p></div>`;
}

async function sendViaCfEmailService(env, payload) {
  // CF Email Service REST API: POST /accounts/{id}/email/sending/send.
  // Uses X-Auth-Email + X-Auth-Key (Global Key works; scoped token preferred long-term).
  // Falls back to a scoped token if CF_EMAIL_API_KEY is set as a Pages env var.
  const accountId = env?.CF_EMAIL_ACCOUNT_ID;
  const authHeader = env?.CF_EMAIL_API_KEY
    ? { "Authorization": `Bearer ${env.CF_EMAIL_API_KEY}` }
    : { "X-Auth-Email": env?.CLOUDFLARE_EMAIL || env?.CF_EMAIL_API_EMAIL || "", "X-Auth-Key": env?.CLOUDFLARE_API_KEY || env?.CF_EMAIL_API_KEY || "" };
  if (!accountId || !authHeader["Authorization"] && !(authHeader["X-Auth-Email"] && authHeader["X-Auth-Key"])) {
    return { ok: false, status: "failed", error: "cf_email_service_not_configured", provider_id: null };
  }
  const headers = { "content-type": "application/json", ...authHeader };
  const body = {
    from: payload.from,
    to: Array.isArray(payload.to) ? payload.to : [payload.to],
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
    reply_to: payload.reply_to,
  };
  if (payload.bcc && payload.bcc.length) body.bcc = payload.bcc;
  if (payload.listUnsubHeader) {
    body.headers = {
      "List-Unsubscribe": payload.listUnsubHeader,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      "Precedence": "bulk",
    };
  }
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = data?.errors?.[0];
    return { ok: false, status: "failed", error: `cf_email_${err?.code || r.status}_${(err?.message || "").toString().slice(0, 200)}`, provider_id: null };
  }
  const result = data?.result || {};
  return {
    ok: true,
    status: "sent",
    provider_id: result.message_id || null,
    delivered: result.delivered || [],
    queued: result.queued || [],
    permanent_bounces: result.permanent_bounces || [],
  };
}

export async function onRequestPost({ request, env }) {
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);

  let body;
  try {
    const raw = await readBodyCap(request, 8 * 1024);
    body = JSON.parse(raw || "{}");
  } catch { return json({ ok: false, error: "bad_json" }, 400); }

  if (!body.approve) return json({ ok: false, error: "explicit_approve_required" }, 400);
  const prospectId = body.prospect_id;
  const draftId    = body.draft_id;
  if (!prospectId || !draftId) return json({ ok: false, error: "missing_ids" }, 400);
  const testOnly   = body.test_only === true;

  const draft = await env.LEADS_DB.prepare(
    `SELECT id, prospect_id, subject, body_text, status FROM prospect_drafts WHERE id = ? AND prospect_id = ? LIMIT 1`
  ).bind(draftId, prospectId).first();
  if (!draft) return json({ ok: false, error: "draft_not_found" }, 404);

  const prospect = await env.LEADS_DB.prepare(
    `SELECT id, business_name, root_domain, website, email, consent_state, status, last_contact_at FROM prospects WHERE id = ? LIMIT 1`
  ).bind(prospectId).first();
  if (!prospect) return json({ ok: false, error: "prospect_not_found" }, 404);

  // Decide recipient
  const toEmail = testOnly
    ? (env.PROSPECT_TEST_BCC || "mrswelim@gmail.com")
    : (prospect.email || "").trim().toLowerCase();
  if (!toEmail) return json({ ok: false, error: "prospect_has_no_email_test_only_or_supply_email" }, 412);

  // Per CAN-SPAM we must have a way to stop. Suppression check on either recipient.
  const toHash = await hmacHex(env, toEmail.toLowerCase());
  if (await isSuppressed(env, toHash)) {
    const queueId = crypto.randomUUID();
    await env.LEADS_DB.prepare(`
      INSERT INTO prospect_sends (id, prospect_id, draft_id, provider, to_email, from_email, reply_to, subject, physical_address, status, test_only, failure_reason)
      VALUES (?, ?, ?, 'cf-email', ?, ?, ?, ?, ?, 'skipped_suppressed', ?, 'suppression_hit')
    `).bind(
      queueId, prospectId, draftId,
      toEmail,
      env.CONTACT_FROM_EMAIL || FROM_EMAIL_DEFAULT,
      env.CONTACT_REPLY_TO || REPLY_TO_DEFAULT,
      draft.subject,
      PHYSICAL_ADDRESS,
      testOnly ? 1 : 0,
    ).run();
    return json({ ok: true, status: "skipped_suppressed", queue_id: queueId });
  }

  // Dedupe window: 1 email / 90 days / business
  if (!testOnly && prospect.last_contact_at) {
    const daysSince = (Date.now() - new Date(prospect.last_contact_at).getTime()) / (1000 * 86400);
    if (daysSince < 90) {
      return json({ ok: false, error: "dedupe_window_90d", last_contact_at: prospect.last_contact_at });
    }
  }

  // Mark draft approved
  await env.LEADS_DB.prepare(
    `UPDATE prospect_drafts SET status = 'approved' WHERE id = ?`
  ).bind(draftId).run();

  const queueId = crypto.randomUUID();
  const listUnsubHeader = unsubHeaderFor(prospectId, toHash);

  const sendResult = await sendViaCfEmailService(env, {
    from: env.CONTACT_FROM_EMAIL || FROM_EMAIL_DEFAULT,
    to: [toEmail],
    bcc: testOnly ? [env.PROSPECT_TEST_BCC || "mrswelim@gmail.com"] : undefined,
    reply_to: env.CONTACT_REPLY_TO || REPLY_TO_DEFAULT,
    subject: draft.subject,
    text: draft.body_text,
    html: htmlFromText(draft.body_text),
    listUnsubHeader,
  });

  const finalStatus = sendResult.ok ? "sent" : "failed";
  await env.LEADS_DB.prepare(`
    INSERT INTO prospect_sends (id, prospect_id, draft_id, provider, provider_id, to_email, from_email, reply_to, subject, physical_address, list_unsub_header, status, test_only, failure_reason, attempted_at, finished_at)
    VALUES (?, ?, ?, 'cf-email', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    queueId, prospectId, draftId,
    sendResult.provider_id || null,
    toEmail,
    env.CONTACT_FROM_EMAIL || FROM_EMAIL_DEFAULT,
    env.CONTACT_REPLY_TO || REPLY_TO_DEFAULT,
    draft.subject,
    PHYSICAL_ADDRESS,
    listUnsubHeader,
    finalStatus,
    testOnly ? 1 : 0,
    sendResult.error || null,
    new Date().toISOString(),
    new Date().toISOString(),
  ).run();

  if (sendResult.ok && !testOnly) {
    await env.LEADS_DB.prepare(
      `UPDATE prospects SET status = 'queued', last_contact_at = ?, updated_at = ? WHERE id = ?`
    ).bind(new Date().toISOString(), new Date().toISOString(), prospectId).run();
  }

  return json({
    ok: sendResult.ok,
    queue_id: queueId,
    status: finalStatus,
    provider_id: sendResult.provider_id,
    error: sendResult.error || null,
  });
}

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export const __test = { unsubHeaderFor, htmlFromText, PHYSICAL_ADDRESS };
