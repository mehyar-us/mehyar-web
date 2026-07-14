// GET /api/admin/opportunities/:id?kind=prospect|sam
//   → One unified detail record with the full signal set, draft context,
//     action history, contact timeline. Powers /admin/opportunities/[id].
//
// IMPORTANT — these SELECTs match the actual schema on D1 as of 2026-07-14.
// Re-check columns if migrations change: PRAGMA table_info(<table>).

import { verifyAdminToken, json, corsHeaders } from "../../../_shared/adminAuth.js";

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
  if (kind !== "prospect" && kind !== "sam") {
    return json({ ok: false, error: "kind_required", accepted: ["prospect", "sam"] }, 400, request, env);
  }

  try {
    if (kind === "prospect") {
      return json({ ok: true, kind: "prospect", opportunity: await getProspect(env, id), events: await eventsFor(env, "prospect", id) }, 200, request, env);
    }
    return json({ ok: true, kind: "sam", opportunity: await getSam(env, id), events: await eventsFor(env, "sam", id) }, 200, request, env);
  } catch (err) {
    console.error("opportunity detail error", err);
    return json({ ok: false, error: "unhandled", details: String(err?.message || err) }, 500, request, env);
  }
}

// ── Prospect ─────────────────────────────────────────────────────────────────
async function getProspect(env, id) {
  let row;
  try {
    row = await env.LEADS_DB.prepare(`
      SELECT id, created_at, updated_at, source, source_ref, business_name, website, root_domain,
             email, email_source, phone, vertical, city, region, country, postal_code,
             status, consent_state, last_scanned_at, last_drafted_at, last_sent_at, last_contact_at,
             meta_json, stage, last_touched_at
      FROM prospects WHERE id = ? LIMIT 1
    `).bind(id).first();
  } catch (e) {
    throw new Error("prospect_query_failed: " + (e?.message || e));
  }
  if (!row) throw new Error("prospect_not_found");

  let signals = null;
  try {
    signals = await env.LEADS_DB.prepare(`
      SELECT id, scanned_at, http_ok, https_ok, redirect_url, status_code,
             title, has_viewport, has_booking_cta, has_phone_click_to_call, has_form_action,
             has_email_link, has_address, has_ssl, ssl_expires_at, page_weight_kb, load_time_ms,
             detected_platform, detected_cms_hints, leak_signals_json, leak_score, notes
      FROM prospect_signals WHERE prospect_id = ? ORDER BY scanned_at DESC LIMIT 1
    `).bind(id).first();
  } catch (e) { /* signals optional */ }

  let latestDraft = null;
  try {
    latestDraft = await env.LEADS_DB.prepare(`
      SELECT id, created_at, subject, body_text, body_html, status, reviewer_notes
      FROM prospect_drafts WHERE prospect_id = ? ORDER BY created_at DESC LIMIT 1
    `).bind(id).first();
  } catch (e) { /* drafts optional */ }

  let recentSends = { results: [] };
  try {
    recentSends = await env.LEADS_DB.prepare(`
      SELECT id, created_at, provider, provider_id, to_email, status, failure_reason
      FROM prospect_sends WHERE prospect_id = ? ORDER BY created_at DESC LIMIT 5
    `).bind(id).all();
  } catch (e) { /* sends optional */ }

  let replies = { results: [] };
  try {
    replies = await env.LEADS_DB.prepare(`
      SELECT id, received_at, from_email, subject, body_excerpt, classification
      FROM prospect_replies WHERE prospect_id = ? ORDER BY received_at DESC LIMIT 5
    `).bind(id).all();
  } catch (e) { /* replies optional */ }

  return {
    ...row,
    meta_json: safeJson(row.meta_json, {}),
    signals: signals ? { ...signals, leak_signals_json: safeJson(signals.leak_signals_json, []), detected_cms_hints: safeJson(signals.detected_cms_hints, []) } : null,
    latestDraft: latestDraft ? { ...latestDraft, body_html: latestDraft.body_html || "" } : null,
    recentSends: recentSends.results || [],
    replies: replies.results || [],
  };
}

