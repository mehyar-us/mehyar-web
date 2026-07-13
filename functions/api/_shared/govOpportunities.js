import { generateGovOpportunityDraft, validateGovDraftForOwnerReview } from "./govDraftingAssist.js";

const SAFE_ADMIN_FAILURE = "Government opportunity admin unavailable.";
const DEFAULT_KEYWORDS = [
  "software development",
  "web application development",
  "website modernization",
  "workflow automation",
  "CRM implementation",
  "data dashboard",
  "business intelligence",
  "cloud migration",
  "API integration",
  "process automation",
  "case management system",
  "help desk modernization",
];
const POSITIVE_TERMS = [
  "software", "web application", "website", "modernization", "workflow", "automation", "crm", "customer relationship", "dashboard", "business intelligence", "reporting", "cloud", "api", "integration", "records management", "intake", "case management", "email", "help desk", "data", "small business", "rfi", "sources sought", "simplified acquisition", "micro-purchase"
];
const NEGATIVE_TERMS = ["construction", "facility", "facilities", "hardware", "equipment", "medical", "clinical", "janitorial", "vehicle", "uniform", "weapon", "ammunition", "food service", "landscaping"];
const ACTIVE_STATUSES = new Set(["new", "reviewing", "draft_needed", "submitted", "follow_up", "not_fit", "archived"]);

