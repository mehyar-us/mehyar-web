// POST /api/admin/opportunities/:id/enrich?kind=prospect|sam
// → Ask an LLM (Cloudflare Workers AI by default) to produce a structured,
//   emoji-rich review of this opportunity. Cached in opportunity_events
//   so we don't ask twice for the same one. If the LLM is unreachable we
//   still return a deterministic-but-decent summary from the existing
//   data so the UI is never empty.

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
  if (!id) return json({ ok: false, error: "missing_id" }, 400, request, env);
  if (kind !== "prospect" && kind !== "sam") return json({ ok: false, error: "kind_required" }, 400, request, env);

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const force = body?.force === true;

  // Load data
  let input;
  try {
    input = kind === "sam"
      ? await loadSam(env, id)
      : await loadProspect(env, id);
  } catch (e) {
    return json({ ok: false, error: "load_failed", details: String(e?.message || e) }, 500, request, env);
  }
  if (!input.found) {
    return json({ ok: false, error: "not_found" }, 404, request, env);
  }

  // Has a recent enrichment?
  const recent = await env.LEADS_DB.prepare(`
    SELECT id, payload_json, created_at FROM opportunity_events
    WHERE ${kind === "prospect" ? "prospect_id" : "sam_id"} = ? AND event_type = 'enrichment'
    ORDER BY created_at DESC LIMIT 1
  `).bind(id).first();

  if (recent && !force) {
    let cached;
    try { cached = JSON.parse(recent.payload_json); } catch { cached = {}; }
    return json({ ok: true, enriched: cached, cached: true, cached_at: recent.created_at }, 200, request, env);
  }

  // Try LLM; fall back to a structured heuristic.
  const llmAttempt = await chatJson({
    env,
    messages: [
      {
        role: "system",
        content: "You are a senior consultant helping a small US software agency (MehyarSoft) decide which business opportunities to pursue. You write crisp, structured, emoji-rich analyses in valid JSON. You never mention being an AI. No preamble, no markdown - just JSON.",
      },
      {
        role: "user",
        content: `Analyze this ${kind === "sam" ? "SAM.gov federal solicitation" : "B2B prospect"} for MehyarSoft (a small US software agency). Return STRICT JSON with these fields exactly:
  {
    "verdict": one of {"🟢 strong fit", "🟡 evaluate further", "🔴 not a fit"},
    "score": integer 0-100,
    "headline": max 80 char sentence with the verdict in plain language,
    "why_care": ["3 short bullets each max 110 chars"],
    "must_haves": ["explicit must-haves or requirements - bullets"],
    "nice_to_haves": ["optional asks - bullets"],
    "apply_plan": ["step-by-step proposal/email plan, max 7 steps, each max 120 chars"],
    "emails_to_target": ["extracted or inferred contact emails"],
    "estimated_hours": integer (your estimate of effort hours),
    "estimated_value_usd": integer or null,
    "win_probability_pct": 0-100,
    "risk_flags": ["⚠️ specific risks"],
    "next_action": max 80 char sentence describing THE ONE next thing to do
  }

Data:
${JSON.stringify(input.context, null, 2).slice(0, 18000)}`,
      },
    ],
    max_tokens: 1500,
    temperature: 0.2,
    json_mode: true,
  });

  let enriched, used_llm;
  if (llmAttempt.used_llm && llmAttempt.content) {
    used_llm = true;
    try {
      enriched = JSON.parse(llmAttempt.content);
    } catch {
      // tolerate partial: extract first {...} JSON block
      const m = String(llmAttempt.content).match(/\{[\s\S]*\}/);
      if (m) { try { enriched = JSON.parse(m[0]); } catch {} }
    }
  }
  if (!enriched) {
    used_llm = false;
    enriched = heuristicSummary(input.context, kind);
  }

  // Audit
  const auditId = crypto.randomUUID();
  try {
    await env.LEADS_DB.prepare(`
      INSERT INTO opportunity_events (id, kind, prospect_id, sam_id, event_type, actor, payload_json, created_at)
      VALUES (?, ?, ?, ?, 'enrichment', 'owner', ?, ?)
    `).bind(
      auditId,
      kind,
      kind === "prospect" ? id : null,
      kind === "sam" ? id : null,
      JSON.stringify({ ...enriched, used_llm, model: llmAttempt.model, llm_error: llmAttempt.error || null }).slice(0, 12000),
      new Date().toISOString(),
    ).run();

    // Bump last_touched_at
    const t = kind === "prospect" ? "prospects" : "gov_opportunities";
    await env.LEADS_DB.prepare(`UPDATE ${t} SET last_touched_at = ? WHERE id = ?`).bind(new Date().toISOString(), id).run();
  } catch (e) {
    console.error("audit failed", e);
  }

  return json({
    ok: true,
    enriched,
    used_llm,
    model: llmAttempt.model || null,
    cached: false,
    event_id: auditId,
  }, 200, request, env);
}

