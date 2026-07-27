// POST /api/admin/mayor/tasks/:id/quote
//
// Converts an open booking task into a priced quote for the linked prospect.
// The quote is persisted in quotes, the prospect moves to ready, and the task
// is marked quoted so booking work becomes measurable pipeline.

import { verifyAdminToken, json, corsHeaders } from "../../../../_shared/adminAuth.js";
import { ensureMayorTasksSchema } from "../../../../_shared/mayorTasks.js";

const OFFER_DEFAULTS = {
  audit: {
    name: "Website + intake leak audit",
    desc: "Focused review of website clarity, booking/contact path, follow-up gaps, and the smallest practical next fix.",
    price: 750,
  },
  quick_fix: {
    name: "Website + booking quick fix",
    desc: "Fixed-scope cleanup for the highest-value visible leak: CTA, form, booking path, trust copy, or mobile friction.",
    price: 2500,
  },
  automation_sprint: {
    name: "Automation sprint",
    desc: "Map and ship the first operational automation across intake, CRM, email follow-up, AI triage, or owner reporting.",
    price: 7500,
  },
  retainer: {
    name: "Monthly systems retainer",
    desc: "Ongoing founder/operator technical support, CRM cleanup, automations, measurement, and iteration.",
    price: 2500,
  },
};

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const taskId = String(params?.id || "").slice(0, 96);
  if (!taskId) return json({ ok: false, error: "missing_task_id" }, 400, request, env);

  let body = {};
  try { body = await request.json(); } catch {}
  await ensureMayorTasksSchema(env);
  await ensureQuotesSchema(env);

  const db = env.LEADS_DB;
  const task = await db.prepare(`
    SELECT t.*, p.business_name, p.email, p.root_domain, p.vertical, p.city
    FROM mayor_tasks t
    LEFT JOIN prospects p ON p.id = t.prospect_id
    WHERE t.id = ?
    LIMIT 1
  `).bind(taskId).first().catch(() => null);
  if (!task) return json({ ok: false, error: "task_not_found" }, 404, request, env);
  if (task.kind !== "booking") return json({ ok: false, error: "not_booking_task" }, 409, request, env);
  if (!task.prospect_id) return json({ ok: false, error: "task_missing_prospect" }, 409, request, env);
  if (!task.business_name) return json({ ok: false, error: "prospect_not_found" }, 404, request, env);

  const priorPayload = safeJson(task.payload_json);
  if (task.status === "quoted" && priorPayload?.quote_id) {
    return json({
      ok: true,
      already_quoted: true,
      task_id: taskId,
      quote_id: priorPayload.quote_id,
      quote_number: priorPayload.quote_number,
      view_url: priorPayload.view_url,
      total_usd: priorPayload.total_usd,
    }, 200, request, env);
  }

  const offerId = String(body?.offer_id || chooseOffer(task)).trim();
  const offer = OFFER_DEFAULTS[offerId] || OFFER_DEFAULTS.quick_fix;
  const lineName = String(body?.line_name || offer.name).slice(0, 200);
  const lineDesc = String(body?.line_desc || offer.desc).slice(0, 600);
  const priceUsd = clampMoney(body?.price_usd, Number(task.value_usd || 0) || offer.price);
  const dueDays = clampInt(body?.due_days, 1, 45, 15);
  const items = [{ name: lineName, desc: lineDesc, qty: 1, price: priceUsd }];
  const quoteId = crypto.randomUUID();
  const quoteNumber = await nextQuoteNumber(db);
  const publicSlug = `${quoteNumber}-${slugify(task.business_name)}-${quoteId.slice(0, 4).toLowerCase()}`;

  try {
    await db.prepare(`
      INSERT INTO quotes (id, quote_number, client_name, client_email, client_address,
                          items_json, total_usd, due_days, status, lead_id, lead_kind,
                          public_slug, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'quote', ?, 'prospect', ?, datetime('now'), datetime('now'))
    `).bind(
      quoteId,
      quoteNumber,
      String(task.business_name).slice(0, 200),
      task.email ? String(task.email).slice(0, 200) : null,
      JSON.stringify(items).slice(0, 48000),
      priceUsd,
      dueDays,
      task.prospect_id,
      publicSlug
    ).run();

    const url = new URL(request.url);
    const viewUrl = `${url.protocol}//${url.host}/q/${publicSlug}`;
    const nextPayload = {
      ...priorPayload,
      quoted_at: new Date().toISOString(),
      quote_id: quoteId,
      quote_number: quoteNumber,
      public_slug: publicSlug,
      view_url: viewUrl,
      total_usd: priceUsd,
      offer_id: offerId,
      items,
    };

    await db.prepare(`
      UPDATE mayor_tasks
      SET status = 'quoted',
          completed_at = COALESCE(completed_at, datetime('now')),
          updated_at = datetime('now'),
          value_usd = ?,
          payload_json = ?
      WHERE id = ?
    `).bind(priceUsd, JSON.stringify(nextPayload).slice(0, 48000), taskId).run();

    await db.prepare(`
      UPDATE prospects
      SET status = 'ready',
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(task.prospect_id).run().catch(() => null);

    await db.prepare(`
      INSERT INTO opportunity_events (id, kind, prospect_id, event_type, actor, payload_json, created_at)
      VALUES (?, 'prospect', ?, 'quote_generated_from_booking_task', 'owner', ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      task.prospect_id,
      JSON.stringify({ task_id: taskId, quote_id: quoteId, quote_number: quoteNumber, total_usd: priceUsd, offer_id: offerId }).slice(0, 4000)
    ).run().catch(() => null);

    await db.prepare(`
      INSERT INTO mayor_events (id, kind, loop, summary, details_json, created_at)
      VALUES (?, 'revenue', 'quote', ?, ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      `Quote #${quoteNumber} generated for ${task.business_name}: $${priceUsd.toLocaleString()}`,
      JSON.stringify({ task_id: taskId, quote_id: quoteId, prospect_id: task.prospect_id, total_usd: priceUsd }).slice(0, 4000)
    ).run().catch(() => null);

    return json({
      ok: true,
      task_id: taskId,
      quote_id: quoteId,
      quote_number: quoteNumber,
      public_slug: publicSlug,
      view_url: viewUrl,
      total_usd: priceUsd,
      offer_id: offerId,
      prospect_id: task.prospect_id,
      status: "quoted",
    }, 200, request, env);
  } catch (e) {
    return json({ ok: false, error: "quote_from_task_failed", details: String(e?.message || e) }, 500, request, env);
  }
}

