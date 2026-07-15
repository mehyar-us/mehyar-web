// POST /api/admin/leads/<id>/deep-evaluate?kind=prospect|sam   body { force? }
// Returns 3 service offerings × 3 pricing tiers, each priced for MehyarSoft capacity.
//
// Cached in opportunity_events event_type='deep_evaluate' for 12h.

import { verifyAdminToken, json, corsHeaders } from "../../../_shared/adminAuth.js";
import { chatJson } from "../../../_shared/llmChat.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const id = params.id;
  let body = {};
  try { body = await request.json(); } catch {}
  const force = body?.force === true;
  if (!["prospect","sam"].includes(kind)) return json({ ok: false, error: "kind_required" }, 400, request, env);
  if (!id) return json({ ok: false, error: "missing_id" }, 400, request, env);

  try {
    // Cache check
    if (!force) {
      const cached = await env.LEADS_DB.prepare(`
        SELECT payload_json, created_at FROM opportunity_events
        WHERE ${kind === "sam" ? "sam_id" : "prospect_id"} = ? AND event_type = 'deep_evaluate'
        ORDER BY created_at DESC LIMIT 1
      `).bind(id).first().catch(() => null);
      if (cached && new Date(cached.created_at).getTime() > Date.now() - 12*3600*1000) {
        return json({ ok: true, evaluation: safeJson(cached.payload_json, {}), cached: true, cached_at: cached.created_at }, 200, request, env);
      }
    }

    // Load underlying data
    const ctx = await loadContext(env, kind, id);
    if (!ctx) return json({ ok: false, error: "not_found" }, 404, request, env);

    const prompt = [
      {
        role: "system",
        content:
`You are a senior solutions engineer at MehyarSoft, a Brooklyn NY small software agency. You audit a real prospective client and propose services + pricing.
Return STRICT JSON only — no markdown fences — matching this exact shape:
{
  "verdict": "🟢 strong fit" | "🟡 evaluate further" | "🔴 not a fit",
  "fit_score": integer 0-100,
  "executive_summary": string ≤ 600 chars,
  "services": [
    { "name": string, "icon": string, "description": string ≤ 280 chars, "deliverables": [string ≤ 100 chars each, 3-6 items] }
    // exactly 3 services
  ],
  "pricing_tiers": [
    {
      "tier": "Starter" | "Growth" | "Premium",
      "price_min": integer USD,
      "price_max": integer USD,
      "monthly_min": integer monthly retainer USD,
      "monthly_max": integer monthly retainer USD,
      "scope": [string ≤ 100 chars each, 4-8 items]
    }
    // exactly 3 tiers
  ],
  "risk_flags": [string ≤ 120 chars],
  "next_action": string ≤ 200 chars
}

Pricing tiers MUST be:
- Starter:  $2,500–$6,000 one-time + $100–$250/mo  (≤ ~30 hrs)
- Growth:   $6,000–$18,000 one-time + $400–$900/mo (~50–90 hrs)
- Premium:  $20,000–$60,000 one-time + $1,500–$4,000/mo (~120–280 hrs)

For SAM.gov federal solicitations, recommend services that are compliant with the agency mission and address the specific pain points in the description. For B2B prospects with detected site leaks (no_ssl, no_booking_cta, etc.), propose fixes and a project scope that closes those gaps.`,
      },
      {
        role: "user",
        content: `Audit this prospect:\n\n${JSON.stringify(ctx, null, 2).slice(0, 16000)}`,
      },
    ];

    const llm = await chatJson({ env, messages: prompt, max_tokens: 1800, temperature: 0.3, json_mode: true });

    let evaluation;
    if (llm.used_llm && llm.content) {
      try { evaluation = JSON.parse(llm.content); }
      catch {
        const m = String(llm.content).match(/\{[\s\S]*\}/);
        if (m) { try { evaluation = JSON.parse(m[0]); } catch {} }
      }
    }
    if (!evaluation) evaluation = heuristicEvaluation(ctx);

    evaluation = normalizeEvaluation(evaluation);

    const auditId = crypto.randomUUID();
    const payload = { ...evaluation, model: llm.model || null, used_llm: !!llm.used_llm, llm_error: llm.error || null, context_hash: JSON.stringify(ctx).length };
    await env.LEADS_DB.prepare(`
      INSERT INTO opportunity_events (id, kind, prospect_id, sam_id, event_type, actor, payload_json, created_at)
      VALUES (?, ?, ?, ?, 'deep_evaluate', 'owner', ?, datetime('now'))
    `).bind(auditId, kind, kind === "sam" ? null : id, kind === "sam" ? id : null, JSON.stringify(payload).slice(0, 18000)).run().catch(() => null);

    // Mark last_deep_eval_at on the prospect so the cron can pick top-N + dedup 12h
    if (kind === "prospect") {
      await env.LEADS_DB.prepare(`UPDATE prospects SET last_deep_eval_at = datetime('now') WHERE id = ?`).bind(id).run().catch(() => null);
    }

    return json({ ok: true, evaluation, event_id: auditId, used_llm: !!llm.used_llm }, 200, request, env);
  } catch (e) {
    return json({ ok: false, error: "deep_evaluate_failed", details: String(e?.message || e) }, 500, request, env);
  }
}