// ── SAM.gov opportunity ──────────────────────────────────────────────────────
async function getSam(env, id) {
  let row;
  try {
    row = await env.LEADS_DB.prepare(`
      SELECT id, dedupe_key, source, source_id, source_url, title, agency, office,
             opportunity_type, status, posted_date, response_deadline, estimated_value,
             set_aside, naics_codes_json, summary, fit_score, confidence, why_fit, why_not_fit,
             next_action, owner_notes, raw_json, stage, last_touched_at, created_at, updated_at
      FROM gov_opportunities WHERE id = ? LIMIT 1
    `).bind(id).first();
  } catch (e) {
    throw new Error("sam_query_failed: " + (e?.message || e));
  }
  if (!row) throw new Error("sam_not_found");

  const raw = safeJson(row.raw_json, {});

  const attachments = extractAttachments(raw);
  const poc = extractPoc(raw);

  let drafts = { results: [] };
  try {
    drafts = await env.LEADS_DB.prepare(`
      SELECT id, opportunity_id, created_at, updated_at, status, owner_review_only,
             auto_submit_allowed, generated_by, owner_notes, reviewed_by, reviewed_at
      FROM gov_application_drafts WHERE opportunity_id = ? ORDER BY generated_at DESC LIMIT 5
    `).bind(id).all();
  } catch (e) { /* drafts optional */ }

  let brief = null;
  try {
    brief = await env.LEADS_DB.prepare(`
      SELECT id, opportunity_id, executive_summary, why_we_fit, why_we_dont_fit,
             capability_match_json, bid_decision, estimated_effort_hours,
             estimated_value_usd, missing_artifacts_json, risk_flags_json, next_step,
             sources_cited_json, generated_by, generated_at, updated_at
      FROM gov_opportunity_briefs WHERE opportunity_id = ? LIMIT 1
    `).bind(id).first();
    if (brief) {
      brief = {
        ...brief,
        capability_match_json: safeJson(brief.capability_match_json, []),
        missing_artifacts_json: safeJson(brief.missing_artifacts_json, []),
        risk_flags_json: safeJson(brief.risk_flags_json, []),
        sources_cited_json: safeJson(brief.sources_cited_json, []),
      };
    }
  } catch (e) { /* brief optional */ }

  return {
    ...row,
    naics_codes_json: safeJson(row.naics_codes_json, []),
    raw_json: raw,
    attachments,
    poc,
    drafts: drafts.results || [],
    brief,
    requirements: deriveRequirements(row, raw),
    how_to_apply: deriveHowToApply(row, raw),
  };
}

function extractAttachments(raw) {
  const pool = []
    .concat(Array.isArray(raw.attachments) ? raw.attachments : [])
    .concat(Array.isArray(raw.resourceLinks) ? raw.resourceLinks : [])
    .concat(Array.isArray(raw.links) ? raw.links : []);
  return pool.map((a) => ({
    name: a?.name || a?.title || a?.description || "Attachment",
    url: a?.url || a?.href || a?.link || a?.uri || null,
    type: a?.type || a?.contentType || a?.fileType || null,
  })).filter((x) => x.url);
}

function extractPoc(raw) {
  const lists = []
    .concat(Array.isArray(raw.pointOfContact) ? raw.pointOfContact : [])
    .concat(Array.isArray(raw.contacts) ? raw.contacts : [])
    .concat(Array.isArray(raw.poc) ? raw.poc : []);
  const flat = [];
  for (const c of lists) {
    if (!c) continue;
    if (Array.isArray(c)) flat.push(...c);
    else flat.push(c);
  }
  return flat.map((c) => ({
    name: c?.name || c?.fullName || c?.contactName || c?.title || null,
    email: c?.email || c?.contactEmail || null,
    phone: c?.phone || c?.contactPhone || null,
    role: c?.type || c?.role || c?.category || null,
  })).filter((c) => c.name || c.email || c.phone);
}

