// POST /api/admin/quotes/:id/payment
//
// Stores the owner-approved payment URL/instructions for a quote. This keeps
// payment collection review-gated: the public quote only shows a direct pay
// button after the owner pastes a real HTTPS payment link.

import { verifyAdminToken, json, corsHeaders } from "../../../_shared/adminAuth.js";

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
  try { body = await request.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400, request, env); }

  await ensureQuotePaymentSchema(env);
  const db = env.LEADS_DB;
  const quote = await db.prepare(`
    SELECT id, quote_number, client_name, client_email, total_usd, status,
           lead_id, lead_kind, public_slug, payment_url
    FROM quotes
    WHERE id = ? OR public_slug = ?
    LIMIT 1
  `).bind(id, id).first().catch(() => null);
  if (!quote) return json({ ok: false, error: "quote_not_found" }, 404, request, env);
  if (quote.status === "paid" || quote.status === "void") {
    return json({ ok: false, error: "quote_not_open", status: quote.status }, 409, request, env);
  }

  const paymentUrl = normalizePaymentUrl(body?.payment_url);
  if (paymentUrl.error) return json({ ok: false, error: paymentUrl.error }, 400, request, env);
  const instructions = String(body?.payment_instructions || "").trim().slice(0, 1200) || null;
  const depositUsd = normalizeDeposit(body?.deposit_usd, Number(quote.total_usd || 0));
  if (depositUsd.error) return json({ ok: false, error: depositUsd.error }, 400, request, env);

  const previousUrl = quote.payment_url || null;
  await db.prepare(`
    UPDATE quotes
    SET payment_url = ?,
        payment_instructions = ?,
        deposit_usd = ?,
        payment_url_updated_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ?
  `).bind(paymentUrl.value, instructions, depositUsd.value, quote.id).run();

  await db.prepare(`
    INSERT INTO opportunity_events (id, kind, prospect_id, sam_id, event_type, actor, payload_json, created_at)
    VALUES (?, ?, ?, ?, 'quote_payment_link_updated', 'owner', ?, datetime('now'))
  `).bind(
    crypto.randomUUID(),
    quote.lead_kind === "sam" ? "sam" : "prospect",
    quote.lead_kind === "prospect" ? quote.lead_id : null,
    quote.lead_kind === "sam" ? quote.lead_id : null,
    JSON.stringify({
      quote_id: quote.id,
      quote_number: quote.quote_number,
      had_previous_url: Boolean(previousUrl),
      has_payment_url: Boolean(paymentUrl.value),
      deposit_usd: depositUsd.value,
    }).slice(0, 4000)
  ).run().catch(() => null);

  await db.prepare(`
    INSERT INTO mayor_events (id, kind, loop, summary, details_json, created_at)
    VALUES (?, 'revenue', 'quote_payment', ?, ?, datetime('now'))
  `).bind(
    crypto.randomUUID(),
    paymentUrl.value
      ? `Payment link set for Quote #${quote.quote_number}: ${quote.client_name}`
      : `Payment link cleared for Quote #${quote.quote_number}: ${quote.client_name}`,
    JSON.stringify({ quote_id: quote.id, quote_number: quote.quote_number, has_payment_url: Boolean(paymentUrl.value), deposit_usd: depositUsd.value }).slice(0, 4000)
  ).run().catch(() => null);

  return json({
    ok: true,
    quote_id: quote.id,
    quote_number: quote.quote_number,
    has_payment_url: Boolean(paymentUrl.value),
    payment_url: paymentUrl.value,
    payment_instructions: instructions,
    deposit_usd: depositUsd.value,
  }, 200, request, env);
}

async function ensureQuotePaymentSchema(env) {
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
  await env.LEADS_DB.prepare(`ALTER TABLE quotes ADD COLUMN payment_url TEXT`).run().catch(() => null);
  await env.LEADS_DB.prepare(`ALTER TABLE quotes ADD COLUMN payment_instructions TEXT`).run().catch(() => null);
  await env.LEADS_DB.prepare(`ALTER TABLE quotes ADD COLUMN deposit_usd REAL`).run().catch(() => null);
  await env.LEADS_DB.prepare(`ALTER TABLE quotes ADD COLUMN payment_url_updated_at TEXT`).run().catch(() => null);
}

function normalizePaymentUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return { value: null };
  if (raw.length > 1200) return { error: "payment_url_too_long" };
  let parsed;
  try { parsed = new URL(raw); } catch { return { error: "payment_url_invalid" }; }
  if (parsed.protocol !== "https:") return { error: "payment_url_must_be_https" };
  if (!parsed.hostname || ["localhost", "127.0.0.1", "0.0.0.0"].includes(parsed.hostname)) {
    return { error: "payment_url_must_be_public" };
  }
  return { value: parsed.toString() };
}

function normalizeDeposit(value, totalUsd) {
  if (value === undefined || value === null || value === "") return { value: null };
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return { error: "deposit_usd_invalid" };
  const rounded = Math.round(n * 100) / 100;
  if (totalUsd > 0 && rounded > totalUsd) return { error: "deposit_exceeds_quote_total" };
  return { value: rounded };
}