// ── Data loaders (minimal copy of detail to keep dependencies tight) ────────
async function loadSam(env, id) {
  const row = await env.LEADS_DB.prepare(`
    SELECT id, title, agency, opportunity_type, status, response_deadline, posted_date,
           set_aside, naics_codes_json, summary, fit_score, why_fit, why_not_fit,
           next_action, source_url, raw_json
    FROM gov_opportunities WHERE id = ? LIMIT 1
  `).bind(id).first();
  if (!row) return { found: false };
  const raw = safeJson(row.raw_json, {});
  return {
    found: true,
    context: {
      kind: "sam",
      id,
      title: row.title,
      agency: row.agency,
      type: row.opportunity_type,
      status: row.status,
      deadline: row.response_deadline,
      posted: row.posted_date,
      set_aside: row.set_aside,
      naics: safeJson(row.naics_codes_json, []),
      summary: row.summary,
      fit_score: row.fit_score,
      why_fit: row.why_fit,
      why_not_fit: row.why_not_fit,
      next_action: row.next_action,
      source_url: row.source_url,
      description: String(raw.description || "").slice(0, 4000),
      attachments: Array.isArray(raw.attachments) ? raw.attachments.map((a) => ({ name: a.name || a.title, url: a.url || a.href })) : [],
      contacts: extractContacts(raw),
    },
  };
}

async function loadProspect(env, id) {
  const row = await env.LEADS_DB.prepare(`
    SELECT id, business_name, website, root_domain, email, phone, vertical, city, country,
           status, meta_json, last_scanned_at
    FROM prospects WHERE id = ? LIMIT 1
  `).bind(id).first();
  if (!row) return { found: false };
  const sig = await env.LEADS_DB.prepare(`
    SELECT leak_score, leak_signals_json, detected_platform, has_ssl, has_booking_cta,
           has_form_action, page_weight_kb, load_time_ms, notes
    FROM prospect_signals WHERE prospect_id = ? ORDER BY scanned_at DESC LIMIT 1
  `).bind(id).first();
  return {
    found: true,
    context: {
      kind: "prospect",
      id,
      business_name: row.business_name,
      website: row.website || row.root_domain,
      email: row.email,
      phone: row.phone,
      vertical: row.vertical,
      city: row.city,
      country: row.country,
      status: row.status,
      last_scanned_at: row.last_scanned_at,
      signals: sig ? {
        leak_score: sig.leak_score,
        leak_signals: safeJson(sig.leak_signals_json, []),
        detected_platform: sig.detected_platform,
        has_ssl: !!sig.has_ssl,
        has_booking_cta: !!sig.has_booking_cta,
        has_form_action: !!sig.has_form_action,
        page_weight_kb: sig.page_weight_kb,
        load_time_ms: sig.load_time_ms,
        notes: sig.notes,
      } : null,
      meta: safeJson(row.meta_json, {}),
    },
  };
}

function extractContacts(raw) {
  const lists = []
    .concat(Array.isArray(raw.pointOfContact) ? raw.pointOfContact : [])
    .concat(Array.isArray(raw.contacts) ? raw.contacts : []);
  const flat = [];
  for (const c of lists) if (Array.isArray(c)) flat.push(...c); else if (c) flat.push(c);
  return flat.map((c) => ({
    name: c?.name || c?.fullName || null,
    email: c?.email || null,
    phone: c?.phone || null,
    type: c?.type || c?.category || null,
  })).filter((c) => c.name || c.email);
}