function deriveRequirements(row, raw) {
  const out = [];
  if (row.set_aside && row.set_aside !== "") out.push({ key: "set_aside", label: "Set-Aside", value: row.set_aside });
  if (Array.isArray(row.naics_codes_json) && row.naics_codes_json.length) {
    out.push({ key: "naics", label: "NAICS", value: row.naics_codes_json.join(", ") });
  }
  const place = raw.placeOfPerformance?.city?.name
    || raw.placeOfPerformance?.state?.name
    || raw.placeOfPerformance?.country?.name
    || (typeof raw.placeOfPerformance === "string" ? raw.placeOfPerformance : null);
  if (place) out.push({ key: "place", label: "Place of Performance", value: place });
  if (row.response_deadline) out.push({ key: "deadline", label: "Response Deadline", value: String(row.response_deadline) });
  if (raw.typeOfContract) out.push({ key: "contract_type", label: "Contract Type", value: String(raw.typeOfContract) });
  if (raw.typeOfSetAsideDescription) out.push({ key: "type_of_set_aside_desc", label: "Set-Aside Detail", value: String(raw.typeOfSetAsideDescription) });
  // Heuristic: parse description for "must" / "shall" / "require" sentences
  const requires = (raw.description || "")
    .replace(/\r/g, " ")
    .split(/[.\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 6 && s.length < 280 && /\b(must|shall|require[sd]?|qualif(?:y|ication|ied))\b/i.test(s));
  for (const r of requires.slice(0, 8)) out.push({ key: "require_text", label: "Requirement", value: r });
  return out;
}

function deriveHowToApply(row, raw) {
  const steps = [];
  if (row.source_url) steps.push({ step: 1, label: "Open listing", url: row.source_url });
  const soliciting = raw.officeAddress
    || raw.organizationName
    || raw.department
    || row.agency;
  if (soliciting) steps.push({ step: 2, label: "Identify the contracting office", value: typeof soliciting === "string" ? soliciting : JSON.stringify(soliciting) });
  if (row.response_deadline) steps.push({ step: 3, label: "Response deadline", value: row.response_deadline });
  steps.push({ step: 4, label: "Register or sign in to SAM.gov", value: "A SAM.gov account is required to view attachments and submit a response. SAM.gov will prompt for sign-in if you don't have a session." });
  steps.push({ step: 5, label: "Review attachment package", value: "Download all PDFs and any Q&A from the Attachments list. Typical: Solicitation, SOW/SOO, Past Performance template, Section K/L clauses, pricing schedule." });
  if (row.set_aside && row.set_aside !== "") steps.push({ step: 6, label: "Confirm set-aside eligibility", value: row.set_aside });
  if (row.estimated_value) steps.push({ step: 7, label: "Confirm estimated value fits your capacity", value: String(row.estimated_value) });
  return steps;
}

// ── opportunity_events ───────────────────────────────────────────────────────
async function eventsFor(env, kind, id) {
  const col = kind === "prospect" ? "prospect_id" : "sam_id";
  let rows;
  try {
    rows = await env.LEADS_DB.prepare(`
      SELECT id, kind, event_type, from_stage, to_stage, actor, payload_json, created_at
      FROM opportunity_events WHERE ${col} = ? ORDER BY created_at DESC LIMIT 50
    `).bind(id).all();
  } catch (e) {
    return [];
  }
  return (rows.results || []).map((r) => ({ ...r, payload_json: safeJson(r.payload_json, {}) }));
}

function safeJson(s, fallback = null) {
  if (s == null || s === "") return fallback;
  try { return JSON.parse(s); } catch { return fallback ?? { _raw: String(s).slice(0, 200) }; }
}
