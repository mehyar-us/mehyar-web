export async function onRequestGet({ env }) {
  if (!env?.LEADS_DB) return Response.json({ ok: false, error: "database_unavailable" }, { status: 503 });
  const rows = await env.LEADS_DB.prepare(`SELECT slug, business_name, industry, location, title, subtitle, updated_at
    FROM sales_proposals WHERE status = 'complete' AND visibility = 'featured' ORDER BY updated_at DESC LIMIT 100`).all();
  return Response.json({ ok: true, proposals: rows.results || [] }, { headers: { "cache-control": "public, max-age=120" } });
}
