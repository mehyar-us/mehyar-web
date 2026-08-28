export async function onRequestGet({ env, params }) {
  if (!env?.LEADS_DB || !env?.PROPOSAL_ASSETS) return new Response("Unavailable", { status: 503 });
  const proposal = await env.LEADS_DB.prepare("SELECT id, hero_asset_key FROM sales_proposals WHERE slug = ? AND status = 'complete' AND visibility IN ('unlisted','featured') LIMIT 1").bind(String(params.slug)).first();
  if (!proposal) return new Response("Not found", { status: 404 });
  const key = params.name === "hero" ? proposal.hero_asset_key : `proposals/${proposal.id}/${params.name}`;
  if (!key) return new Response("Not found", { status: 404 });
  const object = await env.PROPOSAL_ASSETS.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, { headers: { "content-type": object.httpMetadata?.contentType || "image/jpeg", "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" } });
}
