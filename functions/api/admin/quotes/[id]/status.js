// POST /api/admin/quotes/:id/status
//
// Moves a quote through quote -> invoice -> paid/void. Marking paid also
// records a won decision and marks the linked prospect/gov opportunity won.

import { verifyAdminToken, json, corsHeaders } from "../../../_shared/adminAuth.js";

const VALID = new Set(["quote", "invoice", "paid", "void"]);
const PAYMENT_METHODS = new Set(["ach", "wire", "check", "cash", "other"]);

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
  const status = String(body?.status || "").toLowerCase();
  if (!VALID.has(status)) return json({ ok: false, error: "bad_status", accepted: [...VALID] }, 400, request, env);
  const remittance = status === "paid" ? normalizeRemittance(body) : null;
  if (remittance?.error) return json({ ok: false, error: remittance.error, accepted_methods: [...PAYMENT_METHODS] }, 400, request, env);

  await ensureSchemas(env);
  const db = env.LEADS_DB;
  const quote = await db.prepare(`
    SELECT id, quote_number, client_name, client_email, total_usd, status,
           lead_id, lead_kind, public_slug, paid_at, created_at
    FROM quotes
    WHERE id = ? OR public_slug = ?
    LIMIT 1
  `).bind(id, id).first().catch(() => null);
  if (!quote) return json({ ok: false, error: "quote_not_found" }, 404, request, env);

  if (quote.status === status) {
    return json({ ok: true, quote_id: quote.id, quote_number: quote.quote_number, status, unchanged: true }, 200, request, env);
  }

  const previous = quote.status;
  const paidAtSql = status === "paid" ? "paid_at = COALESCE(paid_at, datetime('now'))," : "";
  const voidedAtSql = status === "void" ? "voided_at = COALESCE(voided_at, datetime('now'))," : "";
  const paidRemittanceSql = status === "paid"
    ? "paid_method = ?, paid_reference = ?, paid_notes = ?, paid_amount_usd = ?,"
    : "";
  const paidRemittanceBind = status === "paid"
    ? [remittance.method, remittance.reference, remittance.notes, remittance.amount_usd]
    : [];
  await db.prepare(`
    UPDATE quotes
    SET status = ?,
        ${paidAtSql}
        ${voidedAtSql}
        ${paidRemittanceSql}
        updated_at = datetime('now')
    WHERE id = ?
  `).bind(status, ...paidRemittanceBind, quote.id).run();

  let decision = null;
  if (status === "paid") {
    decision = await markLinkedLeadWon(db, quote);
  }

  await db.prepare(`
    INSERT INTO opportunity_events (id, kind, prospect_id, sam_id, event_type, actor, payload_json, created_at)
    VALUES (?, ?, ?, ?, 'quote_status_changed', 'owner', ?, datetime('now'))
  `).bind(
    crypto.randomUUID(),
    quote.lead_kind === "sam" ? "sam" : "prospect",
    quote.lead_kind === "prospect" ? quote.lead_id : null,
    quote.lead_kind === "sam" ? quote.lead_id : null,
    JSON.stringify({ quote_id: quote.id, quote_number: quote.quote_number, from: previous, to: status, decision, remittance }).slice(0, 4000)
  ).run().catch(() => null);

  await db.prepare(`
    INSERT INTO mayor_events (id, kind, loop, summary, details_json, created_at)
    VALUES (?, 'revenue', 'quote_status', ?, ?, datetime('now'))
  `).bind(
    crypto.randomUUID(),
    status === "paid"
      ? `Quote #${quote.quote_number} marked paid via ${remittance.method}: ${quote.client_name} ($${Number(remittance.amount_usd || quote.total_usd || 0).toLocaleString()})`
      : `Quote #${quote.quote_number} marked ${status}: ${quote.client_name} ($${Number(quote.total_usd || 0).toLocaleString()})`,
    JSON.stringify({ quote_id: quote.id, quote_number: quote.quote_number, status, previous, decision, remittance }).slice(0, 4000)
  ).run().catch(() => null);

  return json({
    ok: true,
    quote_id: quote.id,
    quote_number: quote.quote_number,
    previous_status: previous,
    status,
    total_usd: Number(quote.total_usd || 0),
    remittance,
    decision,
  }, 200, request, env);
}