// ── Heuristic fallback (no LLM available) ───────────────────────────────────
function heuristicSummary(ctx, kind) {
  if (kind === "sam") {
    const days = ctx.deadline ? Math.ceil((new Date(ctx.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
    const overdue = days != null && days < 0;
    const verdict = overdue ? "🔴 past deadline" : (ctx.fit_score != null && ctx.fit_score >= 60 ? "🟡 evaluate further" : "🟡 evaluate further");
    return {
      verdict,
      score: ctx.fit_score != null ? ctx.fit_score : 50,
      headline: overdue
        ? `Deadline passed ${Math.abs(days)}d ago; marking for archive`
        : `${ctx.title?.slice(0, 60)} — fit score ${ctx.fit_score ?? "?"}/100`,
      why_care: [
        ctx.fit_score != null ? `🤖 AI fit score: ${ctx.fit_score}` : "🤖 No pre-computed fit score",
        ctx.set_aside ? `🏷️ Set-aside: ${ctx.set_aside}` : "🏷️ No set-aside declared",
        ctx.deadline ? `⏰ Deadline ${ctx.deadline} (${days != null ? Math.abs(days) : "?"} days ${days != null && days < 0 ? "overdue" : "remaining"})` : "⏰ No deadline set",
      ],
      must_haves: [
        ctx.agency ? `🏛️ Issued by: ${String(ctx.agency).slice(0, 80)}` : "🏛️ Issuing agency unknown",
        Array.isArray(ctx.naics) && ctx.naics.length ? `📋 NAICS: ${ctx.naics.join(", ")}` : "📋 Confirm NAICS eligibility",
      ],
      nice_to_haves: [
        ctx.description ? `📝 Description: ${ctx.description.slice(0, 100)}…` : "📝 Pull full text via /workspace endpoint",
        ctx.attachments?.length ? `📎 ${ctx.attachments.length} attachments listed` : "📎 No attachments indexed yet",
      ],
      apply_plan: [
        "🔐 Sign in to SAM.gov",
        "📂 Download all attachments and the SOW",
        "🧾 Confirm set-aside eligibility",
        "📝 Draft response outline (use the assistant)",
        "📤 Submit before deadline",
      ],
      emails_to_target: (ctx.contacts || []).map((c) => c.email).filter(Boolean),
      estimated_hours: 20,
      estimated_value_usd: null,
      win_probability_pct: 25,
      risk_flags: ["⚠️ Review all attachments before committing — eligibility and SOW matter most"],
      next_action: overdue ? "Archive this row" : `Open listing in SAM.gov (${ctx.deadline ?? "deadline TBD"})`,
    };
  }
  // prospect heuristic
  const score = ctx.signals?.leak_score ?? 0;
  const verdict = score >= 60 ? "🟢 strong fit" : score >= 30 ? "🟡 evaluate further" : "🔴 not a fit";
  return {
    verdict,
    score,
    headline: `${ctx.business_name} · leak score ${score}/100${ctx.signals?.detected_platform ? ` · ${ctx.signals.detected_platform}` : ""}`,
    why_care: [
      ctx.signals?.has_ssl === false ? "🔓 No SSL — instant credibility flag" : null,
      ctx.signals?.has_booking_cta === false ? "🚫 No booking CTA on site" : null,
      ctx.signals?.has_form_action === false ? "📭 No form action on homepage" : null,
      Array.isArray(ctx.signals?.leak_signals) && ctx.signals.leak_signals.length ? `🩸 ${ctx.signals.leak_signals.length} leak signals detected` : null,
    ].filter(Boolean),
    must_haves: [
      ctx.email ? `📧 Send to ${ctx.email}` : "🔍 Find decision-maker email",
      "📝 Reference their specific leak signals in the opener",
    ],
    nice_to_haves: [
      ctx.signals?.has_ssl === false ? "💡 Mention HTTPS migration in the offer" : null,
      ctx.signals?.has_booking_cta === false ? "💡 Offer an online booking widget" : null,
      ctx.signals?.leak_score && ctx.signals.leak_score < 30 ? "💡 Highlight that we found nothing — site looks tight" : null,
    ].filter(Boolean),
    apply_plan: [
      "👀 Visit site, screenshot weak spots",
      "✍️ Draft 5-sentence email pulling from signals",
      "🔍 Verify email via pattern / hunter",
      "📨 Send and log to opportunity_events",
      "🗓️ Follow up in 4 days if no reply",
    ],
    emails_to_target: ctx.email ? [ctx.email] : [],
    estimated_hours: 1,
    estimated_value_usd: 1500,
    win_probability_pct: Math.min(50, Math.max(5, score)),
    risk_flags: ctx.signals?.has_ssl === false ? ["⚠️ Confirm site still works before emailing"] : [],
    next_action: ctx.email ? `Draft + queue email to ${ctx.email}` : "Discover an email pattern first",
  };
}

function safeJson(s, fallback = null) {
  if (s == null || s === "") return fallback;
  try { return JSON.parse(s); } catch { return fallback ?? { _raw: String(s).slice(0, 200) }; }
}
