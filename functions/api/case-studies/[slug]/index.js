// GET /api/case-studies/[slug]  — public read endpoint for a single case study
// 404 when not found or not published.
import { json, corsHeaders } from "./_adminAuth_local.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env, params }) {
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const slug = (params?.slug || "").slice(0, 200).replace(/[^a-z0-9-_]/g, "").toLowerCase();
  if (!slug) return json({ ok: false, error: "slug_required" }, 400, request, env);

  try {
    const study = await env.LEADS_DB.prepare(
      `SELECT id, slug, title, subtitle, vertical, client_name, clientLogo_url,
              challenge_short, challenge_body,
              solution_short, solution_body,
              result_body,
              metrics_json, tags,
              featured, published, published_at,
              created_at, updated_at
       FROM case_studies
       WHERE slug = ? AND published = 1`
    )
      .bind(slug)
      .first();

    if (!study) {
      return json({ ok: false, error: "not_found" }, 404, request, env);
    }

    // Fetch sub-pages for this case study
    const pages = await env.LEADS_DB.prepare(
      `SELECT id, page_order, page_title, page_slug, body_html,
              call_to_action, cta_url
       FROM case_study_pages
       WHERE case_study_id = ?
       ORDER BY page_order ASC`
    )
      .bind(study.id)
      .all();

    return json(
      {
        ok: true,
        item: {
          id: study.id,
          slug: study.slug,
          title: study.title,
          subtitle: study.subtitle,
          vertical: study.vertical,
          clientName: study.client_name,
          clientLogoUrl: study.clientLogo_url,
          challengeShort: study.challenge_short,
          challengeBody: study.challenge_body,
          solutionShort: study.solution_short,
          solutionBody: study.solution_body,
          resultBody: study.result_body,
          metrics: safeJsonParse(study.metrics_json, []),
          tags: safeJsonParse(study.tags, []),
          featured: !!study.featured,
          published: !!study.published,
          publishedAt: study.published_at,
          createdAt: study.created_at,
          updatedAt: study.updated_at,
          pages: (pages.results || []).map((p) => ({
            id: p.id,
            pageOrder: p.page_order,
            pageTitle: p.page_title,
            pageSlug: p.page_slug,
            bodyHtml: p.body_html,
            callToAction: p.call_to_action,
            ctaUrl: p.cta_url,
          })),
        },
      },
      200,
      request,
      env
    );
  } catch (err) {
    console.error("case-studies slug error", err);
    return json({ ok: false, error: "fetch_failed", details: String(err?.message || err) }, 500, request, env);
  }
}

function safeJsonParse(text, fallback = {}) {
  if (!text || typeof text !== "string") return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}
