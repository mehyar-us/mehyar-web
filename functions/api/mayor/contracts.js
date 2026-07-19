// /api/mayor/contracts — list + create prospect contracts.
//
// GET  ?status=&prospect_id=&limit=    — list contracts
// POST {prospect_id, service_id, service_title, scope_text, price_model,
//       price_low, price_high, scope_text} — create contract
//
// Mirrors the user-visible "Contracts" tab on the Pipeline dashboard.

import { verifyAdminToken, json, corsHeaders } from "../_shared/adminAuth.js";

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

const VALID_PRICE_MODELS = new Set(["one_time", "monthly", "hourly", "project"]);
const VALID_STATUSES = new Set([
  "proposed", "sent", "viewed", "negotiating", "accepted",
  "contracted", "invoiced", "paid_partial", "paid_full",
  "delivered", "renewed", "cancelled", "lost"
]);

export async function onRequestGet({ request, env }) {
  if (!await bearerAccepted(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const prospectId = url.searchParams.get("prospect_id");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);

  const where = [];
  const params = [];
  if (status) { where.push("c.status = ?"); params.push(status); }
  if (prospectId) { where.push("c.prospect_id = ?"); params.push(prospectId); }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  // Aggregate stats
  let totals = {};
  try {
    const { results } = await env.LEADS_DB.prepare(`
      SELECT
        COUNT(*) AS contracts_total,
        SUM(CASE WHEN status = 'proposed' THEN 1 ELSE 0 END) AS proposed,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN status = 'viewed' THEN 1 ELSE 0 END) AS viewed,
        SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted,
        SUM(CASE WHEN status = 'contracted' THEN 1 ELSE 0 END) AS contracted,
        SUM(CASE WHEN status = 'invoiced' THEN 1 ELSE 0 END) AS invoiced,
        SUM(CASE WHEN status IN ('paid_partial','paid_full') THEN 1 ELSE 0 END) AS paid,
        SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
        SUM(CASE WHEN status = 'cancelled' OR status = 'lost' THEN 1 ELSE 0 END) AS lost,
        SUM(COALESCE(price_committed, price_high)) AS pipeline_value_cents,
        SUM(CASE WHEN status IN ('paid_partial','paid_full','delivered') THEN COALESCE(price_committed, price_high) ELSE 0 END) AS won_value_cents
      FROM prospect_contracts c
    `).all();
    totals = results?.[0] || {};
    totals.pipeline_value_usd = (totals.pipeline_value_cents || 0) / 100;
    totals.won_value_usd = (totals.won_value_cents || 0) / 100;
  } catch (e) {
    totals = { _error: String(e?.message || e) };
  }

  // List
  let contracts = [];
  try {
    const { results } = await env.LEADS_DB.prepare(`
      SELECT c.*,
             p.business_name, p.email AS prospect_email, p.vertical, p.status AS prospect_status
      FROM prospect_contracts c
      LEFT JOIN prospects p ON p.id = c.prospect_id
      ${whereSql}
      ORDER BY COALESCE(c.paid_at, c.contracted_at, c.proposed_at, c.created_at) DESC
      LIMIT ?
    `).bind(...params, limit).all();
    contracts = results || [];
  } catch (e) {
    return json({ ok: false, error: "list_failed", message: String(e?.message || e) }, 500, request, env);
  }

  return json({
    ok: true,
    count: contracts.length,
    totals,
    contracts,
  }, 200, request, env);
}

export async function onRequestPost({ request, env }) {
  if (!await bearerAccepted(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  let body = {};
  try { body = await request.json(); } catch {}
  const prospectId = body?.prospect_id;
  const serviceTitle = body?.service_title;
  if (!prospectId || !serviceTitle) {
    return json({ ok: false, error: "missing_fields", message: "prospect_id and service_title are required" }, 400, request, env);
  }

  const priceModel = body?.price_model || "one_time";
  if (!VALID_PRICE_MODELS.has(priceModel)) {
    return json({ ok: false, error: "invalid_price_model", valid: [...VALID_PRICE_MODELS] }, 400, request, env);
  }
  const status = body?.status || "proposed";
  if (!VALID_STATUSES.has(status)) {
    return json({ ok: false, error: "invalid_status", valid: [...VALID_STATUSES] }, 400, request, env);
  }

  // Verify prospect exists
  const { results: prs } = await env.LEADS_DB.prepare(`SELECT id, business_name FROM prospects WHERE id = ?`).bind(prospectId).all();
  if (!prs?.[0]) return json({ ok: false, error: "prospect_not_found" }, 404, request, env);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const priceLow = parseInt(body?.price_low || "0", 10) || 0;
  const priceHigh = parseInt(body?.price_high || "0", 10) || 0;
  const priceCommitted = parseInt(body?.price_committed || "0", 10) || null;

  try {
    await env.LEADS_DB.prepare(`
      INSERT INTO prospect_contracts
        (id, prospect_id, service_id, service_title, scope_text,
         price_model, price_low, price_high, price_committed, currency,
         status, proposed_at, quote_slug, invoice_slug, contract_pdf_url, notes)
      VALUES (?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?)
    `).bind(
      id, prospectId,
      body?.service_id || null,
      serviceTitle,
      body?.scope_text || null,
      priceModel, priceLow, priceHigh, priceCommitted,
      body?.currency || "USD",
      status,
      body?.proposed_at || now,
      body?.quote_slug || null,
      body?.invoice_slug || null,
      body?.contract_pdf_url || null,
      body?.notes || null,
    ).run();
  } catch (e) {
    return json({ ok: false, error: "insert_failed", message: String(e?.message || e) }, 500, request, env);
  }

  // Audit event
  try {
    await env.LEADS_DB.prepare(`
      INSERT INTO mayor_events (id, kind, loop, summary, details_json, created_at)
      VALUES (?, 'outreach', 'contract_created', ?, ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      `Contract ${status} for ${prs[0].business_name}: ${serviceTitle} ($${(priceLow/100).toFixed(2)}-$${(priceHigh/100).toFixed(2)})`,
      JSON.stringify({ contract_id: id, prospect_id: prospectId, service_title: serviceTitle, status, price_low: priceLow, price_high: priceHigh })
    ).run();
  } catch (_) {}

  return json({ ok: true, contract_id: id, prospect_id: prospectId, status, service_title: serviceTitle }, 200, request, env);
}