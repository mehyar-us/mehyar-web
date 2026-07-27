// POST /api/admin/mayor/replies/:id/book-call
//
// Converts a warm/interest reply into a durable booking task, records the
// meeting CTA that should be sent, moves the prospect into the replied stage,
// and clears the reply from the urgent action queue.

import { verifyAdminToken, json, corsHeaders } from "../../../../_shared/adminAuth.js";
import { ensureMayorTasksSchema } from "../../../../_shared/mayorTasks.js";

const DEFAULT_CTA = "Would tomorrow or the next morning be better for a quick 15-minute call?";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const replyId = String(params?.id || "").slice(0, 96);
  if (!replyId) return json({ ok: false, error: "missing_reply_id" }, 400, request, env);

  let body = {};
  try { body = await request.json(); } catch {}
  const ctaText = String(body?.meeting_cta || body?.cta_text || DEFAULT_CTA).trim().slice(0, 1000) || DEFAULT_CTA;
  const valueUsd = clampMoney(body?.value_usd, 7500);
  const dueAt = String(body?.due_at || "").trim().slice(0, 64) || new Date().toISOString();

  const db = env.LEADS_DB;
  await ensureMayorTasksSchema(env);

  const reply = await db.prepare(`
    SELECT
      pr.id, pr.prospect_id, pr.classification, pr.received_at, pr.subject, pr.body_excerpt,
      p.business_name, p.root_domain, p.email, p.status AS prospect_status
    FROM prospect_replies pr
    LEFT JOIN prospects p ON p.id = pr.prospect_id
    WHERE pr.id = ?
    LIMIT 1
  `).bind(replyId).first().catch(() => null);
  if (!reply) return json({ ok: false, error: "reply_not_found" }, 404, request, env);
  if (!reply.prospect_id) return json({ ok: false, error: "reply_missing_prospect" }, 409, request, env);

  const existingTask = await db.prepare(`
    SELECT id, status, due_at
    FROM mayor_tasks
    WHERE reply_id = ? AND kind = 'booking'
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(replyId).first().catch(() => null);
  if (existingTask) {
    await markReplyAndProspect(db, reply);
    return json({
      ok: true,
      already_exists: true,
      task_id: existingTask.id,
      status: existingTask.status,
      due_at: existingTask.due_at,
      reply_id: replyId,
      prospect_id: reply.prospect_id,
      meeting_cta: ctaText,
    }, 200, request, env);
  }

  const taskId = crypto.randomUUID();
  const title = `Book 15-minute call with ${reply.business_name || reply.email || "warm lead"}`.slice(0, 500);
  const payload = JSON.stringify({
    reply_id: replyId,
    classification: reply.classification,
    reply_subject: reply.subject,
    reply_excerpt: reply.body_excerpt,
    root_domain: reply.root_domain,
    previous_prospect_status: reply.prospect_status,
  }).slice(0, 8000);

  try {
    await db.prepare(`
      INSERT INTO mayor_tasks (
        id, kind, prospect_id, reply_id, title, status, priority, due_at,
        cta_text, value_usd, source, payload_json, created_at, updated_at
      )
      VALUES (?, 'booking', ?, ?, ?, 'open', 95, ?, ?, ?, 'warm_reply', ?, datetime('now'), datetime('now'))
    `).bind(taskId, reply.prospect_id, replyId, title, dueAt, ctaText, valueUsd, payload).run();

    await markReplyAndProspect(db, reply);

    await db.prepare(`
      INSERT INTO opportunity_events (id, kind, prospect_id, event_type, actor, from_stage, to_stage, payload_json, created_at)
      VALUES (?, 'prospect', ?, 'booking_task_created', 'owner', ?, 'replied', ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      reply.prospect_id,
      reply.prospect_status || "",
      JSON.stringify({ task_id: taskId, reply_id: replyId, meeting_cta: ctaText, value_usd: valueUsd }).slice(0, 4000)
    ).run().catch(() => null);

    await db.prepare(`
      INSERT INTO opportunity_notes (id, kind, prospect_id, body, author, created_at, updated_at)
      VALUES (?, 'prospect', ?, ?, 'owner', datetime('now'), datetime('now'))
    `).bind(
      crypto.randomUUID(),
      reply.prospect_id,
      `Booking CTA ready to send: ${ctaText}`
    ).run().catch(() => null);

    await db.prepare(`
      INSERT INTO mayor_events (id, kind, loop, summary, details_json, created_at)
      VALUES (?, 'reply', 'booking', ?, ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      `Booking task created for ${reply.business_name || reply.email || reply.prospect_id}`,
      JSON.stringify({ task_id: taskId, reply_id: replyId, prospect_id: reply.prospect_id, value_usd: valueUsd }).slice(0, 4000)
    ).run().catch(() => null);

    return json({
      ok: true,
      task_id: taskId,
      reply_id: replyId,
      prospect_id: reply.prospect_id,
      title,
      meeting_cta: ctaText,
      value_usd: valueUsd,
      due_at: dueAt,
      status: "open",
    }, 200, request, env);
  } catch (e) {
    return json({ ok: false, error: "booking_task_failed", details: String(e?.message || e) }, 500, request, env);
  }
}

async function markReplyAndProspect(db, reply) {
  await db.prepare(`
    UPDATE prospect_replies
    SET needs_action = 0, handled_at = COALESCE(handled_at, datetime('now')), created_action = COALESCE(created_action, 'booking_task_created')
    WHERE id = ?
  `).bind(reply.id).run().catch(async () => {
    await db.prepare(`
      UPDATE prospect_replies
      SET needs_action = 0, handled_at = COALESCE(handled_at, datetime('now'))
      WHERE id = ?
    `).bind(reply.id).run().catch(() => null);
  });

  await db.prepare(`
    UPDATE prospects
    SET status = 'replied',
        last_contact_at = COALESCE(last_contact_at, datetime('now')),
        updated_at = datetime('now')
    WHERE id = ?
  `).bind(reply.prospect_id).run().catch(() => null);
}

function clampMoney(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(100, Math.min(250000, Math.round(n)));
}
