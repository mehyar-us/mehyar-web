// POST /api/admin/prospect-sources/analyze
//
// For one or more prospects, fetch the live site, hand the content to the LLM,
// and ask it to produce a structured analysis:
//   {
//     improvements: [
//        { title, priority ('high'|'med'|'low'), est_cost_usd, est_hours,
//          rationale, expected_impact }
//     ],
//     pricing_recommendation: {
//       package_recommendation: 'Starter'|'Growth'|'Premium'  (MehyarSoft tiers),
//       package_min_usd, package_max_usd,
//       one_time_min_usd, one_time_max_usd,
//       monthly_min_usd, monthly_max_usd,
//       rationale
//     },
//     positioning: [3 short bullets],
//     estimated_close_probability_pct: 0..100
//   }
//
// This is what the salesperson reads in /admin/prospect-sources before emailing.
//
// Cached in opportunity_events event_type='analysis' keyed by prospect_id + date.

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";
import { chatJson } from "../../_shared/llmChat.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const ids = Array.isArray(body?.ids) ? body.ids : (body?.id ? [body.id] : []);
  const force = body?.force === true;
  if (!ids.length) return json({ ok: false, error: "no_prospects", message: "Provide ids:['p_..'] or id:'p_..'" }, 400, request, env);

  const out = { ok: true, analyzed: [], skipped: [], errors: [] };
  for (const pid of ids) {
    try {
      const r = await analyzeOne({ env, prospectId: pid, force });
      if (r.skipped) out.skipped.push(r);
      else out.analyzed.push(r);
    } catch (e) {
      out.errors.push({ prospect_id: pid, error: String(e?.message || e) });
    }
  }
  return json(out, 200, request, env);
}

