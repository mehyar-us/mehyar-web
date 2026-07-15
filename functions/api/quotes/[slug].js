// /api/quotes/[slug]  (PUBLIC — no auth)
//
// GET a hosted quote by public slug.
// Response: { ok, quote: { quote_number, client_name, items, total_usd, status, due_date, created_at } }

import { json, corsHeaders } from "../../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const slug = url.pathname.split("/").pop()?.split("?")[0] || "";
  if (!slug || slug.length < 3) return json({ ok: false, error: "bad_slug" }, 400, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  let row;
  try {
    row = await env.LEADS_DB.prepare(`
      SELECT quote_number, client_name, client_email, client_address, items_json,
             total_usd, status, due_days, created_at
      FROM quotes WHERE public_slug = ?
    `).bind(slug).first();
  } catch (e) {
    // Table may not exist yet (no quotes created)
    return json({ ok: false, error: "not_found" }, 404, request, env);
  }
  if (!row) return json({ ok: false, error: "not_found" }, 404, request, env);

  let items = [];
  try { items = JSON.parse(row.items_json || "[]"); } catch {}

  // Compute due date
  let dueDate = null;
  try {
    const created = new Date(row.created_at + "Z");
    const due = new Date(created.getTime() + Number(row.due_days || 15) * 24 * 3600 * 1000);
    dueDate = due.toISOString().slice(0, 10);
  } catch {}

  return json({
    ok: true,
    quote: {
      quote_number: row.quote_number,
      client_name: row.client_name,
      client_email: row.client_email,
      client_address: row.client_address,
      items,
      total_usd: row.total_usd,
      status: row.status,
      due_days: row.due_days,
      due_date: dueDate,
      created_at: row.created_at,
    },
  }, 200, request, env);
}