export async function runGovOpportunityIngest({ env, now = new Date(), fetchImpl = fetch } = {}) {
  if (!env?.LEADS_DB) throw new Error("LEADS_DB binding missing");
  const runId = crypto.randomUUID();
  const startedAt = now.toISOString();
  const limit = clampNumber(env?.GOV_INGEST_LIMIT, 5, 100, 40);
  const keywords = parseKeywords(env?.GOV_OPPORTUNITY_KEYWORDS);
  const samApiKey = resolveSamApiKey(env);
  const summary = {
    run_id: runId,
    started_at: startedAt,
    finished_at: null,
    usaspending: { fetched: 0, ok: false },
    sam: { fetched: 0, skipped: !samApiKey, ok: false },
    inserted: 0,
    updated: 0,
    failed: 0,
    errors: [],
  };

  let normalized = [];
  try {
    const awards = await fetchUsaspendingAwards({ fetchImpl, keywords, limit });
    summary.usaspending = { fetched: awards.length, ok: true };
    normalized = normalized.concat(awards);
  } catch (error) {
    summary.errors.push({ source: "usaspending", error: safeErrorName(error) });
  }

  if (samApiKey) {
    try {
      const sam = await fetchSamOpportunities({ fetchImpl, apiKey: samApiKey, keywords, limit });
      summary.sam = { fetched: sam.length, skipped: false, ok: true };
      normalized = normalized.concat(sam);
    } catch (error) {
      summary.sam = { fetched: 0, skipped: false, ok: false };
      summary.errors.push({ source: "sam.gov", error: safeErrorName(error) });
    }
  }

  for (const item of normalized.slice(0, limit * 2)) {
    try {
      const result = await upsertGovOpportunity(env.LEADS_DB, item, runId, now);
      if (result.action === "inserted") summary.inserted += 1;
      if (result.action === "updated") summary.updated += 1;
    } catch (error) {
      summary.failed += 1;
      summary.errors.push({ source: item.source || "unknown", error: safeErrorName(error) });
    }
  }

  summary.finished_at = new Date().toISOString();
  await env.LEADS_DB.prepare(`INSERT INTO gov_opportunity_ingest_runs (
    id, started_at, finished_at, sources_json, fetched_count, inserted_count, updated_count, failed_count, status, error_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    runId,
    startedAt,
    summary.finished_at,
    JSON.stringify({ usaspending: summary.usaspending, sam: summary.sam }),
    summary.usaspending.fetched + summary.sam.fetched,
    summary.inserted,
    summary.updated,
    summary.failed,
    summary.errors.length ? "partial" : "success",
    JSON.stringify(summary.errors),
  ).run();

  return summary;
}

export async function fetchUsaspendingAwards({ fetchImpl = fetch, keywords = DEFAULT_KEYWORDS, limit = 40 } = {}) {
  const response = await fetchImpl("https://api.usaspending.gov/api/v2/search/spending_by_award/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      filters: {
        time_period: [{ start_date: dateDaysAgo(365), end_date: dateDaysAgo(0) }],
        award_type_codes: ["A", "B", "C", "D"],
        keywords: keywords.slice(0, 10),
      },
      fields: ["Award ID", "Recipient Name", "Awarding Agency", "Awarding Sub Agency", "Award Description", "Start Date", "End Date", "Award Amount", "NAICS Code"],
      page: 1,
      limit,
      sort: "Award Amount",
      order: "desc",
    }),
  });
  if (!response.ok) throw new Error(`usaspending_${response.status}`);
  return normalizeUsaspendingAwards(await response.json());
}

export async function fetchSamOpportunities({ fetchImpl = fetch, apiKey, keywords = DEFAULT_KEYWORDS, limit = 40 } = {}) {
  if (!apiKey) return [];
  const endDate = new Date(Date.now() - 0 * 86400000);
  const startDate = new Date(Date.now() - 30 * 86400000);
  const postedTo = formatSamDate(endDate);
  const postedFrom = formatSamDate(startDate);
  const seen = new Set();
  const merged = [];
  const headers = {
    "X-Api-Key": apiKey,           // SAM.gov v2 recommended (verified 2026-07-13)
    "Accept": "application/json",
  };
  // SAM.gov v2's title= param doesn't accept OR chains or spaces — each call
  // must be a single phrase. Loop one keyword at a time, dedupe by noticeId.
  for (const kw of keywords.slice(0, 12)) {
    if (merged.length >= limit * 2) break;
    const params = new URLSearchParams({
      postedFrom,
      postedTo,
      limit: String(Math.min(limit, 100)),
      offset: "0",
      ptype: "o,k,r,s",
      title: kw,
    });
    const response = await fetchImpl(`https://api.sam.gov/opportunities/v2/search?${params.toString()}`, { headers });
    if (!response.ok) {
      // non-fatal: skip this keyword, continue with the next
      console.warn(`sam.gov fetch failed for keyword ${kw}: ${response.status}`);
      continue;
    }
    let json;
    try { json = await response.json(); } catch { continue; }
    const items = normalizeSamOpportunities(json);
    for (const it of items) {
      const key = `${it.source || "sam.gov"}::${it.source_id || it.noticeId || it.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(it);
      if (merged.length >= limit) break;
    }
  }
  return merged.slice(0, limit);
}

export function normalizeUsaspendingAwards(payload = {}) {
  const rows = Array.isArray(payload.results) ? payload.results : [];
  return rows.map((row) => {
    const award = row.Award || row.award || {};
    const agency = row.AwardingAgency || row.awarding_agency || {};
    const recipient = row.Recipient || row.recipient || {};
    const description = clean(row["Award Description"] || row.AwardDescription || row.award_description || row.description || "");
    const awardId = clean(row["Award ID"] || award.generated_unique_award_id || award.award_id || row.generated_unique_award_id || description.slice(0, 80));
    const amount = Number(row["Award Amount"] || row.AwardAmount || row.award_amount || row.generated_pragmatic_obligation || 0) || null;
    return {
      source: "usaspending",
      source_id: awardId,
      source_url: awardId ? `https://www.usaspending.gov/award/${encodeURIComponent(awardId)}` : "https://www.usaspending.gov/search/",
      title: cap(description || `Award signal: ${clean(row["Recipient Name"] || recipient.recipient_name || "unknown recipient")}`, 260),
      agency: clean(row["Awarding Agency"] || agency.awarding_agency_name || agency.name || "Unknown agency"),
      office: clean(row["Awarding Sub Agency"] || agency.awarding_sub_agency_name || ""),
      opportunity_type: "award_history_signal",
      status: "new",
      posted_date: normalizeDate(row["Start Date"] || row.ActionDate || row.action_date || row.start_date),
      response_deadline: normalizeDate(row["End Date"] || row.end_date),
      estimated_value: amount,
      set_aside: "",
      naics_codes: [clean(row["NAICS Code"] || row.naics_code || "")].filter(Boolean),
      summary: description,
      raw: row,
    };
  }).filter((item) => item.source_id && item.title);
}

