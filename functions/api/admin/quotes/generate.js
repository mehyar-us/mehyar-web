// /api/admin/quotes/generate
//
// POST /api/admin/quotes/generate
// Generate a hosted quote (saved to DB, returns a public view URL).
//
// Body:
//   {
//     client_name:    string (required)
//     client_email:   string
//     client_address: string
//     items: [{ name, desc, qty, price }]
//     due_days:       number (default 15)
//     lead_id?:       string (optional, link back to a SAM/prospect)
//     lead_kind?:     "sam"|"prospect"
//   }
//
// Response: { ok, quote_id, quote_number, view_url, total_usd }

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400, request, env); }

  const { client_name, client_email, client_address, items, due_days, lead_id, lead_kind } = body || {};
  if (!client_name || !String(client_name).trim()) {
    return json({ ok: false, error: "client_name_required" }, 400, request, env);
  }
  if (!Array.isArray(items) || items.length === 0) {
    return json({ ok: false, error: "items_required" }, 400, request, env);
  }

  // Sanitize line items
  const safeItems = items
    .filter((it) => it?.name && String(it.name).trim())
    .map((it) => ({
      name: String(it.name).slice(0, 200),
      desc: String(it.desc || "").slice(0, 600),
      qty: Math.max(1, Number(it.qty) || 1),
      price: Math.max(0, Number(it.price) || 0),
    }));
  if (safeItems.length === 0) return json({ ok: false, error: "no_valid_items" }, 400, request, env);

  const total = safeItems.reduce((acc, it) => acc + it.qty * it.price, 0);

  // Ensure schema (idempotent CREATE IF NOT EXISTS)
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
      status TEXT DEFAULT 'quote',   -- quote | invoice | paid | void
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
  ]).catch((e) => {
    console.error("quotes table create", e?.message);
  });

  // Next quote number = max + 1
  const last = await env.LEADS_DB.prepare(`SELECT MAX(quote_number) as n FROM quotes`).first().catch(() => ({ n: 0 }));
  const quoteNumber = (Number(last?.n || 0) || 0) + 1;
  const quoteId = crypto.randomUUID();
  const publicSlug = `${quoteNumber}-${slugify(client_name)}-${quoteId.slice(0, 4).toLowerCase()}`;

  await env.LEADS_DB.prepare(`
    INSERT INTO quotes (id, quote_number, client_name, client_email, client_address, items_json, total_usd, due_days, status, lead_id, lead_kind, public_slug, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'quote', ?, ?, ?, datetime('now'), datetime('now'))
  `).bind(
    quoteId,
    quoteNumber,
    String(client_name).slice(0, 200),
    client_email ? String(client_email).slice(0, 200) : null,
    client_address ? String(client_address).slice(0, 400) : null,
    JSON.stringify(safeItems).slice(0, 48000),
    total,
    Number(due_days) || 15,
    lead_id || null,
    lead_kind || null,
    publicSlug,
  ).run().catch((e) => ({ error: e?.message }));

  // Audit
  try {
    await env.LEADS_DB.prepare(`
      INSERT INTO opportunity_events (id, kind, prospect_id, sam_id, event_type, actor, payload_json, created_at)
      VALUES (?, ?, ?, ?, 'quote_generated', 'owner', ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      lead_kind === "sam" ? "sam" : "prospect",
      lead_kind === "prospect" ? lead_id : null,
      lead_kind === "sam" ? lead_id : null,
      JSON.stringify({ quote_id: quoteId, quote_number: quoteNumber, total, items: safeItems.length }).slice(0, 16000),
    ).run();
  } catch {}

  // Public view URL (the SPA /q/[slug] page will render this)
  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const viewUrl = `${origin}/q/${publicSlug}`;

  return json({
    ok: true,
    quote_id: quoteId,
    quote_number: quoteNumber,
    public_slug: publicSlug,
    view_url: viewUrl,
    total_usd: total,
  }, 200, request, env);
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "client";
}
