// POST /api/admin/case-studies/from-opportunity  body { opportunity_id, opportunity_kind? }
// AI-drafts a public case study from the opportunity + brief + decision context.

import { verifyAdminToken, json, corsHeaders } from "./_local/_adminAuth.js";
import { chatJson } from "./_local/_llmChat.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const opportunityId = body?.opportunity_id || body?.id;
  if (!opportunityId) return json({ ok: false, error: "no_opportunity_id" }, 400, request, env);

  try {
    // Load opportunity + decision
    const opp = await env.LEADS_DB.prepare(`SELECT id, title, agency, kind FROM gov_opportunities WHERE id = ?`).bind(opportunityId).first().catch(() => null);
    if (!opp) return json({ ok: false, error: "opportunity_not_found" }, 404, request, env);

    const decision = await env.LEADS_DB.prepare(`
      SELECT decision, reason_code, reason_body FROM opportunity_decisions
      WHERE opportunity_id = ? AND kind = 'sam' ORDER BY decided_at DESC LIMIT 1
    `).bind(opportunityId).first().catch(() => null);
    if (!decision || decision.decision !== "won") {
      return json({ ok: false, error: "decision_not_won", message: "Mark the deal Won first." }, 400, request, env);
    }

    // Draft via LLM; fallback to template.
    const llm = await chatJson({
      env,
      messages: [
        {
          role: "system",
          content:
`You are a senior marketing writer at MehyarSoft LLC (small software agency in Brooklyn). You write public case studies in standard format:
- Title (≤ 60 chars)
- subtitle (≤ 120 chars)
- body_html (≤ 900 chars, simple HTML <p><h3><ul><li>). 3 sections: 'The challenge', 'What we built', 'Outcome'.
- seo_description (≤ 200 chars)
- meta_keywords (≤ 8 short keywords)

Make this look anonymous — the client is 'a federal agency' or 'a regulated business' (no real names unless you know them).`,
        },
        {
          role: "user",
          content: JSON.stringify({ opportunity: opp, decision }, null, 2).slice(0, 6000),
        },
      ],
      max_tokens: 1500,
      temperature: 0.4,
      json_mode: true,
    });

    let caseStudy;
    if (llm.used_llm && llm.content) {
      try { caseStudy = JSON.parse(llm.content); }
      catch {
        const m = String(llm.content).match(/\{[\s\S]*\}/);
        if (m) try { caseStudy = JSON.parse(m[0]); } catch {}
      }
    }
    caseStudy = caseStudy || templateCaseStudy(opp);

    const slug = (caseStudy.slug || opp.title || "case-study")
      .toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").slice(0, 80);

    const id = crypto.randomUUID();
    await env.LEADS_DB.prepare(`
      INSERT INTO case_studies (id, slug, title, subtitle, body_html, json_ld_json, opportunity_id, opportunity_kind, published, published_at, created_at, updated_at, vertical, client_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'sam', 1, datetime('now'), datetime('now'), datetime('now'), ?, ?, ?)
    `).bind(
      id, slug,
      String(caseStudy.title || opp.title || "Case Study").slice(0, 200),
      String(caseStudy.subtitle || "How MehyarSoft delivered").slice(0, 280),
      String(caseStudy.body_html || "<p>Case study.</p>").slice(0, 12000),
      JSON.stringify({ "@type": "Article", headline: caseStudy.title || opp.title, description: caseStudy.seo_description || "" }),
      opportunityId,
      String(opp.agency || "Federal").slice(0, 80),
      opp.agency || "Federal",
    ).run().catch(() => null);

    await env.LEADS_DB.prepare(`
      INSERT INTO opportunity_events (id, kind, prospect_id, sam_id, event_type, actor, payload_json, created_at)
      VALUES (?, 'sam', NULL, ?, 'case_study_created', 'owner', ?, datetime('now'))
    `).bind(crypto.randomUUID(), opportunityId, JSON.stringify({ slug, id, used_llm: !!llm.used_llm, llm_error: llm.error || null }).slice(0, 2000)).run().catch(() => null);

    return json({ ok: true, id, slug, case_study: caseStudy, used_llm: !!llm.used_llm }, 200, request, env);
  } catch (e) {
    return json({ ok: false, error: "case_study_failed", details: String(e?.message || e) }, 500, request, env);
  }
}

function templateCaseStudy(opp) {
  return {
    title: `${opp.agency || "Federal agency"} × MehyarSoft`,
    subtitle: "How a small software agency delivered on time and on budget",
    body_html: `
<h3>The challenge</h3><p>${opp.agency || "A federal agency"} needed a partner that could move fast while staying compliant.</p>
<h3>What we built</h3><p>MehyarSoft stood up an end-to-end solution using Cloudflare Workers, a custom dashboard, and a documented hand-off playbook.</p>
<h3>Outcome</h3><ul><li>Delivered on time</li><li>Documented for hand-off</li><li>Owner trained and confident</li></ul>`,
    seo_description: `MehyarSoft delivered ${opp.title || "a custom solution"} for ${opp.agency || "a federal agency"}.`,
    meta_keywords: ["case study","sam.gov","contract","cloudflare","software agency","brooklyn"],
  };
}
