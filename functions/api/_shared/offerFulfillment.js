const OFFER_CATALOG = [
  {
    offer_id: "crm-follow-up-sprint",
    title: "CRM Follow-Up Sprint",
    fit_keywords: ["crm", "follow-up", "follow up", "zoho", "lead", "booking", "missed call", "calls", "email workflow", "automation"],
    service_fit_floor: 80,
    summary: "Owner-reviewed setup sprint for intake, CRM handoff, follow-up drafting, and audit-visible status.",
    next_step: "Review the draft, confirm scope, then send a one-to-one reply with a $330 deposit path.",
  },
  {
    offer_id: "lead-leak-audit",
    title: "Local Business Lead Leak Audit",
    fit_keywords: ["audit", "website", "intake", "conversion", "leak", "missed", "form", "phone"],
    service_fit_floor: 60,
    summary: "Practical audit of where leads are leaking across website, calls, booking, and follow-up.",
    next_step: "Review the audit-fit draft and invite the owner to book the first diagnostic call.",
  },
  {
    offer_id: "website-booking-cleanup",
    title: "Website + Booking Cleanup",
    fit_keywords: ["website", "landing", "booking", "cta", "copy", "page", "form"],
    service_fit_floor: 45,
    summary: "Cleanup sprint for public offer clarity, booking path, and contact conversion basics.",
    next_step: "Review the cleanup-fit draft and ask for website/admin access only after owner approval.",
  },
];

const HIGH_INTENT_TERMS = ["this month", "today", "urgent", "asap", "soon", "need", "missing", "missed", "broken", "help", "quote", "budget", "$", "paid", "deposit"];
const RISK_TERMS = ["sms", "text blast", "mass", "scrape", "cold list", "guarantee", "medical", "patient", "legal", "credit", "debt"];

export function evaluateLeadForOffer(lead) {
  const normalized = normalizeLead(lead);
  const combined = [
    normalized.form_type,
    normalized.company,
    normalized.website,
    normalized.service_interest,
    normalized.budget_range,
    normalized.timeline,
    normalized.message,
  ].join(" ").toLowerCase();

  const serviceFitScore = scoreServiceFit(normalized, combined);
  const leadClassification = classifyLead(normalized, combined, serviceFitScore);
  const offerRecommendation = recommendOffer(combined, serviceFitScore, leadClassification);
  const riskFlags = buildRiskFlags(normalized, combined);
  const ownerReviewStatus = "pending_review";
  const sendAllowed = false;
  const draft = buildDraft(normalized, offerRecommendation, leadClassification, riskFlags);
  const auditSummary = {
    generated_at: new Date().toISOString(),
    automation_mode: "owner_review_required",
    risk_flags: riskFlags,
    signals: {
      has_contact_consent: Boolean(normalized.consent_contact),
      marketing_opt_in: Boolean(normalized.consent_marketing),
      has_company: Boolean(normalized.company),
      has_website: Boolean(normalized.website),
      has_timeline: Boolean(normalized.timeline),
      has_budget: Boolean(normalized.budget_range),
    },
    compliance_note: "Draft generation is internal only. Do not send until an owner manually approves the exact recipient, copy, offer, and suppression/consent state.",
  };

  return {
    lead_id: normalized.id || null,
    lead_classification: leadClassification,
    service_fit_score: serviceFitScore,
    offer_recommendation: offerRecommendation,
    ai_draft_follow_up: draft,
    audit_summary: auditSummary,
    zoho_hooks: buildZohoHooks(normalized, offerRecommendation, ownerReviewStatus),
    admin_status: {
      owner_review_status: ownerReviewStatus,
      fulfillment_status: "drafted_for_review",
      send_allowed: sendAllowed,
      last_action: "offer_evaluated",
    },
    review_required: true,
    owner_review_status: ownerReviewStatus,
    send_allowed: sendAllowed,
  };
}

export function shouldSendZohoDraft(evaluation) {
  return evaluation?.send_allowed === true && evaluation?.owner_review_status === "approved";
}

export async function persistOfferEvaluation(env, leadId, evaluation) {
  if (!env?.LEADS_DB || !leadId || !evaluation) return { ok: false, skipped: true };
  await env.LEADS_DB.prepare(`INSERT INTO lead_offer_evaluations (
    id, lead_id, lead_classification, service_fit_score, offer_id, offer_title,
    draft_subject, draft_body, owner_review_status, fulfillment_status, send_allowed,
    audit_summary_json, zoho_hooks_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(lead_id) DO UPDATE SET
    updated_at = datetime('now'),
    lead_classification = excluded.lead_classification,
    service_fit_score = excluded.service_fit_score,
    offer_id = excluded.offer_id,
    offer_title = excluded.offer_title,
    draft_subject = excluded.draft_subject,
    draft_body = excluded.draft_body,
    owner_review_status = excluded.owner_review_status,
    fulfillment_status = excluded.fulfillment_status,
    send_allowed = excluded.send_allowed,
    audit_summary_json = excluded.audit_summary_json,
    zoho_hooks_json = excluded.zoho_hooks_json`).bind(
    crypto.randomUUID(),
    leadId,
    evaluation.lead_classification,
    evaluation.service_fit_score,
    evaluation.offer_recommendation.offer_id,
    evaluation.offer_recommendation.title,
    evaluation.ai_draft_follow_up.subject,
    evaluation.ai_draft_follow_up.body,
    evaluation.owner_review_status,
    evaluation.admin_status.fulfillment_status,
    evaluation.send_allowed ? 1 : 0,
    JSON.stringify(evaluation.audit_summary),
    JSON.stringify(evaluation.zoho_hooks),
  ).run();
  return { ok: true };
}

