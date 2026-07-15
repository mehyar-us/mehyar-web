// /api/admin/leads/:id?kind=prospect|sam
// Unified detail - re-uses the same shape as /opportunities/[id] but
// dispatches based on `kind`.

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env, params }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const id = params.id;
  if (!id) return json({ ok: false, error: "missing_id" }, 400, request, env);
  if (kind !== "prospect" && kind !== "sam") return json({ ok: false, error: "kind_required", accepted: ["prospect","sam"] }, 400, request, env);

  try {
    if (kind === "prospect") {
      const row = await env.LEADS_DB.prepare(`
        SELECT id, business_name, website, root_domain, email, phone, vertical, city, country,
               stage, status, source, last_contact_at, last_scanned_at, last_drafted_at,
               meta_json, created_at
        FROM prospects WHERE id = ? LIMIT 1
      `).bind(id).first().catch(() => null);
      if (!row) return json({ ok: false, error: "not_found" }, 404, request, env);

      const sig = await env.LEADS_DB.prepare(`
        SELECT has_ssl, has_booking_cta, has_phone_click_to_call, has_form_action, has_email_link,
               has_address, page_weight_kb, load_time_ms, detected_platform, leak_signals_json,
               leak_score, title, status_code, scanned_at
        FROM prospect_signals WHERE prospect_id = ? ORDER BY scanned_at DESC LIMIT 1
      `).bind(id).first().catch(() => null);

      const lastAnalysis = await env.LEADS_DB.prepare(`
        SELECT payload_json, created_at FROM opportunity_events
        WHERE prospect_id = ? AND event_type = 'analysis' ORDER BY created_at DESC LIMIT 1
      `).bind(id).first().catch(() => null);

      return json({
        ok: true, kind: "prospect", opportunity: {
          ...row,
          meta: safeJson(row.meta_json, {}),
          signals: sig ? { ...sig, leak_signals: safeJson(sig.leak_signals_json, []) } : null,
          analysis: lastAnalysis ? safeJson(lastAnalysis.payload_json, null) : null,
          analysis_at: lastAnalysis?.created_at || null,
        },
      }, 200, request, env);
    }

    // SAM
    const row = await env.LEADS_DB.prepare(`
      SELECT id, dedupe_key, source, source_id, source_url, title, agency, office,
             opportunity_type, status, posted_date, response_deadline, estimated_value,
             set_aside, naics_codes_json, summary, fit_score, confidence, stage,
             created_at, updated_at
      FROM gov_opportunities WHERE id = ? LIMIT 1
    `).bind(id).first().catch(() => null);
    if (!row) return json({ ok: false, error: "not_found" }, 404, request, env);

    const raw = safeJson(row.raw_json || row.meta_json || "{}", {});

    // Extract attachments / poc / requirements / how-to-apply
    const attachments = extractAttachments(raw);
    const poc = extractContacts(raw);
    const requirements = deriveRequirements(row, raw);
    const howToApply = deriveHowToApply(row, raw);

    // Latest brief + decision
    const brief = await env.LEADS_DB.prepare(`
      SELECT id, executive_summary, why_we_fit, why_we_dont_fit, bid_decision,
             estimated_effort_hours, estimated_value_usd, next_step
      FROM gov_opportunity_briefs WHERE opportunity_id = ? LIMIT 1
    `).bind(id).first().catch(() => null);

    const decision = await env.LEADS_DB.prepare(`
      SELECT outcome, value_usd, notes, decided_at
      FROM opportunity_decisions WHERE sam_id = ? ORDER BY decided_at DESC LIMIT 1
    `).bind(id).first().catch(() => null);

    return json({
      ok: true, kind: "sam", opportunity: {
        ...row,
        attachments,
        poc,
        requirements,
        how_to_apply: howToApply,
        brief,
        decision,
      },
    }, 200, request, env);
  } catch (e) {
    return json({ ok: false, error: "detail_failed", details: String(e?.message || e) }, 500, request, env);
  }
}

function safeJson(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

function extractAttachments(raw) {
  const pool = []
    .concat(Array.isArray(raw.attachments) ? raw.attachments : [])
    .concat(Array.isArray(raw.resourceLinks) ? raw.resourceLinks : []);
  return pool.map((a) => ({
    name: a?.name || a?.title || a?.description || "Attachment",
    url: a?.url || a?.href || null,
    type: a?.type || null,
  })).filter((x) => x.url);
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
    role: c?.type || c?.role || null,
  })).filter((c) => c.name || c.email || c.phone);
}

function deriveRequirements(row, raw) {
  const out = [];
  if (row.set_aside) out.push({ key: "set_aside", label: "Set-Aside", value: row.set_aside });
  if (Array.isArray(row.naics_codes_json ? JSON.parse(row.naics_codes_json || "[]") : [])) {
    const arr = (() => { try { return JSON.parse(row.naics_codes_json); } catch { return []; } })();
    if (arr.length) out.push({ key: "naics", label: "NAICS", value: arr.join(", ") });
  }
  if (row.response_deadline) out.push({ key: "deadline", label: "Response Deadline", value: String(row.response_deadline) });
  return out;
}

function deriveHowToApply(row, raw) {
  const steps = [];
  if (row.source_url) steps.push({ step: 1, label: "Open listing", url: row.source_url });
  if (row.agency) steps.push({ step: 2, label: "Identify the contracting office", value: row.agency });
  if (row.response_deadline) steps.push({ step: 3, label: "Response deadline", value: row.response_deadline });
  steps.push({ step: 4, label: "Sign in to SAM.gov and review attachment package" });
  if (row.set_aside) steps.push({ step: 5, label: "Confirm set-aside eligibility", value: row.set_aside });
  return steps;
}
