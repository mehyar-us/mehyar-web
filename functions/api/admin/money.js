// /api/admin/money — pipeline view for the Money tab.
//   kpis         headline numbers
//   funnel       by-stage aggregates (count, value_sum, avg_value)
//   open         currently-open deals sorted by stage + value desc
//   recent_won   /recent_lost  last decisions
//   case_studies list of generated case studies

import { verifyAdminToken, json, corsHeaders } from "../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  try {
    // SAM opportunities
    const samAll = await env.LEADS_DB.prepare(`
      SELECT id, title, agency, set_aside, fit_score, stage, estimated_value, response_deadline, created_at
      FROM gov_opportunities
    `).all().catch(() => ({ results: [] }));
    // Prospect opportunities (for context)
    const prospects = await env.LEADS_DB.prepare(`
      SELECT id, business_name as title, status as stage, leak_score, NULL as estimated_value, NULL as fit_score, NULL as set_aside, created_at
      FROM prospects WHERE status NOT IN ('archived','rejected')
    `).all().catch(() => ({ results: [] }));

    const allDeals = [
      ...(samAll.results || []).map((s) => ({ kind: "sam", ...s })),
      ...(prospects.results || []).map((p) => ({ kind: "prospect", ...p, estimated_value: 1500 })), // default prospect value
    ];

    // KPIs
    const total = allDeals.filter((d) => !["won","lost","archived","no_bid","rejected"].includes(d.stage));
    const pipeline_value = total.reduce((a, d) => a + (Number(d.estimated_value) || 0), 0);
    const weighted_forecast = total.reduce((a, d) => a + (Number(d.estimated_value) || 0) * stageWeight(d.stage) * fitWeight(d), 0);

    const won = await env.LEADS_DB.prepare(`
      SELECT outcome, value_usd, decided_at FROM opportunity_decisions
      WHERE outcome = 'won' AND decided_at >= datetime('now','-30 day')
    `).all().catch(() => ({ results: [] }));
    const wonValue30d = (won.results || []).reduce((a, w) => a + (Number(w.value_usd) || 0), 0);

    const closed = await env.LEADS_DB.prepare(`
      SELECT outcome FROM opportunity_decisions WHERE decided_at >= datetime('now','-30 day')
    `).all().catch(() => ({ results: [] }));
    const winRate = closed.results?.length
      ? Math.round(((closed.results.filter((c) => c.outcome === "won").length) / closed.results.length) * 100)
      : 0;

    const allValues = (samAll.results || []).filter((d) => d.estimated_value && d.estimated_value > 0).map((d) => d.estimated_value);
    const avgDeal = allValues.length ? allValues.reduce((a, b) => a + b, 0) / allValues.length : 0;

    const kpis = {
      pipeline_value,
      weighted_forecast: Math.round(weighted_forecast),
      won_value_30d: wonValue30d,
      win_rate_30d: winRate,
      avg_deal_size: Math.round(avgDeal),
      activity_to_win: 60,         // placeholder; computed from audit events later
      ai_suggestions_today: 0,     // placeholder
      outreach_failures_24h: 0,    // placeholder
    };

    // Funnel — by stage across kinds
    const stages = ["discovery","evaluating","drafting","ready","queued","sent","replied"];
    const funnel = stages.map((s) => {
      const inStage = total.filter((d) => (d.stage || "").toLowerCase() === s);
      const value = inStage.reduce((a, d) => a + (Number(d.estimated_value) || 0), 0);
      return {
        stage: s,
        count: inStage.length,
        value_usd_total: value,
        avg_value_usd: inStage.length ? value / inStage.length : 0,
      };
    });

    // Open deals
    const open = allDeals
      .filter((d) => !["won","lost","archived","no_bid","rejected"].includes(d.stage))
      .sort((a, b) => (Number(b.estimated_value) || 0) - (Number(a.estimated_value) || 0))
      .slice(0, 30)
      .map((d) => ({
        id: d.id, kind: d.kind, title: d.title, subtitle: `${d.agency || ""} ${d.set_aside ? "· " + d.set_aside : ""}`,
        stage: d.stage, fit_score: d.fit_score, estimated_value_usd: d.estimated_value || 0,
      }));

    // Recent wins/losses
    const decisions = await env.LEADS_DB.prepare(`
      SELECT d.outcome, d.value_usd, d.decided_at,
             COALESCE(o.title, p.business_name) as title,
             d.sam_id, d.prospect_id
      FROM opportunity_decisions d
      LEFT JOIN gov_opportunities o ON d.sam_id = o.id
      LEFT JOIN prospects p ON d.prospect_id = p.id
      WHERE d.decided_at >= datetime('now','-60 day')
      ORDER BY d.decided_at DESC LIMIT 20
    `).all().catch(() => ({ results: [] }));
    const recent_won = [];
    const recent_lost = [];
    for (const d of decisions.results || []) {
      const item = { id: d.sam_id || d.prospect_id, kind: d.sam_id ? "sam" : "prospect", title: d.title, stage: d.outcome, value_usd: d.value_usd, decision_at: d.decided_at };
      if (d.outcome === "won") recent_won.push(item);
      else if (d.outcome === "lost") recent_lost.push(item);
    }

    // Case studies
    const cs = await env.LEADS_DB.prepare(`
      SELECT id, slug, title, published, created_at FROM case_studies
      ORDER BY created_at DESC LIMIT 12
    `).all().catch(() => ({ results: [] }));

    return json({
      ok: true,
      kpis, funnel, open,
      recent_won, recent_lost,
      case_studies: cs.results || [],
      updatedAt: new Date().toISOString(),
    }, 200, request, env);
  } catch (e) {
    return json({ ok: false, error: "money_failed", details: String(e?.message || e) }, 500, request, env);
  }
}

function stageWeight(s) {
  const map = { discovery: 0.10, evaluating: 0.20, drafting: 0.40, ready: 0.50, queued: 0.55, sent: 0.40, replied: 0.70 };
  return map[(s || "").toLowerCase()] || 0.10;
}

function fitWeight(d) {
  if (d.kind === "sam") return Math.min(1, Math.max(0.1, (Number(d.fit_score) || 50) / 100));
  if (d.kind === "prospect") return Math.min(1, Math.max(0.2, (Number(d.leak_score) || 50) / 100));
  return 0.4;
}
