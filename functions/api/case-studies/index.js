// GET /api/case-studies              — list published case studies (public)
// GET /api/case-studies?vertical=x  — filter by vertical
// GET /api/case-studies/[slug]      — handled by [slug]/index.js
import { json, corsHeaders } from "../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env }) {
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const url = new URL(request.url);
  const vertical = (url.searchParams.get("vertical") || "").slice(0, 60).trim();
  const featured = url.searchParams.get("featured") === "1";

  try {
    let sql = `
      SELECT id, slug, title, subtitle, vertical, client_name,
             clientLogo_url, challenge_short, solution_short,
             metrics_json, tags, featured, published_at,
             created_at, updated_at
      FROM case_studies
      WHERE published = 1
    `;
    const binds = [];

    if (vertical) {
      sql += " AND vertical = ?";
      binds.push(vertical);
    }
    if (featured) {
      sql += " AND featured = 1";
    }

    sql += " ORDER BY featured DESC, published_at DESC LIMIT 50";

    const result = await env.LEADS_DB.prepare(sql).bind(...binds).all();

    const items = (result.results || []).map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      subtitle: r.subtitle,
      vertical: r.vertical,
      clientName: r.client_name,
      clientLogoUrl: r.clientLogo_url,
      challengeShort: r.challenge_short,
      solutionShort: r.solution_short,
      metrics: safeJsonParse(r.metrics_json, []),
      tags: safeJsonParse(r.tags, []),
      featured: !!r.featured,
      publishedAt: r.published_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    return json({ ok: true, items, total: items.length }, 200, request, env);
  } catch (err) {
    console.error("case-studies list error", err);
    return json({ ok: false, error: "fetch_failed", details: String(err?.message || err) }, 500, request, env);
  }
}

function safeJsonParse(text, fallback = {}) {
  if (!text || typeof text !== "string") return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}
