// /api/admin/leads/[id]/messages-inbound — owner-paste hook for inbound replies.
//
// Real inbound mail parsing requires wiring CF Email Routing forward-to-worker
// and parsing MIME. We don't have that plumbing yet, so this endpoint is the
// safe path: from the admin UI the owner can paste in an inbound reply they
// received (subject, body, from), we persist it as a prospect_messages row
// and link it back to the prospect.
//
// When the CF Email Routing webhook lands, the same code path will be used
// (just with parsed body instead of pasted fields).
//
// Also handles incoming classification results from the LLM.

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
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const leadId = params?.id;
  const body = await request.json().catch(() => ({}));
  const now = new Date().toISOString();
  const messageId = `<${crypto.randomUUID()}@${request.headers.get("host") || "mehyar.us"}>`;

  const fromEmail = String(body.from_email || "").trim();
  const subject = String(body.subject || "").slice(0, 240);
  const bodyText = String(body.body_text || "").slice(0, 8000);
  if (!fromEmail || !subject) {
    return json({ ok: false, error: "missing_from_or_subject" }, 400, request, env);
  }

  // Look up the lead's email so we can decide whether fromEmail is the
  // "matching partner" (a reply to our sequence) or a cold inbound.
  let leadEmail = null;
  for (const table of ["prospects", "gov_opportunities"]) {
    try {
      const r = await env.LEADS_DB.prepare(
        `SELECT email FROM ${table} WHERE id = ?`
      ).bind(leadId).first();
      if (r?.email) { leadEmail = r.email; break; }
    } catch { /* ignore */ }
  }

  // Thread linking: if the inbound subject starts with "re:" and the
  // unwound subject matches an outbound subject for this prospect,
  // thread them. Otherwise start a new thread.
  const unwound = subject.replace(/^\s*(re|fw|fwd):\s*/i, "").trim();
  let threadId = crypto.randomUUID();
  let parentId = null;
  try {
    const r = await env.LEADS_DB.prepare(
      `SELECT id, thread_id, prospect_id FROM prospect_messages
       WHERE prospect_id = ? AND subject LIKE ?
       ORDER BY sent_at DESC LIMIT 1`
    ).bind(leadId, `%${unwound}%`).first();
    if (r) {
      threadId = r.thread_id || threadId;
      parentId = r.id;
    }
  } catch { /* not fatal */ }

  const id = crypto.randomUUID();
  await env.LEADS_DB.prepare(
    `INSERT INTO prospect_messages
      (id, prospect_id, lead_kind, thread_id, parent_id, direction,
       message_id_header, from_email, to_email, reply_to, subject, body_text,
       body_excerpt, provider, status, classification, confidence,
       recommended_action, received_at, classified_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, 'manual',
       'received', ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, leadId, "prospect", threadId, parentId, messageId,
    fromEmail, leadEmail || "info@mehyar.us", null, subject, bodyText,
    bodyText.replace(/\s+/g, " ").slice(0, 320),
    String(body.classification || "").slice(0, 80) || null,
    Number.isFinite(parseFloat(body.confidence)) ? parseFloat(body.confidence) : null,
    String(body.recommended_action || "").slice(0, 120) || null,
    body.received_at || now,
    body.classification ? now : null,
    now, now,
  ).run();

  return json({
    ok: true,
    message_id: id,
    thread_id: threadId,
    parent_id: parentId,
    direction: "inbound",
    matched_lead_email: leadEmail,
    from_email: fromEmail,
    subject,
  }, 200, request, env);
}
