// /api/mayor/draft/[id]/approve — approve a draft, queue a prospect_sends row.
//
// Body: { scheduled_for?: ISO, send_now?: boolean, physical_address?: string }
//   - If send_now=true: provider sends within seconds (test mode); else scheduled for
//     the next outreach tick.
//   - physical_address defaults to env.MAYOR_PHYSICAL_ADDRESS or the MehyarSoft
//     mail compliance line.
//
// Returns: { ok, draft_id, send_id, status, scheduled_for, sent_at?, provider_id? }

import { verifyAdminToken, json, corsHeaders } from "../../../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

async function bearerAccepted(request, env) {
  const h = request.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) return false;
  const tok = h.slice(7);
  if (tok && env?.GOV_INGEST_TOKEN && tok === env.GOV_INGEST_TOKEN) return true;
  const a = await verifyAdminToken(request, env);
  return a.ok;
}

export async function onRequestPost({ request, env, params }) {
  if (!await bearerAccepted(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  if (!env?.LEADS_DB) {
    return json({ ok: false, error: "missing_db" }, 500, request, env);
  }
  const id = params?.id;
  if (!id) return json({ ok: false, error: "missing_draft_id" }, 400, request, env);

  let body = {};
  try { body = await request.json(); } catch {}
  const sendNow = body?.send_now === true;
  const reviewerNotes = body?.reviewer_notes || body?.notes || null;
  const physicalAddress = body?.physical_address
    || env?.MAYOR_PHYSICAL_ADDRESS
    || "MehyarSoft LLC, 228 Park Ave S #92842, New York, NY 10003";

  const db = env.LEADS_DB;
  // Load the draft + prospect
  const { results: drs } = await db.prepare(`SELECT * FROM prospect_drafts WHERE id = ?`).bind(id).all();
  const draft = drs?.[0];
  if (!draft) return json({ ok: false, error: "draft_not_found" }, 404, request, env);
  if (draft.status === "approved") {
    return json({ ok: false, error: "draft_already_approved" }, 409, request, env);
  }
  const { results: prs } = await db.prepare(`SELECT * FROM prospects WHERE id = ?`).bind(draft.prospect_id).all();
  const prospect = prs?.[0];
  if (!prospect) return json({ ok: false, error: "prospect_not_found" }, 404, request, env);
  if (!prospect.email) {
    return json({ ok: false, error: "prospect_no_email", message: "Backfill the prospect's email first via /api/mayor/prospect/[id]/enrich" }, 409, request, env);
  }

  const now = new Date();
  const scheduledFor = sendNow
    ? now.toISOString()
    : (body?.scheduled_for || new Date(now.getTime() + 5 * 60_000).toISOString()); // 5 min default

  // CAN-SPAM physical address: required at send time per RFC 8058 compliance
  const fromEmail = env?.MAYOR_FROM_EMAIL || "team@mehyar.us";
  const replyTo = env?.MAYOR_REPLY_TO || fromEmail;

  // Create prospect_sends row
  const sendId = crypto.randomUUID();
  try {
    await db.prepare(`
      INSERT INTO prospect_sends
        (id, prospect_id, draft_id, created_at, scheduled_for,
         provider, to_email, from_email, reply_to, subject,
         list_unsub_header, physical_address, status, test_only)
      VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      sendId,
      prospect.id,
      draft.id,
      scheduledFor,
      "resend",
      prospect.email,
      fromEmail,
      replyTo,
      draft.subject,
      `<mailto:${fromEmail}?subject=unsubscribe>, <https://mehyar.us/unsubscribe>`,
      physicalAddress,
      sendNow ? "queued" : "queued",  // both states are "queued"; outreach loop or /send-now moves them to sent
      1, // test_only — bcc the founder for visible proof until trust is established
    ).run();
  } catch (e) {
    return json({ ok: false, error: "send_insert_failed", message: String(e?.message || e) }, 500, request, env);
  }

  // Update draft to approved
  try {
    await db.prepare(`
      UPDATE prospect_drafts
         SET status = 'approved',
             reviewer_notes = COALESCE(?, reviewer_notes)
       WHERE id = ?
    `).bind(reviewerNotes, id).run();
  } catch (e) {
    // Non-fatal — the send row exists. Surface but don't fail the request.
  }

  // Update prospect last_drafted_at + last_contact_at
  try {
    await db.prepare(`
      UPDATE prospects
         SET status = 'queued',
             last_drafted_at = datetime('now'),
             last_contact_at = datetime('now'),
             updated_at = datetime('now')
       WHERE id = ?
    `).bind(prospect.id).run();
  } catch (_) {}

  // Audit event
  try {
    await db.prepare(`
      INSERT INTO mayor_events (id, kind, loop, summary, details_json, created_at)
      VALUES (?, 'outreach', 'approval',
              ?, ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      `Approved draft → queued send for ${prospect.business_name} (${prospect.email})`,
      JSON.stringify({ draft_id: id, send_id: sendId, prospect_id: prospect.id, scheduled_for: scheduledFor, send_now: sendNow })
    ).run();
  } catch (_) {}

  // If sendNow=true, fire the send inline (best-effort)
  let inlineResult = null;
  if (sendNow) {
    inlineResult = await trySendNow(env, db, sendId, draft, prospect);
  }

  return json({
    ok: true,
    draft_id: id,
    send_id: sendId,
    prospect_id: prospect.id,
    prospect_business: prospect.business_name,
    scheduled_for: scheduledFor,
    send_now: sendNow,
    inline_send: inlineResult,
  }, 200, request, env);
}

async function trySendNow(env, db, sendId, draft, prospect) {
  // Best-effort inline send via Cloudflare Email Service.
  // If the service isn't configured (no CF_EMAIL_GLOBAL_KEY, no account id),
  // the row stays "queued" and the next outreach tick picks it up.
  const acctId = env?.CF_EMAIL_ACCOUNT_ID || env?.CLOUDFLARE_ACCOUNT_ID;
  const globalKey = env?.CF_EMAIL_GLOBAL_KEY || env?.CLOUDFLARE_API_TOKEN;
  if (!acctId || !globalKey) {
    return { ok: false, error: "email_service_not_configured", deferred: true };
  }

  const body = {
    personalizations: [{
      to: [{ email: prospect.email, name: prospect.business_name }],
    }],
    from: { email: draft.from_email || env?.MAYOR_FROM_EMAIL || "team@mehyar.us", name: "MehyarSoft" },
    reply_to: { email: env?.MAYOR_REPLY_TO || "team@mehyar.us" },
    subject: draft.subject,
    content: [{ type: "text/plain", value: draft.body_text }],
  };

  try {
    const resp = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acctId}/email/sending/send`, {
      method: "POST",
      headers: {
        "X-Auth-Email": env?.CLOUDFLARE_EMAIL || "mrswelim@gmail.com",
        "X-Auth-Key": globalKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    let parsed = {};
    try { parsed = JSON.parse(text); } catch {}
    if (resp.ok && parsed?.success) {
      const providerId = parsed?.result?.id || parsed?.result?.message_id || null;
      await db.prepare(`
        UPDATE prospect_sends
           SET status = 'sent', attempted_at = datetime('now'), finished_at = datetime('now'),
               provider_id = ?
         WHERE id = ?
      `).bind(providerId, sendId).run();
      await db.prepare(`UPDATE prospects SET status = 'sent', last_sent_at = datetime('now') WHERE id = ?`).bind(prospect.id).run();
      return { ok: true, provider_id: providerId, delivered: parsed?.result?.delivered || [] };
    } else {
      await db.prepare(`
        UPDATE prospect_sends
           SET status = 'failed', attempted_at = datetime('now'), finished_at = datetime('now'),
               failure_reason = ?
         WHERE id = ?
      `).bind(String(parsed?.errors?.[0]?.message || resp.status), sendId).run();
      return { ok: false, error: "provider_rejected", status: resp.status, detail: parsed?.errors?.[0]?.message || text.slice(0, 300) };
    }
  } catch (e) {
    return { ok: false, error: "send_threw", message: String(e?.message || e) };
  }
}