export async function writeOfferAudit(env, leadId, eventType, metadata = {}) {
  if (!env?.LEADS_DB) return;
  await env.LEADS_DB.prepare("INSERT INTO lead_events (id, lead_id, event_type, actor, metadata_json) VALUES (?, ?, ?, 'system', ?)")
    .bind(crypto.randomUUID(), leadId || null, eventType, JSON.stringify(metadata))
    .run();
}

function normalizeLead(lead = {}) {
  return {
    id: safe(lead.id, 80),
    form_type: safe(lead.form_type || "contact", 40),
    name: safe(lead.name || "there", 120),
    email: safe(lead.email, 254).toLowerCase(),
    company: safe(lead.company, 160),
    website: safe(lead.website, 300),
    service_interest: safe(lead.service_interest, 160),
    budget_range: safe(lead.budget_range, 120),
    timeline: safe(lead.timeline, 120),
    message: safe(lead.message, 3000),
    consent_contact: lead.consent_contact === true || lead.consent_contact === 1,
    consent_marketing: lead.consent_marketing === true || lead.consent_marketing === 1,
  };
}

function scoreServiceFit(lead, combined) {
  let score = 0;
  if (["audit", "booking", "phone_help", "contact"].includes(lead.form_type)) score += 20;
  if (lead.company) score += 10;
  if (lead.website) score += 10;
  if (lead.service_interest) score += 15;
  if (lead.budget_range) score += 10;
  if (lead.timeline) score += 10;
  if (lead.message.length > 40) score += 10;
  for (const term of HIGH_INTENT_TERMS) if (combined.includes(term)) score += 3;
  for (const offer of OFFER_CATALOG) {
    for (const keyword of offer.fit_keywords) if (combined.includes(keyword)) score += 4;
  }
  return Math.min(100, score);
}

function classifyLead(lead, combined, score) {
  if (lead.form_type === "newsletter" && score < 50) return "newsletter_or_low_intent";
  if (!lead.consent_contact) return "blocked_missing_contact_consent";
  if (score >= 80 || HIGH_INTENT_TERMS.some((term) => combined.includes(term))) return "hot_service_request";
  if (score >= 55) return "qualified_service_interest";
  return "manual_triage";
}

function recommendOffer(combined, score, classification) {
  if (classification === "newsletter_or_low_intent" || classification === "blocked_missing_contact_consent") {
    return { offer_id: "manual-triage", title: "Manual Triage", fit_score: score, summary: "Keep in review queue; do not send an offer automatically.", next_step: "Owner reviews context and decides whether a one-to-one reply is appropriate." };
  }
  const ranked = OFFER_CATALOG.map((offer) => ({
    offer,
    hits: offer.fit_keywords.filter((keyword) => combined.includes(keyword)).length,
  })).sort((a, b) => b.hits - a.hits || b.offer.service_fit_floor - a.offer.service_fit_floor);
  const selected = ranked.find((entry) => entry.hits > 0)?.offer || OFFER_CATALOG[1];
  return { offer_id: selected.offer_id, title: selected.title, fit_score: score, summary: selected.summary, next_step: selected.next_step };
}

function buildRiskFlags(lead, combined) {
  const flags = ["owner_review_required_before_send"];
  if (!lead.consent_contact) flags.push("missing_contact_consent");
  if (!lead.consent_marketing) flags.push("service_reply_only_no_marketing_opt_in");
  for (const term of RISK_TERMS) if (combined.includes(term)) flags.push(`review_term:${term.replace(/\s+/g, "_")}`);
  return [...new Set(flags)];
}

function buildDraft(lead, offer, classification, riskFlags) {
  const companyLabel = lead.company || "your business";
  const subject = `${companyLabel}: ${offer.title} next step`;
  const firstName = lead.name && lead.name !== "there" ? lead.name.split(" ")[0] : "there";
  const body = [
    `Hi ${firstName},`,
    "",
    `Thanks for reaching out about ${lead.service_interest || "the workflow"}. Based on the request, the best-fit next step looks like ${offer.title}.`,
    `Why: ${offer.summary}`,
    "",
    "I can review the current intake/follow-up path, identify the fastest revenue leak to fix, and send back a scoped next step for owner approval before anything is sent or automated.",
    "",
    `Internal classification: ${classification}. Owner review required before sending. Risk flags: ${riskFlags.join(", ")}.`,
  ].join("\n");
  return { subject, body, channel: "email", draft_only: true };
}

function buildZohoHooks(lead, offer, ownerReviewStatus) {
  return {
    read_hooks: ["zoho_mail_recent_threads", "zoho_contact_lookup_by_email"],
    send_hook: "zoho_mail_send_draft_after_owner_approval",
    proposed_contact_update: {
      email: lead.email,
      company: lead.company || null,
      website: lead.website || null,
      lead_source: "mehyar.us intake",
      offer_id: offer.offer_id,
      owner_review_status: ownerReviewStatus,
    },
    no_autonomous_send: true,
  };
}

function safe(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
