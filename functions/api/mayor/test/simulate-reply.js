// /api/mayor/test/simulate-reply — POST-only test fixture.
//
// Inserts a fake inbound reply against a prospect so the Replies tab +
// pipeline funnel can be exercised without waiting for a real reply.
// Body: { prospect_id, classification, from_email?, subject?, body_excerpt? }
//
// classifications: interest|objection|unsubscribe|not_interested|out_of_office|warm|unclassified

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

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

const SAMPLES = {
  interest: {
    subject: "Re: Quick question for {BIZ}",
    body: "Hi Mehyar — saw your note. We're losing about 4-5 calls a week to voicemail. Can you do the audit next week? I'm owner {BIZ}, you can reach me at this email.\n\n— Owner",
  },
  objection: {
    subject: "Re: Quick question for {BIZ}",
    body: "Thanks but we already have a Squarespace subscription we're paying for. Don't need more vendors.",
  },
  unsubscribe: {
    subject: "unsubscribe",
    body: "Please remove me from your list.",
  },
  not_interested: {
    subject: "Re: Quick question for {BIZ}",
    body: "Not interested right now, maybe later in the year.",
  },
  out_of_office: {
    subject: "Out of office",
    body: "I'm out of the office until next Monday. Will respond when I return.",
  },
  warm: {
    subject: "Re: Quick question for {BIZ}",
    body: "Interesting timing — I'm not the right person but let me forward to my partner.",
  },
};

export async function onRequestPost({ request, env }) {
  if (!await bearerAccepted(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  if (!env?.LEADS_DB) {
    return json({ ok: false, error: "missing_db" }, 500, request, env);
  }

  let body = {};
  try { body = await request.json(); } catch {}
  const prospectId = body?.prospect_id;
  const classification = body?.classification || "interest";
  if (!prospectId) return json({ ok: false, error: "missing_prospect_id" }, 400, request, env);

  const db = env.LEADS_DB;
  const { results: prs } = await db.prepare(`SELECT id, business_name, email FROM prospects WHERE id = ?`).bind(prospectId).all();
  const prospect = prs?.[0];
  if (!prospect) return json({ ok: false, error: "prospect_not_found" }, 404, request, env);

  const sample = SAMPLES[classification] || SAMPLES.interest;
  const biz = prospect.business_name || "your business";
  const subject = body?.subject || sample.subject.replace("{BIZ}", biz);
  const bodyText = body?.body_excerpt || sample.body.replace("{BIZ}", biz);
  const fromEmail = body?.from_email || prospect.email || `owner@${prospectId}.example.com`;
  const replyId = crypto.randomUUID();

  try {
    await db.prepare(`
      INSERT INTO prospect_replies
        (id, prospect_id, send_id, received_at, from_email, subject,
         body_excerpt, classification, manually_synced, created_action)
      VALUES (?, ?, NULL, datetime('now'), ?, ?,
              ?, ?, 1, ?)
    `).bind(
      replyId,
      prospect.id,
      fromEmail,
      subject,
      bodyText,
      classification,
      classification === "unsubscribe" || classification === "stop" ? "suppression_added" : "note_appended",
    ).run();
  } catch (e) {
    return json({ ok: false, error: "reply_insert_failed", message: String(e?.message || e) }, 500, request, env);
  }

  // Update prospect status if it's an interest reply
  if (classification === "interest") {
    try {
      await db.prepare(`UPDATE prospects SET status = 'replied', updated_at = datetime('now') WHERE id = ?`).bind(prospect.id).run();
    } catch (_) {}
  } else if (classification === "unsubscribe" || classification === "stop") {
    try {
      await db.prepare(`UPDATE prospects SET status = 'unsubscribed', consent_state = 'unsubscribed', updated_at = datetime('now') WHERE id = ?`).bind(prospect.id).run();
    } catch (_) {}
  }

  // Audit event
  try {
    await db.prepare(`
      INSERT INTO mayor_events (id, kind, loop, summary, details_json, created_at)
      VALUES (?, 'followup', 'manual_simulate_reply', ?, ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      `Simulated reply from ${prospect.business_name} → ${classification}`,
      JSON.stringify({ reply_id: replyId, prospect_id: prospect.id, classification })
    ).run();
  } catch (_) {}

  return json({ ok: true, reply_id: replyId, prospect_id: prospect.id, classification, from_email: fromEmail, subject, body_excerpt: bodyText }, 200, request, env);
}