export function normalizeSamOpportunities(payload = {}) {
  const rows = Array.isArray(payload.opportunitiesData) ? payload.opportunitiesData : Array.isArray(payload.results) ? payload.results : [];
  return rows.map((row) => ({
    source: "sam.gov",
    source_id: clean(row.noticeId || row.notice_id || row.solicitationNumber || row.solicitation_number || row.title),
    source_url: clean(row.uiLink || row.link || row.url || (row.noticeId ? `https://sam.gov/opp/${encodeURIComponent(row.noticeId)}/view` : "https://sam.gov/")),
    title: cap(clean(row.title || row.noticeTitle || "Untitled SAM opportunity"), 260),
    agency: clean(row.fullParentPathName || row.department || row.agency || row.organizationName || "Unknown agency"),
    office: clean(row.officeAddress?.city || row.subTier || row.office || ""),
    opportunity_type: clean(row.type || row.noticeType || "active_solicitation").toLowerCase().includes("source") ? "sources_sought" : "active_solicitation",
    status: "new",
    posted_date: normalizeDate(row.postedDate || row.posted_date),
    response_deadline: normalizeDate(row.responseDeadLine || row.responseDeadline || row.archiveDate || row.deadline),
    estimated_value: Number(row.award?.amount || row.estimatedValue || 0) || null,
    set_aside: clean(row.setAside || row.typeOfSetAside || row.setAsideDescription || ""),
    naics_codes: [clean(row.naicsCode || row.naics || "")].filter(Boolean),
    summary: cap(clean(row.description || row.synopsis || row.descriptionText || row.title || ""), 4000),
    raw: row,
  })).filter((item) => item.source_id && item.title);
}

