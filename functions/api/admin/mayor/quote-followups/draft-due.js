// POST /api/admin/mayor/quote-followups/draft-due
//
// Creates review-required email drafts for open quote/invoice follow-up tasks.
// This is a batching layer over /api/admin/quotes/:id/draft-follow-up: it does
// not send anything and does not approve drafts.

import { verifyAdminToken, json, corsHeaders } from "../../../_shared/adminAuth.js";
import { ensureMayorTasksSchema } from "../../../_shared/mayorTasks.js";
import { onRequestPost as draftQuoteFollowUp } from "../../quotes/[id]/draft-follow-up.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  let body = {};
  try { body = await request.json(); } catch {}
  const limit = clampInt(body?.limit, 1, 25, 10);
  const forceRefresh = Boolean(body?.force_refresh || body?.refresh);
  const db = env.LEADS_DB;
  await ensureMayorTasksSchema(env);

  const quotes = await all(db, `
    SELECT id, quote_number, client_name, client_email, total_usd, status,
           public_slug, created_at,
           date(created_at, '+' || COALESCE(due_days, 15) || ' days') AS due_date
    FROM quotes
    WHERE status IN ('quote','invoice')
    ORDER BY
      CASE WHEN status = 'invoice' THEN 0 ELSE 1 END,
      CASE WHEN date(created_at, '+' || COALESCE(due_days, 15) || ' days') < date('now') THEN 0 ELSE 1 END,
      total_usd DESC,
      created_at ASC
    LIMIT ?
  `, [limit * 3]);

  const results = [];
  for (const quote of quotes) {
    if (results.filter((r) => r.created || r.refreshed || r.already_exists).length >= limit) break;
    const readiness = await followupReadiness(db, quote.id);
    if (readiness.hasDraft && !forceRefresh) {
      results.push({
        quote_id: quote.id,
        quote_number: quote.quote_number,
        status: "already_exists",
        draft_id: readiness.draftId,
        review_href: `/admin/money?focus=${encodeURIComponent(readiness.draftId)}`,
        already_exists: true,
      });
      continue;
    }

    const subrequest = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(forceRefresh ? { force_refresh: true } : {}),
    });
    const response = await draftQuoteFollowUp({
      request: subrequest,
      env,
      params: { id: quote.id },
    });
    const payload = await response.json().catch(() => ({}));
    results.push({
      quote_id: quote.id,
      quote_number: quote.quote_number,
      ok: response.ok && payload?.ok !== false,
      status: payload?.already_exists ? "already_exists" : payload?.refreshed ? "refreshed" : payload?.draft_id ? "created" : "error",
      created: Boolean(payload?.draft_id && !payload?.already_exists && !payload?.refreshed),
      refreshed: Boolean(payload?.refreshed),
      already_exists: Boolean(payload?.already_exists),
      draft_id: payload?.draft_id || "",
      task_id: payload?.task_id || "",
      review_href: payload?.review_href || "",
      error: response.ok ? "" : payload?.error || `HTTP ${response.status}`,
    });
  }

  const created = results.filter((r) => r.created).length;
  const refreshed = results.filter((r) => r.refreshed).length;
  const alreadyExists = results.filter((r) => r.already_exists).length;
  const errors = results.filter((r) => r.status === "error");

  await db.prepare(`
    INSERT INTO mayor_events (id, kind, loop, summary, details_json, created_at)
    VALUES (?, 'revenue', 'quote_followup_batch_draft', ?, ?, datetime('now'))
  `).bind(
    crypto.randomUUID(),
    `Quote follow-up batch drafted: ${created} created, ${alreadyExists} already ready`,
    JSON.stringify({ created, refreshed, already_exists: alreadyExists, errors: errors.length, limit }).slice(0, 4000)
  ).run().catch(() => null);

  return json({
    ok: errors.length === 0,
    created,
    refreshed,
    already_exists: alreadyExists,
    errors: errors.length,
    results,
    review_all_href: "/admin/money",
  }, errors.length ? 207 : 200, request, env);
}

async function all(db, sql, binds = []) {
  const stmt = db.prepare(sql);
  const result = binds.length ? await stmt.bind(...binds).all().catch(() => ({ results: [] })) : await stmt.all().catch(() => ({ results: [] }));
  return result.results || [];
}

async function followupReadiness(db, quoteId) {
  const task = await db.prepare(`
    SELECT payload_json
    FROM mayor_tasks
    WHERE kind = 'quote_followup' AND source = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(`quote:${quoteId}`).first().catch(() => null);
  const payload = safeJson(task?.payload_json, {});
  const draftId = payload?.followup_draft_id || "";
  if (!draftId) return { hasDraft: false, draftId: "" };
  const draft = await db.prepare(`
    SELECT id
    FROM prospect_drafts
    WHERE id = ? AND status IN ('draft','ready','pending_review')
    LIMIT 1
  `).bind(draftId).first().catch(() => null);
  return { hasDraft: Boolean(draft?.id), draftId: draft?.id || "" };
}

function safeJson(value, fallback = {}) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function clampInt(value, lo, hi, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}