async function loadContext(env, kind, id) {
  if (kind === "prospect") {
    const p = await env.LEADS_DB.prepare(`
      SELECT id, business_name, website, root_domain, email, phone, vertical, city, country, status, stage, source, last_scanned_at
      FROM prospects WHERE id = ? LIMIT 1
    `).bind(id).first().catch(() => null);
    if (!p) return null;
    const sig = await env.LEADS_DB.prepare(`
      SELECT has_ssl, has_booking_cta, has_phone_click_to_call, has_form_action, has_email_link, has_address,
             page_weight_kb, load_time_ms, detected_platform, leak_signals_json, leak_score, title
      FROM prospect_signals WHERE prospect_id = ? ORDER BY scanned_at DESC LIMIT 1
    `).bind(id).first().catch(() => null);
    const analysis = await env.LEADS_DB.prepare(`
      SELECT payload_json FROM opportunity_events WHERE prospect_id = ? AND event_type = 'analysis'
      ORDER BY created_at DESC LIMIT 1
    `).bind(id).first().catch(() => null);
    return {
      kind: "prospect",
      ...p,
      signals: sig ? { ...sig, leak_signals: safeJson(sig.leak_signals_json, []) } : null,
      analysis: analysis ? safeJson(analysis.payload_json, null) : null,
    };
  }
  const s = await env.LEADS_DB.prepare(`
    SELECT id, title, agency, office, opportunity_type, status, response_deadline, posted_date,
           estimated_value, set_aside, naics_codes_json, summary, fit_score, confidence, stage, raw_json
    FROM gov_opportunities WHERE id = ? LIMIT 1
  `).bind(id).first().catch(() => null);
  if (!s) return null;
  const raw = safeJson(s.raw_json || "{}", {});
  return {
    kind: "sam",
    ...s,
    description: String(raw.description || "").slice(0, 4000),
    attachments: Array.isArray(raw.attachments) ? raw.attachments.length : 0,
    contacts: extractContacts(raw),
  };
}

function extractContacts(raw) {
  const lists = (Array.isArray(raw.pointOfContact) ? raw.pointOfContact : []).concat(Array.isArray(raw.contacts) ? raw.contacts : []);
  const flat = [];
  for (const c of lists) if (Array.isArray(c)) flat.push(...c); else if (c) flat.push(c);
  return flat.slice(0, 4).map((c) => ({ name: c?.name, email: c?.email, phone: c?.phone }));
}

