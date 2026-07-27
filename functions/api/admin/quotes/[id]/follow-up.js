// POST /api/admin/quotes/:id/follow-up
//
// Creates a durable quote follow-up task for an open quote/invoice. This keeps
// quote pipeline from being passive: every open dollar gets a next action.

import { verifyAdminToken, json, corsHeaders } from "../../../_shared/adminAuth.js";
import { ensureMayorTasksSchema } from "../../../_shared/mayorTasks.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const id = String(params?.id || "").slice(0, 96);
  if (!id) return json({ ok: false, error: "missing_quote_id" }, 400, request, env);

  let body = {};
  try { body = await request.json(); } catch {}
  await ensureMayorTasksSchema(env);
  const db = env.LEADS_DB;

  const quote = await db.prepare(`
    SELECT id, quote_number, client_name, client_email, total_usd, status,
           lead_id, lead_kind, public_slug, created_at, updated_at,
           date(created_at, '+' || COALESCE(due_days, 15) || ' days') AS due_date
    FROM quotes
    WHERE id = ? OR public_slug = ?
    LIMIT 1
  `).bind(id, id).first().catch(() => null);
  if (!quote) return json({ ok: false, error: "quote_not_found" }, 404, request, env);
  if (!["quote", "invoice"].includes(String(quote.status || ""))) {
    return json({ ok: false, error: "quote_not_open", status: quote.status }, 409, request, env);
  }

  const source = `quote:${quote.id}`;
  const existing = await db.prepare(`
    SELECT id, status, due_at
    FROM mayor_tasks
    WHERE kind = 'quote_followup'
      AND source = ?
      AND status IN ('open','pending')
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(source).first().catch(() => null);
  if (existing) {
    return json({
      ok: true,
      already_exists: true,
      task_id: existing.id,
      status: existing.status,
      due_at: existing.due_at,
      quote_id: quote.id,
      quote_number: quote.quote_number,
    }, 200, request, env);
  }

  const stale = quote.due_date ? new Date(quote.due_date).getTime() < Date.now() : false;
  const dueAt = String(body?.due_at || "").trim().slice(0, 64)
    || new Date(Date.now() + (stale ? 0 : 24 * 60 * 60 * 1000)).toISOString();
  const cta = String(body?.cta_text || defaultCta(quote, stale)).trim().slice(0, 1200);
  const taskId = crypto.randomUUID();
  const title = `Follow up Quote #${quote.quote_number}: ${quote.client_name}`.slice(0, 500);
  const payload = JSON.stringify({
    quote_id: quote.id,
    quote_number: quote.quote_number,
    public_slug: quote.public_slug,
    view_url: `/q/${quote.public_slug}`,
    status: quote.status,
    due_date: quote.due_date,
    stale,
  }).slice(0, 8000);

  try {
    await db.prepare(`
      INSERT INTO mayor_tasks (
        id, kind, prospect_id, reply_id, title, status, priority, due_at,
        cta_text, value_usd, source, payload_json, created_at, updated_at
      )
      VALUES (?, 'quote_followup', ?, NULL, ?, 'open', ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).bind(
      taskId,
      quote.lead_kind === "prospect" ? quote.lead_id : null,
      title,
      stale ? 92 : 78,
      dueAt,
      cta,
      Number(quote.total_usd || 0),
      source,
      payload
    ).run();

    await db.prepare(`
      INSERT INTO opportunity_events (id, kind, prospect_id, sam_id, event_type, actor, payload_json, created_at)
      VALUES (?, ?, ?, ?, 'quote_followup_task_created', 'owner', ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      quote.lead_kind === "sam" ? "sam" : "prospect",
      quote.lead_kind === "prospect" ? quote.lead_id : null,
      quote.lead_kind === "sam" ? quote.lead_id : null,
      JSON.stringify({ task_id: taskId, quote_id: quote.id, quote_number: quote.quote_number, total_usd: quote.total_usd }).slice(0, 4000)
    ).run().catch(() => null);

    await db.prepare(`
      INSERT INTO mayor_events (id, kind, loop, summary, details_json, created_at)
      VALUES (?, 'revenue', 'quote_followup', ?, ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      `Quote follow-up task created for #${quote.quote_number}: ${quote.client_name}`,
      JSON.stringify({ task_id: taskId, quote_id: quote.id, quote_number: quote.quote_number }).slice(0, 4000)
    ).run().catch(() => null);

    return json({
      ok: true,
      task_id: taskId,
      quote_id: quote.id,
      quote_number: quote.quote_number,
      status: "open",
      due_at: dueAt,
      cta_text: cta,
      value_usd: Number(quote.total_usd || 0),
    }, 200, request, env);
  } catch (e) {
    return json({ ok: false, error: "followup_task_failed", details: String(e?.message || e) }, 500, request, env);
  }
}

function defaultCta(quote, stale) {
  const link = `https://mehyar.us/q/${quote.public_slug}`;
  if (quote.status === "invoice") {
    return `Quick follow-up on Invoice #${quote.quote_number}. The payment link/details are here: ${link}. Should I keep this open for this week?`;
  }
  if (stale) {
    return `Quick follow-up on Quote #${quote.quote_number}. Is this still a priority, or should I close it for now? ${link}`;
  }
  return `Quick follow-up on Quote #${quote.quote_number}. Any questions, or should I convert this to an invoice? ${link}`;
}

