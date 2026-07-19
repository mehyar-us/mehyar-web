// /api/mayor/contracts/[id] — single contract detail + status transitions.
//
// GET  — full contract record + event log
// POST { action: "send"|"view"|"accept"|"invoice"|"pay"|"deliver"|"cancel"|"lost"|"note", ... }
//       — lifecycle transitions (writes event + updates timestamps)
// PATCH { ...fields } — edit price/scope/notes

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

// Map action → { new_status, timestamp_column }
const TRANSITIONS = {
  send:      { status: "sent",       col: "sent_at",      event: "sent" },
  view:      { status: "viewed",     col: "viewed_at",    event: "viewed" },
  accept:    { status: "accepted",   col: "accepted_at",  event: "accepted" },
  contract:  { status: "contracted", col: "contracted_at",event: "signed" },
  invoice:   { status: "invoiced",   col: "invoiced_at",  event: "invoice_viewed" },
  pay_partial:{ status: "paid_partial", col: "paid_at",   event: "invoice_paid" },
  pay:       { status: "paid_full",  col: "paid_at",      event: "invoice_paid" },
  deliver:   { status: "delivered",  col: "delivered_at", event: "note" },
  cancel:    { status: "cancelled",  col: "cancelled_at", event: "note" },
  lost:      { status: "lost",       col: "cancelled_at", event: "note" },
  renew:     { status: "renewed",    col: "paid_at",      event: "note" },
};

export async function onRequestGet({ request, env, params }) {
  if (!await bearerAccepted(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const id = params?.id;
  if (!id) return json({ ok: false, error: "missing_id" }, 400, request, env);

  const { results } = await env.LEADS_DB.prepare(`
    SELECT c.*, p.business_name, p.email AS prospect_email, p.vertical, p.city, p.status AS prospect_status
    FROM prospect_contracts c
    LEFT JOIN prospects p ON p.id = c.prospect_id
    WHERE c.id = ?
  `).bind(id).all();
  const contract = results?.[0];
  if (!contract) return json({ ok: false, error: "contract_not_found" }, 404, request, env);

  const { results: events } = await env.LEADS_DB.prepare(`
    SELECT id, event, payload_json, ip_address, user_agent, created_at
    FROM prospect_contract_events
    WHERE contract_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `).bind(id).all();

  return json({ ok: true, contract, events: events || [] }, 200, request, env);
}

export async function onRequestPost({ request, env, params }) {
  if (!await bearerAccepted(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const id = params?.id;
  if (!id) return json({ ok: false, error: "missing_id" }, 400, request, env);

  let body = {};
  try { body = await request.json(); } catch {}
  const action = body?.action;
  const t = TRANSITIONS[action];
  if (!t) {
    return json({ ok: false, error: "unknown_action", valid: Object.keys(TRANSITIONS) }, 400, request, env);
  }

  const db = env.LEADS_DB;
  const { results: crs } = await db.prepare(`SELECT * FROM prospect_contracts WHERE id = ?`).bind(id).all();
  const contract = crs?.[0];
  if (!contract) return json({ ok: false, error: "contract_not_found" }, 404, request, env);

  // Build dynamic SET clause for the timestamp + status
  const extraSets = [];
  const extraParams = [];
  if (action === "accept" && body?.price_committed) {
    extraSets.push("price_committed = ?"); extraParams.push(parseInt(body.price_committed, 10) || null);
  }
  if (action === "contract" && body?.contract_pdf_url) {
    extraSets.push("contract_pdf_url = ?"); extraParams.push(body.contract_pdf_url);
  }
  if (action === "invoice" && body?.invoice_slug) {
    extraSets.push("invoice_slug = ?"); extraParams.push(body.invoice_slug);
  }

  try {
    await db.prepare(`
      UPDATE prospect_contracts
         SET status = ?,
             ${t.col} = datetime('now'),
             updated_at = datetime('now')${extraSets.length ? ", " + extraSets.join(", ") : ""}
       WHERE id = ?
    `).bind(t.status, ...extraParams, id).run();
  } catch (e) {
    return json({ ok: false, error: "update_failed", message: String(e?.message || e) }, 500, request, env);
  }

  // Append event row
  try {
    await db.prepare(`
      INSERT INTO prospect_contract_events (id, contract_id, prospect_id, event, payload_json, ip_address, user_agent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      id,
      contract.prospect_id,
      t.event,
      JSON.stringify(body?.payload || { action }),
      request.headers.get("cf-connecting-ip") || null,
      (request.headers.get("user-agent") || "").slice(0, 200),
    ).run();
  } catch (_) {}

  // Mirror to mayor_events for the audit trail
  try {
    await db.prepare(`
      INSERT INTO mayor_events (id, kind, loop, summary, details_json, created_at)
      VALUES (?, 'outreach', 'contract_${t.event}', ?, ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      `Contract ${action}: ${contract.service_title} (${contract.prospect_id})`,
      JSON.stringify({ contract_id: id, action, new_status: t.status, payload: body?.payload || null })
    ).run();
  } catch (_) {}

  // If paid_full or paid_partial, mark prospect as 'closed-won' so funnel updates
  if (action === "pay" || action === "pay_partial" || action === "deliver") {
    try {
      await db.prepare(`UPDATE prospects SET status = CASE WHEN ? IN ('paid_full','delivered') THEN 'closed_won' ELSE status END, updated_at = datetime('now') WHERE id = ?`)
        .bind(t.status, contract.prospect_id).run();
    } catch (_) {}
  }

  return json({ ok: true, contract_id: id, action, new_status: t.status }, 200, request, env);
}

export async function onRequestPatch({ request, env, params }) {
  if (!await bearerAccepted(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const id = params?.id;
  if (!id) return json({ ok: false, error: "missing_id" }, 400, request, env);

  let body = {};
  try { body = await request.json(); } catch {}

  const allowed = ["service_title", "scope_text", "price_low", "price_high", "price_committed", "currency", "notes", "quote_slug", "invoice_slug", "contract_pdf_url"];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (k in body) { sets.push(`${k} = ?`); vals.push(body[k]); }
  }
  if (sets.length === 0) return json({ ok: false, error: "no_fields" }, 400, request, env);
  sets.push("updated_at = datetime('now')");

  try {
    await env.LEADS_DB.prepare(`UPDATE prospect_contracts SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();
  } catch (e) {
    return json({ ok: false, error: "update_failed", message: String(e?.message || e) }, 500, request, env);
  }
  return json({ ok: true, contract_id: id, updated: Object.keys(body) }, 200, request, env);
}