function heuristicEvaluation(ctx) {
  const ls = ctx.kind === "prospect" ? (ctx.signals?.leak_score ?? 30) : (ctx.fit_score ?? 30);
  const verdict = ls >= 60 ? "🟢 strong fit" : ls >= 30 ? "🟡 evaluate further" : "🔴 not a fit";

  let services = [
    { name: "Lead-Nurture Site Refresh",  icon: "✨", description: "Refresh the homepage, booking CTA, mobile responsiveness.", deliverables: ["Audit + recommendations doc","Homepage design refresh","Booking widget integration","Mobile QA + fixes","Google Search Console setup"] },
    { name: "Workflow Automation",         icon: "⚙", description: "Replace spreadsheet/manual handoffs with end-to-end automation.", deliverables: ["Process audit","3 core workflow automations","CRM integration","Dashboard for owner","30 days support"] },
    { name: "AI-Assisted Customer Touchpoints", icon: "🤖", description: "Add an LLM-backed chat, lead capture, and follow-up automation.", deliverables: ["AI chat on site","AI email follow-ups","Internal AI summarizer","Escalation rules","Analytics dashboard"] },
  ];

  if (ctx.kind === "sam") {
    services = [
      { name: "Section K/K-L Compliance Drafting",  icon: "📜", description: "Hand-craft the K and L responses for this solicitation.", deliverables: ["Section K representation draft","Section L compliance matrix","Certifications tracker","Owner confirmation checklist"] },
      { name: "Capture Management & Teaming",         icon: "🤝", description: "Position us as prime or teammate with realistic teaming partners.", deliverables: ["Teaming partner shortlist","Introduction outreach","Compliance gap analysis","Bid/no-bid memo","Pricing strategy"] },
      { name: "Delivery Engine (Capability Library)", icon: "🏗", description: "Build the past-performance + capability narrative and Section B pricing.", deliverables: ["Section B labor table","Past performance narrative","AI-assisted draft response","Revision round","Cover letter"] },
    ];
  }

  return {
    verdict,
    fit_score: ls,
    executive_summary: ctx.kind === "sam"
      ? `${ctx.agency || "Agency"} opportunity. Estimated value ${ctx.estimated_value || "—"}; deadline ${ctx.response_deadline || "—"}. ${ctx.summary?.slice(0, 240) || "—"}`
      : `${ctx.business_name} (${ctx.vertical || "service"}). Live site leak score ${ctx.signals?.leak_score ?? "?"}/100. ${(ctx.signals?.leak_signals || []).slice(0, 3).join(", ") || "—"}`,
    services,
    pricing_tiers: [
      { tier: "Starter", price_min: 2500, price_max: 6000, monthly_min: 100, monthly_max: 250, scope: ["Discovery + audit report","Top-priority fixes","Booking / forms / SSL","Mobile audit","30 day support"] },
      { tier: "Growth",  price_min: 6000, price_max: 18000, monthly_min: 400, monthly_max: 900, scope: ["Full site redesign","CRM integration","Custom dashboard","Two integrations","Monthly performance review","SEO shell + schema"] },
      { tier: "Premium", price_min: 20000, price_max: 60000, monthly_min: 1500, monthly_max: 4000, scope: ["Full platform rewrite","Legacy CMS migration","A/B testing + analytics","Slack/email support","Quarterly training","Priority response SLA"] },
    ],
    risk_flags: ctx.kind === "sam"
      ? ["Verify set-aside eligibility with SAM.gov entity registration","Confirm small-business size standard against current revenue","Confirm past-performance recency (last 5 years)"]
      : ["Confirm decision-maker email before sending","Verify site ownership before quoting maintenance","Validate budget via inbound call before deep proposal"],
    next_action: ctx.kind === "sam"
      ? "Open this row's Apply tab, click Run Auto-tender pipeline, review cover letter in /admin/auto-tender."
      : "Send a personalized email referencing the leak signal, propose Starter package, follow up in 5 days if no reply.",
  };
}

function normalizeEvaluation(e) {
  e = e || {};
  if (!["🟢 strong fit","🟡 evaluate further","🔴 not a fit"].includes(e.verdict)) {
    e.verdict = "🟡 evaluate further";
  }
  e.fit_score = Math.max(0, Math.min(100, Math.round(Number(e.fit_score) || 0)));
  e.executive_summary = String(e.executive_summary || "").slice(0, 800);
  if (!Array.isArray(e.services)) e.services = [];
  e.services = e.services.slice(0, 3).map((s) => ({
    name: String(s?.name || "").slice(0, 100) || "Service",
    icon: String(s?.icon || "🛠").slice(0, 8),
    description: String(s?.description || "").slice(0, 500),
    deliverables: Array.isArray(s?.deliverables) ? s.deliverables.slice(0, 8).map((d) => String(d).slice(0, 240)) : [],
  }));
  if (!Array.isArray(e.pricing_tiers)) e.pricing_tiers = [];
  e.pricing_tiers = e.pricing_tiers.slice(0, 3).map((t, i) => ({
    tier: ["Starter","Growth","Premium"][i] || t.tier || "Tier",
    price_min: Math.max(0, Math.round(Number(t?.price_min) || 0)),
    price_max: Math.max(0, Math.round(Number(t?.price_max) || 0)),
    monthly_min: Math.max(0, Math.round(Number(t?.monthly_min) || 0)),
    monthly_max: Math.max(0, Math.round(Number(t?.monthly_max) || 0)),
    scope: Array.isArray(t?.scope) ? t.scope.slice(0, 12).map((d) => String(d).slice(0, 240)) : [],
  }));
  if (!Array.isArray(e.risk_flags)) e.risk_flags = [];
  e.risk_flags = e.risk_flags.slice(0, 8).map((r) => String(r).slice(0, 240));
  e.next_action = String(e.next_action || "").slice(0, 300);
  return e;
}

function safeJson(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}