async function ensureQuotesSchema(env) {
  await env.LEADS_DB.batch([
    env.LEADS_DB.prepare(`CREATE TABLE IF NOT EXISTS quotes (
      id TEXT PRIMARY KEY,
      quote_number INTEGER NOT NULL,
      client_name TEXT NOT NULL,
      client_email TEXT,
      client_address TEXT,
      items_json TEXT NOT NULL,
      total_usd REAL NOT NULL,
      due_days INTEGER DEFAULT 15,
      status TEXT DEFAULT 'quote',
      lead_id TEXT,
      lead_kind TEXT,
      public_slug TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      paid_at TEXT,
      voided_at TEXT
    )`),
    env.LEADS_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status)`),
    env.LEADS_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_quotes_slug ON quotes(public_slug)`),
  ]).catch(() => null);
}

async function nextQuoteNumber(db) {
  const last = await db.prepare(`SELECT MAX(quote_number) as n FROM quotes`).first().catch(() => ({ n: 0 }));
  return (Number(last?.n || 0) || 0) + 1;
}

function chooseOffer(task) {
  const vertical = String(task.vertical || "").toLowerCase();
  const text = `${task.title || ""} ${task.cta_text || ""} ${task.payload_json || ""}`.toLowerCase();
  if (/\bautomation|crm|follow[- ]?up|ai|workflow|intake\b/.test(text)) return "automation_sprint";
  if (/\bretainer|monthly|ongoing\b/.test(text)) return "retainer";
  if (/\b(cafe|bakery|restaurant|gym|salon|clinic|dental)\b/.test(vertical)) return "quick_fix";
  return "quick_fix";
}

function clampMoney(value, fallback) {
  const n = Number(value);
  const base = Number.isFinite(n) && n > 0 ? n : fallback;
  return Math.max(100, Math.min(250000, Math.round(base)));
}

function clampInt(value, lo, hi, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function safeJson(s) {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "client";
}