export function scoreGovOpportunity(item, now = new Date()) {
  const text = `${item.title || ""} ${item.summary || ""} ${item.agency || ""} ${item.set_aside || ""} ${(item.naics_codes || []).join(" ")}`.toLowerCase();
  let score = 20;
  const whyFit = [];
  const whyNotFit = [];

  const positives = POSITIVE_TERMS.filter((term) => text.includes(term));
  score += Math.min(40, positives.length * 7);
  if (positives.length) whyFit.push(`Matches ${positives.slice(0, 5).join(", ")}.`);

  if (/5415|5182|519|5416/.test(text)) {
    score += 12;
    whyFit.push("NAICS appears aligned with software/data/professional services.");
  }
  if (/small business|8\(a\)|sdvosb|wosb|hubzone|set-aside|sources sought|rfi/.test(text)) {
    score += 14;
    whyFit.push("Small-business, RFI, or sources-sought signal improves pursuit suitability.");
  }
  if ((item.estimated_value || 0) > 0 && item.estimated_value <= 250000) {
    score += 8;
    whyFit.push("Value band is plausible for a lean services pursuit.");
  } else if ((item.estimated_value || 0) > 5000000) {
    score -= 12;
    whyNotFit.push("Large value may imply prime/vendor complexity.");
  }

  const negatives = NEGATIVE_TERMS.filter((term) => text.includes(term));
  score -= Math.min(45, negatives.length * 12);
  if (negatives.length) whyNotFit.push(`Contains lower-fit terms: ${negatives.slice(0, 5).join(", ")}.`);

  const days = daysUntil(item.response_deadline, now);
  if (days !== null) {
    if (days < 2) {
      score -= 18;
      whyNotFit.push("Deadline is too close for a controlled response.");
    } else if (days <= 14) {
      score += 6;
      whyFit.push("Deadline is active and near-term.");
    } else if (days <= 45) {
      score += 10;
      whyFit.push("Deadline leaves room for owner review and draft preparation.");
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const confidence = score >= 75 ? "high" : score >= 50 ? "medium" : "low";
  if (!whyFit.length) whyFit.push("Limited explicit service-match evidence; review source before pursuing.");
  if (!whyNotFit.length) whyNotFit.push("No major mismatch detected from available source metadata.");
  const nextAction = item.source === "sam.gov"
    ? (score >= 70 ? "Owner review: open source link, confirm eligibility, and draft a response outline/checklist." : "Triage SAM notice; archive if scope or certifications do not fit.")
    : (score >= 65 ? "Watch agency/spend pattern and search SAM for active related solicitations." : "Keep as low-priority market signal unless repeated agency pattern appears.");
  return { fit_score: score, confidence, why_fit: whyFit.join(" "), why_not_fit: whyNotFit.join(" "), next_action: nextAction };
}

export async function upsertGovOpportunity(db, item, runId, now = new Date()) {
  const scored = scoreGovOpportunity(item, now);
  const dedupeKey = await sha256Hex([item.source, item.source_id || "", item.title || "", item.agency || ""].join("|"));
  const existing = await db.prepare("SELECT id FROM gov_opportunities WHERE dedupe_key = ? LIMIT 1").bind(dedupeKey).first();
  const id = existing?.id || crypto.randomUUID();
  const args = [
    item.source_url || "", item.title || "", item.agency || "", item.office || "", item.opportunity_type || "unknown", normalizeStatus(item.status), item.posted_date || null, item.response_deadline || null,
    item.estimated_value || null, item.set_aside || "", JSON.stringify(item.naics_codes || []), item.summary || "", scored.fit_score, scored.confidence, scored.why_fit, scored.why_not_fit, scored.next_action, JSON.stringify(item.raw || item),
  ];
  if (existing?.id) {
    await db.prepare(`UPDATE gov_opportunities SET source_url = ?, title = ?, agency = ?, office = ?, opportunity_type = ?, status = ?, posted_date = ?, response_deadline = ?, estimated_value = ?, set_aside = ?, naics_codes_json = ?, summary = ?, fit_score = ?, confidence = ?, why_fit = ?, why_not_fit = ?, next_action = ?, raw_json = ?, updated_at = datetime('now') WHERE id = ?`).bind(...args, id).run();
    await writeGovEvent(db, id, "upsert_updated", "system", { run_id: runId, source: item.source });
    return { id, action: "updated", fit_score: scored.fit_score };
  }
  await db.prepare(`INSERT INTO gov_opportunities (
    id, dedupe_key, source, source_id, source_url, title, agency, office, opportunity_type, status, posted_date, response_deadline, estimated_value, set_aside, naics_codes_json, summary, fit_score, confidence, why_fit, why_not_fit, next_action, raw_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, dedupeKey, item.source || "unknown", item.source_id || "", ...args).run();
  await writeGovEvent(db, id, "upsert_inserted", "system", { run_id: runId, source: item.source });
  return { id, action: "inserted", fit_score: scored.fit_score };
}

export async function listGovOpportunities(env, url) {
  if (!env?.LEADS_DB) throw new Error("LEADS_DB binding missing");
  const limit = clampNumber(url.searchParams.get("limit"), 1, 100, 25);
  const status = normalizeStatus(url.searchParams.get("status") || "");
  const source = clean(url.searchParams.get("source") || "");
  const minScore = clampNumber(url.searchParams.get("min_score"), 0, 100, 0);
  const filters = ["fit_score >= ?"];
  const args = [minScore];
  if (status) { filters.push("status = ?"); args.push(status); }
  if (source) { filters.push("source = ?"); args.push(source); }
  const sql = `SELECT id, source, source_id, source_url, title, agency, office, opportunity_type, status, posted_date, response_deadline, estimated_value, set_aside, naics_codes_json, summary, fit_score, confidence, why_fit, why_not_fit, next_action, owner_notes, created_at, updated_at FROM gov_opportunities WHERE ${filters.join(" AND ")} ORDER BY fit_score DESC, COALESCE(response_deadline, posted_date, created_at) DESC LIMIT ?`;
  const rows = await env.LEADS_DB.prepare(sql).bind(...args, limit).all();
  return (rows.results || []).map(formatOpportunityRow);
}

export async function updateGovOpportunityStatus(env, id, payload = {}, actor = "owner") {
  const status = normalizeStatus(payload.status);
  if (!status) throw new Error("invalid_status");
  const notes = cap(clean(payload.owner_notes || ""), 5000);
  await env.LEADS_DB.prepare("UPDATE gov_opportunities SET status = ?, owner_notes = ?, updated_at = datetime('now') WHERE id = ?").bind(status, notes, id).run();
  await writeGovEvent(env.LEADS_DB, id, "status_updated", actor, { status, notes_present: Boolean(notes) });
  return { id, status, owner_notes: notes };
}

export async function getGovOpportunityWorkspace(env, id) {
  if (!env?.LEADS_DB) throw new Error("LEADS_DB binding missing");
  const opportunity = await env.LEADS_DB.prepare("SELECT id, source, source_id, source_url, title, agency, office, opportunity_type, status, posted_date, response_deadline, estimated_value, set_aside, naics_codes_json, summary, fit_score, confidence, why_fit, why_not_fit, next_action, owner_notes, created_at, updated_at FROM gov_opportunities WHERE id = ? LIMIT 1").bind(id).first();
  if (!opportunity?.id) return null;
  const draftRows = await env.LEADS_DB.prepare("SELECT * FROM gov_application_drafts WHERE opportunity_id = ? ORDER BY created_at DESC LIMIT 5").bind(id).all();
  const blocks = await listCapabilityBlocks(env);
  const drafts = (draftRows.results || []).map(formatDraftRow);
  const latestDraft = drafts[0] || null;
  return {
    opportunity_id: id,
    opportunity: formatOpportunityRow(opportunity),
    drafts,
    latest_draft: latestDraft,
    checklist: latestDraft?.requirements_checklist || [],
    outline: latestDraft?.response_outline || [],
    questions: latestDraft?.contracting_officer_questions || [],
    capability_blocks: latestDraft?.capability_blocks?.length ? latestDraft.capability_blocks : blocks,
  };
}

export async function createGovOpportunityDraft(env, id, payload = {}, actor = "owner") {
  if (!env?.LEADS_DB) throw new Error("LEADS_DB binding missing");
  if (payload.owner_review_only === false || payload.auto_submit_allowed === true) throw new Error("owner_review_only_required");
  const opportunity = await env.LEADS_DB.prepare("SELECT * FROM gov_opportunities WHERE id = ? LIMIT 1").bind(id).first();
  if (!opportunity?.id) throw new Error("not_found");
  const documents = await env.LEADS_DB.prepare("SELECT * FROM gov_opportunity_documents WHERE opportunity_id = ? ORDER BY captured_at DESC, title ASC LIMIT 20").bind(id).all().catch(() => ({ results: [] }));
  const capabilityLibrary = await listCapabilityBlocks(env);
  const sourceRetrievedAt = opportunity.updated_at || opportunity.created_at || new Date().toISOString();
  const requirements = deriveRequirementsFromOpportunity(opportunity, documents.results || [], sourceRetrievedAt);
  const draft = generateGovOpportunityDraft({
    actor,
    opportunity: {
      id: opportunity.id,
      title: opportunity.title,
      agency: opportunity.agency,
      source: opportunity.source,
      sourceUrl: opportunity.source_url || "",
      sourceRetrievedAt,
      closeDate: opportunity.response_deadline,
      summary: opportunity.summary,
      requirements,
      evaluationFactors: deriveEvaluationFactors(opportunity, sourceRetrievedAt),
      attachments: (documents.results || []).map((document) => ({ sourceUrl: document.source_url, sourceRetrievedAt: document.captured_at || sourceRetrievedAt, label: document.title || document.document_type || "source document" })),
    },
    capabilityLibrary: capabilityLibrary.map((block) => ({ key: block.key, label: block.label, text: block.text, approved: Boolean(block.approved), updatedAt: block.updated_at || sourceRetrievedAt, sourceUrl: block.source_url })),
    ownerFacts: {
      certifications: [],
      naicsCodes: parseJsonArray(opportunity.naics_codes_json),
      pastPerformance: [],
      pricingGuidance: null,
      eligibilityNotes: [opportunity.set_aside, opportunity.owner_notes].filter(Boolean),
    },
  });
  const validation = validateGovDraftForOwnerReview(draft);
  if (!validation.ok) throw new Error(`draft_validation_failed:${validation.errors.join(",")}`);
  await env.LEADS_DB.prepare(`INSERT INTO gov_application_drafts (
    id, opportunity_id, status, owner_review_only, auto_submit_allowed, generated_by,
    requirements_checklist_json, compliance_matrix_json, contracting_officer_questions_json,
    response_outline_json, capability_blocks_json, owner_confirmation_items_json, risk_flags_json,
    source_citations_json, audit_metadata_json, owner_notes
  ) VALUES (?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    draft.draftId,
    id,
    draft.status,
    actor,
    JSON.stringify(draft.requirementsChecklist),
    JSON.stringify(draft.complianceMatrix),
    JSON.stringify(draft.contractingOfficerQuestions),
    JSON.stringify(draft.responseOutline),
    JSON.stringify(draft.capabilityStatementBlocks),
    JSON.stringify(draft.ownerConfirmationItems),
    JSON.stringify(draft.riskFlags),
    JSON.stringify(draft.audit.sourceCitations),
    JSON.stringify({ ...draft.audit, guardrails: draft.guardrails, validation }),
    cap(clean(payload.owner_notes || ""), 5000),
  ).run();
  await writeGovEvent(env.LEADS_DB, id, "draft_generated", actor, { draft_id: draft.draftId, owner_review_only: true, auto_submit_allowed: false, citations: draft.audit.sourceCitations.length, risk_flags: draft.riskFlags });
  return formatDraftRow({
    id: draft.draftId,
    opportunity_id: id,
    status: draft.status,
    owner_review_only: 1,
    auto_submit_allowed: 0,
    generated_by: actor,
    requirements_checklist_json: JSON.stringify(draft.requirementsChecklist),
    compliance_matrix_json: JSON.stringify(draft.complianceMatrix),
    contracting_officer_questions_json: JSON.stringify(draft.contractingOfficerQuestions),
    response_outline_json: JSON.stringify(draft.responseOutline),
    capability_blocks_json: JSON.stringify(draft.capabilityStatementBlocks),
    owner_confirmation_items_json: JSON.stringify(draft.ownerConfirmationItems),
    risk_flags_json: JSON.stringify(draft.riskFlags),
    source_citations_json: JSON.stringify(draft.audit.sourceCitations),
    audit_metadata_json: JSON.stringify({ ...draft.audit, guardrails: draft.guardrails, validation }),
    owner_notes: cap(clean(payload.owner_notes || ""), 5000),
    created_at: draft.generatedAt,
    updated_at: draft.generatedAt,
  });
}

export async function updateGovDraft(env, draftId, payload = {}, actor = "owner") {
  if (payload.owner_review_only === false || payload.auto_submit_allowed === true) throw new Error("owner_review_only_required");
  const status = clean(payload.status || "owner_review_required") || "owner_review_required";
  if (!["owner_review_required", "owner_approved", "revision_needed", "archived"].includes(status)) throw new Error("invalid_status");
  const notes = cap(clean(payload.owner_notes || ""), 5000);
  const existing = await env.LEADS_DB.prepare("SELECT opportunity_id FROM gov_application_drafts WHERE id = ? LIMIT 1").bind(draftId).first();
  if (!existing?.opportunity_id) throw new Error("not_found");
  await env.LEADS_DB.prepare("UPDATE gov_application_drafts SET status = ?, owner_notes = ?, reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").bind(status, notes, actor, draftId).run();
  await writeGovEvent(env.LEADS_DB, existing.opportunity_id, "draft_updated", actor, { draft_id: draftId, status, notes_present: Boolean(notes) });
  const row = await env.LEADS_DB.prepare("SELECT * FROM gov_application_drafts WHERE id = ? LIMIT 1").bind(draftId).first();
  return formatDraftRow(row);
}

export async function getGovDigest(env) {
  const rows = await env.LEADS_DB.prepare("SELECT id, source, source_url, title, agency, opportunity_type, status, response_deadline, fit_score, confidence, why_fit, next_action, updated_at FROM gov_opportunities WHERE status != 'archived' ORDER BY fit_score DESC, COALESCE(response_deadline, updated_at) DESC LIMIT 10").all();
  const latestRun = await env.LEADS_DB.prepare("SELECT id, started_at, finished_at, fetched_count, inserted_count, updated_count, failed_count, status FROM gov_opportunity_ingest_runs ORDER BY started_at DESC LIMIT 1").first();
  return { latestRun: latestRun || null, top: (rows.results || []).map(formatOpportunityRow) };
}

export async function writeGovEvent(db, opportunityId, eventType, actor, metadata) {
  const draftId = metadata?.draft_id || null;
  await db.prepare("INSERT INTO gov_opportunity_events (id, opportunity_id, draft_id, event_type, actor, metadata_json) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), opportunityId, draftId, eventType, actor || "system", JSON.stringify(metadata || {}))
    .run();
}

export async function verifyAdminRequest(request, env) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const secret = env?.ADMIN_SESSION_SECRET || env?.HMAC_SECRET || "";
  if (!secret || !token) return false;
  const payload = await verifyToken(token, secret);
  return Boolean(payload?.sub);
}

export function responseHeaders(request, env, methods = "GET, POST, OPTIONS") {
  const origin = request?.headers?.get("origin");
  const allowedOrigin = origin && isAllowedOrigin(request, env) ? origin : "https://mehyar.us";
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": allowedOrigin,
    "vary": "Origin",
    "access-control-allow-methods": methods,
    "access-control-allow-headers": "content-type, authorization",
  };
}

export function jsonResponse(body, status, request, env) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(request, env) });
}