async function analyzeOne({ env, prospectId, force }) {
  const p = await env.LEADS_DB.prepare(`
    SELECT id, business_name, website, root_domain, vertical, city, email, phone, status
    FROM prospects WHERE id = ? LIMIT 1
  `).bind(prospectId).first();
  if (!p) throw new Error("prospect_not_found");

  // Cache hit: a 24h analysis row exists.
  const cached = await env.LEADS_DB.prepare(`
    SELECT id, payload_json, created_at FROM opportunity_events
    WHERE prospect_id = ? AND event_type = 'analysis' AND created_at > datetime('now', '-12 hour')
    ORDER BY created_at DESC LIMIT 1
  `).bind(prospectId).first();
  if (cached && !force) {
    let parsed;
    try { parsed = JSON.parse(cached.payload_json); } catch { parsed = {}; }
    return { prospect_id: prospectId, business_name: p.business_name, root_domain: p.root_domain, cached: true, cached_at: cached.created_at, analysis: parsed };
  }

  // Pull the latest signals.
  const sig = await env.LEADS_DB.prepare(`
    SELECT scanned_at, status_code, has_ssl, has_booking_cta, has_phone_click_to_call,
           has_form_action, has_email_link, has_address, page_weight_kb, load_time_ms,
           detected_platform, leak_signals_json, leak_score, title, notes
    FROM prospect_signals WHERE prospect_id = ? ORDER BY scanned_at DESC LIMIT 1
  `).bind(prospectId).first();
  const leakSignals = (sig && sig.leak_signals_json) ? safeJson(sig.leak_signals_json, []) : [];

  // Fetch live HTML (used by LLM as evidence).
  let html = "";
  let httpOk = false;
  let fetchTime = 0;
  if (p.website) {
    const t0 = Date.now();
    try {
      const r = await fetch(p.website, {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; MehyarSoftAnalyzer/1.0; +https://mehyar.us/bot)",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        },
        signal: AbortSignal.timeout(15000),
      });
      fetchTime = Date.now() - t0;
      httpOk = r.ok;
      if (httpOk) {
        const buf = await r.arrayBuffer();
        const cap = 350_000;
        const slice = buf.byteLength > cap ? buf.slice(0, cap) : buf;
        html = new TextDecoder("utf-8", { fatal: false }).decode(slice);
      }
    } catch (e) {
      fetchTime = Date.now() - t0;
    }
  }

  const visibleText = htmlToVisibleText(html).slice(0, 18000);

  const signalSnapshot = {
    website: p.website,
    business_name: p.business_name,
    vertical: p.vertical,
    city: p.city,
    leak_score: sig?.leak_score ?? null,
    has_ssl: !!(sig?.has_ssl),
    has_booking_cta: !!(sig?.has_booking_cta),
    has_form_action: !!(sig?.has_form_action),
    has_phone_click_to_call: !!(sig?.has_phone_click_to_call),
    has_email_link: !!(sig?.has_email_link),
    has_address: !!(sig?.has_address),
    detected_platform: sig?.detected_platform || "",
    leak_signals: leakSignals,
    page_weight_kb: sig?.page_weight_kb || 0,
    load_time_ms: sig?.load_time_ms || 0,
    http_ok: httpOk,
    fetch_time_ms: fetchTime,
    page_title: sig?.title || "",
    visible_text_excerpt: visibleText.slice(0, 4000),
  };

  // LLM call.
  const llmAttempt = await chatJson({
    env,
    messages: [
      {
        role: "system",
        content: [
          "You are a senior solutions engineer at MehyarSoft LLC (a Brooklyn NY small software agency that builds on Cloudflare, Stripe, Astro, and LLM tech).",
          "You are auditing a live client's website. Decide what to improve, what package to propose, and rough pricing.",
          "Return STRICT JSON only — no markdown fences — matching this exact shape:",
          JSON.stringify({
            improvements: "Array of {title, priority ('high'|'medium'|'low'), est_cost_usd (int), est_hours (int), rationale, expected_impact}",
            pricing_recommendation: "Object {package_recommendation ('Starter'|'Growth'|'Premium'), package_min_usd (int), package_max_usd (int), one_time_min_usd (int), one_time_max_usd (int), monthly_min_usd (int), monthly_max_usd (int), rationale (string)}",
            positioning: "3 short selling angles",
            estimated_close_probability_pct: "integer 0..100",
          })
        ].join("\n"),
      },
      {
        role: "user",
        content: "Audit this real client's site and propose improvements + pricing.\n\n" +
                 "Reference tiers:\n" +
                 "- Starter ($2.5k-$6k one-time + $100-$250/mo): one-page refresh + booking CTA + mobile fixes + form. ~20-30 hours.\n" +
                 "- Growth ($6k-$18k one-time + $400-$900/mo): SEO shell + custom forms + chat widget + CRM integration + monthly performance report. ~50-90 hours.\n" +
                 "- Premium ($20k-$60k + $1.5k-$4k/mo): full rewrite, migrations off legacy CMS, custom integrations, Slack/email support, advanced analytics. ~120-280 hours.\n\n" +
                 "Insights:\n" + JSON.stringify(signalSnapshot, null, 2).slice(0, 12000),
      },
    ],
    max_tokens: 1500,
    temperature: 0.25,
    json_mode: true,
  });

  let analysis;
  if (llmAttempt.used_llm && llmAttempt.content) {
    try { analysis = JSON.parse(llmAttempt.content); }
    catch {
      const m = String(llmAttempt.content).match(/\{[\s\S]*\}/);
      if (m) { try { analysis = JSON.parse(m[0]); } catch {} }
    }
  }
  if (!analysis) {
    analysis = heuristicAnalysis(signalSnapshot);
  }
  // Closes any obviously malformed fields
  analysis = normalizeAnalysis(analysis);

  // Persist (overwrites any older cached row of today).
  const auditId = crypto.randomUUID();
  const payload = {
    ...analysis,
    used_llm: !!llmAttempt.used_llm,
    llm_model: llmAttempt.model || null,
    llm_error: llmAttempt.error || null,
    signal_snapshot: signalSnapshot,
  };
  await env.LEADS_DB.prepare(`
    INSERT INTO opportunity_events (id, kind, prospect_id, sam_id, event_type, actor, payload_json, created_at)
    VALUES (?, 'prospect', ?, NULL, 'analysis', 'owner', ?, ?)
  `).bind(auditId, prospectId, JSON.stringify(payload).slice(0, 18000), new Date().toISOString()).run();

  // Bump last_touched_at
  try { await env.LEADS_DB.prepare(`UPDATE prospects SET last_touched_at=?, updated_at=? WHERE id=?`).bind(new Date().toISOString(), new Date().toISOString(), prospectId).run(); } catch {}

  return {
    prospect_id: prospectId,
    business_name: p.business_name,
    root_domain: p.root_domain,
    cached: false,
    analysis,
  };
}

