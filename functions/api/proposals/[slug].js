export async function onRequestGet({ env, params }) {
  if (!env?.LEADS_DB) return Response.json({ ok: false, error: "database_unavailable" }, { status: 503 });
  const proposal = await env.LEADS_DB.prepare(`SELECT p.id, p.slug, p.business_name, p.industry, p.location, p.title, p.subtitle, p.source_url, p.hero_asset_key,
    p.updated_at, p.current_revision_id, r.content_json, r.revision_number FROM sales_proposals p
    JOIN sales_proposal_revisions r ON r.id = p.current_revision_id
    WHERE p.slug = ? AND p.status = 'complete' AND p.visibility IN ('unlisted','featured') LIMIT 1`).bind(String(params.slug)).first();
  if (!proposal) return Response.json({ ok: false, error: "proposal_not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
  let content = {};
  try { content = JSON.parse(proposal.content_json || "{}"); } catch { /* guarded empty content */ }
  delete proposal.content_json;
  proposal.content = content;
  proposal.hero_url = proposal.hero_asset_key ? `/api/proposals/${encodeURIComponent(proposal.slug)}/assets/hero` : null;
  return Response.json({ ok: true, proposal }, { headers: { "cache-control": "public, max-age=60", "x-robots-tag": "noindex, nofollow" } });
}