export function forbidden(request, env, status = 401) {
  return jsonResponse({ ok: false, message: SAFE_ADMIN_FAILURE }, status, request, env);
}

function formatOpportunityRow(row) {
  return { ...row, naics_codes: parseJsonArray(row.naics_codes_json), estimated_value: row.estimated_value == null ? null : Number(row.estimated_value), fit_score: Number(row.fit_score || 0) };
}

function formatDraftRow(row = {}) {
  return {
    id: row.id,
    opportunity_id: row.opportunity_id,
    status: row.status,
    owner_review_only: row.owner_review_only === 1 || row.owner_review_only === true,
    auto_submit_allowed: row.auto_submit_allowed === 1 || row.auto_submit_allowed === true,
    generated_by: row.generated_by,
    requirements_checklist: parseJsonArray(row.requirements_checklist_json),
    compliance_matrix: parseJsonArray(row.compliance_matrix_json),
    contracting_officer_questions: parseJsonArray(row.contracting_officer_questions_json),
    response_outline: parseJsonArray(row.response_outline_json),
    capability_blocks: parseJsonArray(row.capability_blocks_json),
    owner_confirmation_items: parseJsonArray(row.owner_confirmation_items_json),
    risk_flags: parseJsonArray(row.risk_flags_json),
    source_citations: parseJsonArray(row.source_citations_json),
    audit: parseJsonObject(row.audit_metadata_json),
    owner_notes: row.owner_notes || "",
    reviewed_by: row.reviewed_by || null,
    reviewed_at: row.reviewed_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function listCapabilityBlocks(env) {
  const rows = await env.LEADS_DB.prepare("SELECT id, block_key, label, text, approved, source_url, updated_at FROM gov_capability_blocks ORDER BY approved DESC, label ASC LIMIT 20").all().catch(async () => {
    const fallback = await env.LEADS_DB.prepare("SELECT id, label, block_type, content_markdown, owner_only, updated_at FROM gov_capability_blocks ORDER BY label ASC LIMIT 20").all().catch(() => ({ results: [] }));
    return { results: (fallback.results || []).map((row) => ({ id: row.id, block_key: row.block_type || row.id, label: row.label, text: row.content_markdown, approved: row.owner_only === 1 ? 1 : 0, source_url: "owner-approved-capability-library", updated_at: row.updated_at })) };
  });
  return (rows.results || []).map((row) => ({ id: row.id, key: row.block_key || row.id, label: row.label, text: row.text || "", approved: row.approved === 1 || row.approved === true, source_url: row.source_url || "owner-approved-capability-library", updated_at: row.updated_at }));
}

function deriveRequirementsFromOpportunity(opportunity, documents, sourceRetrievedAt) {
  const baseCitation = { sourceUrl: opportunity.source_url || "", sourceRetrievedAt };
  const requirements = [];
  if (opportunity.summary) requirements.push({ text: cap(opportunity.summary, 900), ...baseCitation, label: "Opportunity summary" });
  if (opportunity.next_action) requirements.push({ text: opportunity.next_action, ...baseCitation, label: "Recommended next action" });
  if (opportunity.set_aside) requirements.push({ text: `Verify set-aside/eligibility before response: ${opportunity.set_aside}`, ...baseCitation, label: "Eligibility signal" });
  for (const document of documents.slice(0, 6)) {
    const text = cap(document.extracted_text || document.title || document.document_type || "Source document review required", 900);
    requirements.push({ text, sourceUrl: document.source_url || opportunity.source_url || "", sourceRetrievedAt: document.captured_at || sourceRetrievedAt, label: document.title || document.document_type || "Source document" });
  }
  if (!requirements.length) requirements.push({ text: `Review live source for ${opportunity.title}; metadata alone is insufficient for submission.`, ...baseCitation, label: "Source review" });
  return requirements;
}

function deriveEvaluationFactors(opportunity, sourceRetrievedAt) {
  const citation = { sourceUrl: opportunity.source_url || "", sourceRetrievedAt, label: "Opportunity fit signals" };
  return [
    { text: `Fit rationale: ${opportunity.why_fit || "Owner must review source fit."}`, ...citation },
    { text: `Risk/not-fit rationale: ${opportunity.why_not_fit || "No not-fit rationale captured yet."}`, ...citation },
  ];
}

function resolveSamApiKey(env = {}) {
  return env.MEHYARSOFT_SAM_API_KEY || env.SAM_API_KEY || env.SAM_GOV_API_KEY || "";
}

function parseKeywords(value) {
  const custom = clean(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
  return custom.length ? custom.slice(0, 20) : DEFAULT_KEYWORDS;
}
function parseJsonArray(value) { try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function parseJsonObject(value) { try { const parsed = JSON.parse(value || "{}"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } }
function normalizeStatus(value) { const status = clean(value || "").toLowerCase(); return ACTIVE_STATUSES.has(status) ? status : ""; }
function clampNumber(value, min, max, fallback) { const number = Number(value); return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback; }
function clean(value) { return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : ""; }
function cap(value, max) { return clean(value).length > max ? clean(value).slice(0, max) : clean(value); }
function safeErrorName(error) { return String(error?.message || error?.name || "unknown").replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]").slice(0, 120); }
function dateDaysAgo(days) { const date = new Date(Date.now() - days * 86400000); return date.toISOString().slice(0, 10); }
function formatSamDate(value) { const date = new Date(value); return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}/${date.getFullYear()}`; }
function normalizeDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const mmddyyyy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mmddyyyy) return `${mmddyyyy[3]}-${mmddyyyy[1].padStart(2, "0")}-${mmddyyyy[2].padStart(2, "0")}`;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}
function daysUntil(value, now) { if (!value) return null; const date = new Date(`${value}T00:00:00Z`); if (Number.isNaN(date.getTime())) return null; return Math.ceil((date.getTime() - now.getTime()) / 86400000); }
async function sha256Hex(value) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
async function verifyToken(token, secret) {
  try {
    const [encodedPayload, signature] = token.split(".");
    if (!encodedPayload || !signature) return null;
    const expected = await hmacSha256(secret, encodedPayload);
    if (!timingSafeEqual(signature, expected)) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload)));
    if (!payload?.sub || !payload?.exp || Number(payload.exp) < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}
async function hmacSha256(secret, value) { const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)); return base64UrlEncodeBytes(new Uint8Array(signature)); }
function base64UrlEncodeBytes(bytes) { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function base64UrlDecode(value) { const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4); const binary = atob(padded); return Uint8Array.from(binary, (char) => char.charCodeAt(0)); }
function timingSafeEqual(a, b) { if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }
function isAllowedOrigin(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const allowed = (env?.ALLOWED_ORIGINS || "https://mehyar.us,https://www.mehyar.us,http://localhost:5173,http://127.0.0.1:5173").split(",").map((entry) => entry.trim()).filter(Boolean);
  if (allowed.includes(origin)) return true;
  try { const host = new URL(origin).hostname; return host.endsWith(".pages.dev") && env?.ENVIRONMENT !== "production"; } catch { return false; }
}