function heuristicAnalysis(s) {
  const improvements = [];
  if (!s.has_ssl) improvements.push({ title: "Switch site to HTTPS / install SSL", priority: "high", est_cost_usd: 350, est_hours: 3, rationale: "HTTPS is now table stakes; browsers flag the site as Not Secure.", expected_impact: "Trust uplift, removes chrome warning." });
  if (!s.has_booking_cta) improvements.push({ title: "Add online booking CTA + click-to-call", priority: "high", est_cost_usd: 900, est_hours: 8, rationale: "Local service prospects book offline without it.", expected_impact: "Captures after-hours demand." });
  if (!s.has_form_action) improvements.push({ title: "Add a working contact form with spam guard", priority: "medium", est_cost_usd: 600, est_hours: 6, rationale: "No inquiry path other than email.", expected_impact: "Higher lead capture from SEO traffic." });
  if (!s.has_phone_click_to_call) improvements.push({ title: "Make phone number click-to-call on mobile", priority: "medium", est_cost_usd: 350, est_hours: 2, rationale: "Mobile visitors want one-tap call.", expected_impact: "Mobile call conversions." });
  if (!s.has_address) improvements.push({ title: "Display physical address in schema.org LocalBusiness markup", priority: "medium", est_cost_usd: 350, est_hours: 2, rationale: "Helps local SEO.", expected_impact: "Local pack ranking + trust." });
  if ((s.page_weight_kb || 0) > 1500) improvements.push({ title: "Trim page weight — CDN, defer scripts, smaller images", priority: "low", est_cost_usd: 700, est_hours: 6, rationale: "Site is heavy; hurts mobile UX.", expected_impact: "Faster load, better Core Web Vitals." });
  if ((s.load_time_ms || 0) > 3000) improvements.push({ title: "Improve Time-to-First-Byte — caching, edge", priority: "low", est_cost_usd: 500, est_hours: 4, rationale: "Slow TTFB; hurts SEO.", expected_impact: "Lower bounce." });
  if (!improvements.length) improvements.push({ title: "Foundational audit only — site is already in good shape", priority: "low", est_cost_usd: 1500, est_hours: 8, rationale: "No showstopper signals. Maintain and grow with SEO + content.", expected_impact: "Steady trajectory." });

  // Pricing tier
  const highCount = improvements.filter((i) => i.priority === "high").length;
  const medCount = improvements.filter((i) => i.priority === "medium").length;
  let pkg = "Starter", minOneTime = 2500, maxOneTime = 6000, minMo = 100, maxMo = 250;
  if (highCount >= 3 || medCount >= 3) { pkg = "Premium"; minOneTime = 20000; maxOneTime = 60000; minMo = 1500; maxMo = 4000; }
  else if (highCount >= 1 && medCount >= 2) { pkg = "Growth"; minOneTime = 6000; maxOneTime = 18000; minMo = 400; maxMo = 900; }
  else if (highCount === 0 && medCount <= 1) { pkg = "Starter"; minOneTime = 2500; maxOneTime = 6000; minMo = 100; maxMo = 250; }

  return {
    improvements,
    pricing_recommendation: {
      package_recommendation: pkg,
      package_min_usd: minOneTime,
      package_max_usd: maxOneTime,
      one_time_min_usd: minOneTime,
      one_time_max_usd: maxOneTime,
      monthly_min_usd: minMo,
      monthly_max_usd: maxMo,
      rationale: `Recommended ${pkg} based on ${highCount} high-priority and ${medCount} medium-priority improvements across the analyzed site.`,
    },
    positioning: [
      "We improve the parts the visitors actually see and the parts the search engines actually score.",
      "No $20k retainer. Pay for the rebuild, optional small monthly support.",
      "Brooklyn-based, fast turnaround, plain-English updates.",
    ],
    estimated_close_probability_pct: Math.min(85, 25 + 10 * highCount + 5 * medCount),
  };
}

function normalizeAnalysis(a) {
  if (!a || typeof a !== "object") a = {};
  if (!Array.isArray(a.improvements)) a.improvements = [];
  a.improvements = a.improvements.map((i) => ({
    title: String(i.title || "").slice(0, 200) || "Improvement",
    priority: ["high","medium","low"].includes((i.priority||"").toLowerCase()) ? i.priority.toLowerCase() : "medium",
    est_cost_usd: Math.max(0, Math.round(Number(i.est_cost_usd) || 0)),
    est_hours: Math.max(0, Math.round(Number(i.est_hours) || 0)),
    rationale: String(i.rationale || "").slice(0, 600),
    expected_impact: String(i.expected_impact || "").slice(0, 300),
  }));
  if (!a.pricing_recommendation || typeof a.pricing_recommendation !== "object") a.pricing_recommendation = {};
  const p = a.pricing_recommendation;
  p.package_recommendation = ["Starter","Growth","Premium"].includes(p.package_recommendation) ? p.package_recommendation : "Starter";
  for (const k of ["package_min_usd","package_max_usd","one_time_min_usd","one_time_max_usd","monthly_min_usd","monthly_max_usd"]) {
    p[k] = Math.max(0, Math.round(Number(p[k]) || 0));
  }
  p.rationale = String(p.rationale || "").slice(0, 600);
  if (!Array.isArray(a.positioning)) a.positioning = [];
  a.positioning = a.positioning.slice(0, 5).map((s) => String(s || "").slice(0, 280));
  a.estimated_close_probability_pct = Math.max(0, Math.min(100, Math.round(Number(a.estimated_close_probability_pct) || 0)));
  return a;
}

function htmlToVisibleText(html) {
  if (!html) return "";
  // Strip scripts, styles
  let s = html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ");
  // Replace tags with spaces
  s = s.replace(/<[^>]+>/g, " ");
  // Decode common entities
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function safeJson(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}