function normalizeRemittance(body) {
  const method = String(body?.payment_method || body?.paid_method || "").trim().toLowerCase();
  if (!PAYMENT_METHODS.has(method)) return { error: "bad_payment_method" };
  const amount = body?.paid_amount_usd === undefined || body?.paid_amount_usd === null || body?.paid_amount_usd === ""
    ? null
    : Number(body.paid_amount_usd);
  if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) return { error: "bad_paid_amount" };
  return {
    method,
    reference: String(body?.payment_reference || body?.paid_reference || "").trim().slice(0, 200) || null,
    notes: String(body?.payment_notes || body?.paid_notes || "").trim().slice(0, 1200) || null,
    amount_usd: amount === null ? null : Math.round(amount * 100) / 100,
  };
}

async function markLinkedLeadWon(db, quote) {
  const kind = quote.lead_kind === "sam" ? "sam" : "prospect";
  if (!quote.lead_id) return { ok: false, skipped: "missing_lead_id" };

  const existing = await db.prepare(`
    SELECT id
    FROM opportunity_decisions
    WHERE opportunity_id = ? AND decision = 'won' AND reason_code = 'quote_paid' AND reason_body = ?
    LIMIT 1
  `).bind(quote.lead_id, `Quote #${quote.quote_number} paid`).first().catch(() => null);
  if (existing) return { ok: true, already_recorded: true, decision_id: existing.id };

  const decisionId = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO opportunity_decisions (id, opportunity_id, kind, decision, outcome,
                                       value_usd, reason_code, reason_body,
                                       decided_by, decided_at, created_at)
    VALUES (?, ?, ?, 'won', 'won', ?, 'quote_paid', ?, 'owner', datetime('now'), datetime('now'))
  `).bind(
    decisionId,
    quote.lead_id,
    kind,
    Number(quote.total_usd || 0),
    `Quote #${quote.quote_number} paid`
  ).run();

  if (kind === "prospect") {
    await db.prepare(`UPDATE prospects SET status = 'won', updated_at = datetime('now') WHERE id = ?`).bind(quote.lead_id).run().catch(() => null);
  } else {
    await db.prepare(`UPDATE gov_opportunities SET stage = 'won', updated_at = datetime('now') WHERE id = ?`).bind(quote.lead_id).run().catch(() => null);
  }

  return { ok: true, decision_id: decisionId, kind, value_usd: Number(quote.total_usd || 0) };
}

async function ensureSchemas(env) {
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
    env.LEADS_DB.prepare(`CREATE TABLE IF NOT EXISTS opportunity_decisions (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT,
      kind TEXT NOT NULL DEFAULT 'sam',
      decision TEXT NOT NULL,
      outcome TEXT,
      value_usd REAL DEFAULT 0,
      reason_code TEXT,
      reason_body TEXT,
      decided_by TEXT NOT NULL DEFAULT 'owner',
      decided_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
  ]).catch(() => null);
  await env.LEADS_DB.prepare(`ALTER TABLE opportunity_decisions ADD COLUMN outcome TEXT`).run().catch(() => null);
  await env.LEADS_DB.prepare(`ALTER TABLE opportunity_decisions ADD COLUMN value_usd REAL NOT NULL DEFAULT 0`).run().catch(() => null);
  await env.LEADS_DB.prepare(`ALTER TABLE quotes ADD COLUMN voided_at TEXT`).run().catch(() => null);
  await env.LEADS_DB.prepare(`ALTER TABLE quotes ADD COLUMN paid_method TEXT`).run().catch(() => null);
  await env.LEADS_DB.prepare(`ALTER TABLE quotes ADD COLUMN paid_reference TEXT`).run().catch(() => null);
  await env.LEADS_DB.prepare(`ALTER TABLE quotes ADD COLUMN paid_notes TEXT`).run().catch(() => null);
  await env.LEADS_DB.prepare(`ALTER TABLE quotes ADD COLUMN paid_amount_usd REAL`).run().catch(() => null);
}
