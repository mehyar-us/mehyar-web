// ── Shared helpers for auto-tender pipeline ───────────────────────────────────
// Pricing engine + LLM-assisted document generators.
// Always-valid heuristic fallback when no LLM / owner facts are available.
// Used by functions/api/admin/auto-tender/ and workers/_scheduled.js.
// ─────────────────────────────────────────────────────────────────────────────

import { chatJson, safeJsonParse, resolveLlmConfig } from "./llmChat.js";

// ── Constants ─────────────────────────────────────────────────────────────────

export const PIPELINE_STAGE = "Discovery";          // only auto-tender Discovery items
export const DEADLINE_WINDOW_DAYS = [1, 10];       // inclusive range
export const PIPELINE_LIMIT = 5;                   // max drafts per morning run

export const COMPANY_PROFILE = {
  name: "MehyarSoft LLC",
  location: "Brooklyn, NY",
  email: "mehyar@mehyarsoft.com",
  website: "https://mehyar.us",
  duns: "",           // fill from env
  uei: "",            // fill from env
  sam_expiry: "",     // fill from env
  set_aside_status: "none",
  small_business: true,
  core_services: [
    "custom software / web application development",
    "website modernization",
    "workflow automation",
    "CRM implementation and integration",
    "data dashboards / business intelligence",
    "cloud migration (Workers, Pages, D1, KV, R2)",
    "API integration / systems integration",
    "case management and intake portals",
    "AI agent / LLM-powered feature integration",
  ],
  sweet_spot: "small ($5k–$250k) federal/state/city software + automation contracts",
};

// ── Rate-card helpers ──────────────────────────────────────────────────────────

/**
 * Load the default (lowest-id alphabetically) rate card from D1.
 * Returns null if no rate card exists (degrades gracefully).
 */
export async function loadDefaultRateCard(db) {
  const rc = await db
    .prepare(
      `SELECT * FROM rate_cards WHERE is_gov_facing = 1 AND (effective_to = '' OR effective_to >= date('now')) ORDER BY name ASC LIMIT 1`
    )
    .first();
  return rc || null;
}

/**
 * Build a Section-B pricing table (SF-1449 style line items) from:
 *   - laborCategories: [{category, hours, rate}]
 *   - rateCard: row from rate_cards
 *   - contractType: 'T&M' | 'FFP' | 'Labor-Hour'
 *   - notes: string
 * Returns markdown string suitable for embedding in a proposal.
 */
export function buildSectionB({
  laborCategories = [],
  rateCard = null,
  contractType = "T&M",
  opportunityTitle = "",
  opportunityId = "",
  additionalLineItems = [],
} = {}) {
  const lines = [];
  lines.push("## SECTION B – PRICES AND PRECEDENCE");
  lines.push("");
  if (contractType === "FFP") {
    lines.push(`**Contract Type:** Firm-Fixed-Price (FFP)`);
  } else if (contractType === "Labor-Hour") {
    lines.push(`**Contract Type:** Labor-Hour (LH)`);
  } else {
    lines.push(`**Contract Type:** Time-and-Materials (T&M)`);
  }
  lines.push("");
  lines.push(`| # | Labor Category | Est. Hours | Rate ($/hr) | Total ($) |`);
  lines.push(`|---|----------------|-----------|-------------|-----------|`);

  let grandTotal = 0;
  let totalHours = 0;

  // Labor categories
  laborCategories.forEach(({ category, hours, rate }) => {
    const h = Number(hours) || 0;
    const r = Number(rate) || (rateCard ? (rateCard.min_labor_rate + rateCard.max_labor_rate) / 2 : 150);
    const total = h * r;
    grandTotal += total;
    totalHours += h;
    lines.push(
      `| ${laborCategories.indexOf({ category, hours, rate }) + 1} | ${category} | ${h.toFixed(0)} | ${r.toFixed(2)} | ${total.toFixed(2)} |`
    );
  });

  // Additional line items (e.g. software licenses, travel)
  additionalLineItems.forEach(({ description, qty, unit_price, unit }) => {
    const q = Number(qty) || 1;
    const up = Number(unit_price) || 0;
    const total = q * up;
    grandTotal += total;
    lines.push(
      `| ${laborCategories.length + additionalLineItems.indexOf({ description, qty, unit_price, unit }) + 1} | ${description} | ${unit || "lot"} | ${up.toFixed(2)} | ${total.toFixed(2)} |`
    );
  });

  lines.push("");
  lines.push(`| **GRAND TOTAL** | | **${totalHours.toFixed(0)}** | | **$${grandTotal.toFixed(2)}** |`);
  lines.push("");
  lines.push(
    `*Rates are loaded hourly rates inclusive of all indirect costs, overhead, and fee. ` +
      (rateCard ? `Rate card: "${rateCard.name}". ` : "") +
      `This is an estimate; final prices are subject to negotiation and scope verification.*`
  );
  lines.push("");
  lines.push(
    "> **Owner Action Required:** Verify all hours, rates, and line items before submission. " +
      "Replace with an approved rate card (e.g. GSA STLS) if required by the solicitation."
  );
  return lines.join("\n");
}

/**
 * Build a deterministic heuristic pricing model for an opportunity.
 * Called when no LLM is available or owner facts are missing.
 *
 * @param {object} opp - gov_opportunity row
 * @param {object|null} rateCard - rate_cards row
 * @returns {object} { laborCategories, totalEstimatedHours, totalPrice, priceLow, priceHigh }
 */
export function buildHeuristicPricing(opp = {}, rateCard = null) {
  const rc = rateCard || {
    name: "Commercial T&M Baseline",
    min_labor_rate: 75,
    max_labor_rate: 225,
  };

  // Scale effort based on estimated_value if available
  const value = Number(opp.estimated_value) || 0;
  const deadline = opp.response_deadline
    ? Math.max(0, (new Date(opp.response_deadline) - Date.now()) / (1000 * 60 * 60 * 24))
    : 7;

  // Estimate hours from dollar value (assume 50% labor share, $125/hr blended rate)
  let estimatedHours = 0;
  if (value > 0) {
    estimatedHours = Math.round((value * 0.5) / 125);
  } else {
    // Use deadline as a proxy: tight deadline = smaller scope = fewer hours
    estimatedHours = Math.max(8, Math.min(320, Math.round(deadline * 12)));
  }

  // Labor categories based on NAICS or generic IT services
  const naicsHint = (opp.naics_codes_json || "")
    .toLowerCase()
    .replace(/[^0-9]/g, "");

  const laborCategories = buildLaborCategories(naicsHint, estimatedHours, rc);

  const blendedRate = (rc.min_labor_rate + rc.max_labor_rate) / 2;
  const totalPrice = laborCategories.reduce(
    (sum, { hours, rate }) => sum + hours * rate,
    0
  );

  return {
    laborCategories,
    totalEstimatedHours: estimatedHours,
    totalPrice,
    priceLow: totalPrice * 0.85,
    priceHigh: totalPrice * 1.2,
  };
}

function buildLaborCategories(naicsHint, totalHours, rc) {
  // Default IT services labor categories
  const defaults = [
    { category: "Project Manager / Business Analyst", share: 0.15, rate: rc.min_labor_rate },
    { category: "Senior Software Engineer", share: 0.45, rate: rc.max_labor_rate * 0.9 },
    { category: "Full-Stack Developer", share: 0.25, rate: (rc.min_labor_rate + rc.max_labor_rate) / 2 },
    { category: "QA Engineer / Tester", share: 0.10, rate: rc.min_labor_rate },
    { category: "DevOps / Cloud Engineer", share: 0.05, rate: rc.max_labor_rate * 0.85 },
  ];

  // Distribute hours proportionally
  return defaults.map(({ category, share, rate }) => ({
    category,
    hours: Math.max(1, Math.round(totalHours * share)),
    rate: Math.round(rate * 100) / 100,
  }));
}

// ── LLM Cover Letter Generator ─────────────────────────────────────────────────

const COVER_LETTER_SYSTEM = `You are a senior capture manager and proposal writer for MehyarSoft LLC, a Brooklyn NY small business.

Write a concise, professional cover letter (300–500 words) for a government proposal.
- Tone: confident, specific, plain-English — never boilerplate or padded
- Directly reference the agency name, solicitation title, and one key requirement
- Do NOT invent certifications, registration numbers, past performance, or dollar figures
- Flag where owner confirmation is required with [OWNER CONFIRM: ...]
- End with a professional closing
- Return ONLY the letter text, no markdown code fences`;

function buildCoverLetterUserPrompt(opp, company) {
  return `Solicitation:
  Title: ${opp.title || "—"}
  Agency: ${opp.agency || "—"}
  Office: ${opp.office || "—"}
  Type: ${opp.opportunity_type || "—"}
  Posted: ${opp.posted_date || "—"}
  Deadline: ${opp.response_deadline || "—"}
  Est. Value: ${opp.estimated_value ? "$" + Number(opp.estimated_value).toLocaleString() : "—"}
  Set-Aside: ${opp.set_aside || "—"}
  NAICS: ${opp.naics_codes_json || "—"}
  Summary: ${(opp.summary || "").slice(0, 500)}

Company:
  Name: ${company.name}
  Location: ${company.location}
  Core services: ${company.core_services.join("; ")}

Write the cover letter now.`;
}

export async function generateCoverLetter({ env, opportunity, company = COMPANY_PROFILE }) {
  const llmConfig = resolveLlmConfig(env);
  if (!llmConfig.apiKey) {
    return { used_llm: false, text: buildHeuristicCoverLetter(opportunity, company) };
  }
  const result = await chatJson({
    env,
    messages: [
      { role: "system", content: COVER_LETTER_SYSTEM },
      { role: "user", content: buildCoverLetterUserPrompt(opportunity, company) },
    ],
    max_tokens: 700,
    temperature: 0.25,
  });
  if (result.used_llm) {
    return { used_llm: true, model: result.model, text: result.content.trim() };
  }
  return { used_llm: false, text: buildHeuristicCoverLetter(opportunity, company) };
}

function formatDate(date) {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function buildHeuristicCoverLetter(opp = {}, company = COMPANY_PROFILE) {
  const deadline = opp.response_deadline
    ? formatDate(new Date(opp.response_deadline))
    : "[response deadline]";
  const today = formatDate(new Date());
  const agency = opp.agency || "[Agency Name]";
  const office = opp.office ? "Office of " + opp.office : "";
  const title = opp.title || "Solicitation";
  const setAside = opp.set_aside ? opp.set_aside + " Set-Aside" : "[Set-Aside]";
  const summary = ((opp.summary || "a technology solution") + "").slice(0, 200);
  const core0 = company.core_services[0] || "software development";
  const core2 = company.core_services[2] || "workflow automation";
  const loc = company.location;
  const email = company.email;
  const web = company.website;

  let text = "MehyarSoft LLC\n";
  text += loc + "\n\n";
  text += today + "\n\n";
  text += "Contracting Officer\n";
  text += agency + "\n";
  if (office) text += office + "\n";
  text += "\n";
  text += "Re: " + title + " -- " + setAside + "\n\n";
  text += "Dear Contracting Officer:\n\n";
  text += "MehyarSoft LLC is pleased to submit this proposal in response to the above-referenced solicitation. ";
  text += "We are a Brooklyn, New York-based small business specializing in " + core0 + ", " + core2 + ", ";
  text += "and related technology services aligned with " + (opp.agency || "your agency's") + " modernization priorities.\n\n";
  text += "We understand that " + (opp.agency || "the agency") + " requires " + summary + "... ";
  text += "[OWNER CONFIRM: summarize specific deliverable from solicitation requirements here].\n\n";
  text += "MehyarSoft brings demonstrated experience delivering end-to-end software development and workflow automation ";
  text += "on time and within budget. Our team is led by a senior technologist with deep expertise in ";
  text += "cloud-native development, API integration, and AI-assisted applications.\n\n";
  text += "[OWNER CONFIRM: Summarize the specific technical approach for this solicitation using only verified, ";
  text += "accurate experience. Do not invent contract numbers, past performance references, or certifications here.]\n\n";
  text += "We are committed to transparent communication, agile delivery, and delivering measurable value ";
  text += "to " + (opp.agency || "the agency") + " and the communities it serves.\n\n";
  text += "The proposed effort would be completed by " + deadline + ". ";
  text += "[OWNER CONFIRM: Pricing -- do not include a specific price without an approved rate card or pricing worksheet.]\n\n";
  text += "Thank you for your consideration. We look forward to the opportunity to serve " + (opp.agency || "your agency") + ".\n\n";
  text += "Sincerely,\n\n";
  text += "MehyarSoft LLC\n";
  text += loc + "\n";
  text += "Email: " + email + "\n";
  text += "Web: " + web + "\n\n";
  text += "[OWNER CONFIRM BEFORE SUBMISSION: All certifications, set-aside eligibility, registration numbers ";
  text += "(UEI, SAM), past performance references, and pricing figures must be verified and confirmed before this letter is submitted.]";
  return text;
}


// ── LLM Section K Generator ────────────────────────────────────────────────────

const SECTION_K_SYSTEM = `You are a senior government proposal writer. Produce a Section K representation/certifications exhibit (typically 1 page) for a small-business IT services proposal.

Return a JSON object:
{
  "small_business_statute": "string — e.g. '15 U.S.C. 632(a)(1)' or similar",
  "small_business_representation": "string — the exact representation text the small business is making",
  "set_aside_representation": "string — the applicable set-aside or preferencing clause citation",
  "commercial_off_the_shelf": "string — COTS assertion",
  "senior_key_personnel": "string — list of senior/key personnel (even if TBD-placeholder)",
  "owner's_certification_statement": "string — certification language for owner signature",
  "gsa_schedule_holder": "boolean — true if company holds a GSA schedule",
  "naics_representation": "string — the NAICS code the company represents it qualifies under",
  "owner_confirmation_required": ["array of strings — each item needs explicit owner verification before submission"]
}`;

export async function generateSectionK({ env, opportunity, company = COMPANY_PROFILE }) {
  const llmConfig = resolveLlmConfig(env);
  if (!llmConfig.apiKey) {
    return { used_llm: false, data: buildHeuristicSectionK(opportunity, company) };
  }
  const result = await chatJson({
    env,
    messages: [
      { role: "system", content: SECTION_K_SYSTEM },
      {
        role: "user",
        content: `Opportunity: ${opportunity.title || "—"} | Agency: ${opportunity.agency || "—"} | Set-Aside: ${opportunity.set_aside || "—"} | NAICS: ${opportunity.naics_codes_json || "—"}\nCompany: ${company.name} | Location: ${company.location} | Small Business: ${company.small_business}`,
      },
    ],
    max_tokens: 800,
    temperature: 0.15,
  });
  if (result.used_llm) {
    let parsed = safeJsonParse(result.content, null);
    if (parsed) return { used_llm: true, model: result.model, data: parsed };
  }
  return { used_llm: false, data: buildHeuristicSectionK(opportunity, company) };
}

function buildHeuristicSectionK(opp = {}, company = COMPANY_PROFILE) {
  const naics = (opp.naics_codes_json || "541511").replace(/[^0-9]/g, "").slice(0, 6);
  return {
    small_business_statute: "15 U.S.C. 632(a)(1) and (a)(2)",
    small_business_representation: `${company.name} represents that it is a small business as defined under 13 C.F.R. Part 121 and the applicable NAICS code ${naics}.`,
    set_aside_representation: opp.set_aside
      ? `This solicitation is set aside for ${opp.set_aside}. ${company.name} represents that it qualifies under the applicable set-aside designation.`
      : `This solicitation appears to be unrestricted. ${company.name} will confirm set-aside eligibility before submission.`,
    commercial_off_the_shelf: `${company.name} does not anticipate using commercial off-the-shelf (COTS) items in a manner that would trigger COTS pricing obligations.`,
    senior_key_personnel: "[OWNER CONFIRM: List name, title, and qualifications for each key person. Even placeholders must be confirmed before submission.]",
    owners_certification_statement: `The undersigned certifies that the information provided in this proposal is current, accurate, and complete as of the date of submission.`,
    gsa_schedule_holder: false,
    naics_representation: `NAICS ${naics} — ${company.name} represents it qualifies as a small business under this code. [OWNER CONFIRM: Verify NAICS code with SAM.gov entity registration.]`,
    owner_confirmation_required: [
      "Verify NAICS code against current SAM.gov entity registration",
      "Confirm set-aside eligibility with documentation",
      "List key personnel names and titles",
      "Review and sign owner's certification statement",
      "Confirm commercial off-the-shelf assertion",
    ],
  };
}

// ── LLM Capability Narrative Generator ────────────────────────────────────────

const CAPABILITY_NARRATIVE_SYSTEM = `You are a senior capture manager for a small IT services firm. Write a tailored 200-400 word capability narrative section for a government proposal.

Rules:
- Directly map each of the agency's key requirements to specific firm capabilities
- Do NOT invent past performance references, certifications, team member names, or dollar figures
- Use [OWNER CONFIRM: ...] for any claims that need owner verification
- Keep language plain, direct, and specific — no marketing fluff
- Return ONLY the narrative text, no markdown fences`;

export async function generateCapabilityNarrative({ env, opportunity, capabilityStatements = [], company = COMPANY_PROFILE }) {
  const llmConfig = resolveLlmConfig(env);
  const capText = capabilityStatements
    .filter((s) => s.approved)
    .map((s) => `[${s.label}]: ${s.text}`)
    .join("\n\n");

  const prompt = `Agency requirements (from solicitation):
${(opportunity.requirements || []).map((r) => `- ${r.text}`).join("\n") || "General IT services scope (see solicitation)"}

Our approved capability library:
${capText || "No approved capability statements yet — use general firm description."}

Company profile: ${company.name}, ${company.location}. ${company.core_services.join("; ")}.

Write the capability narrative now.`;

  if (!llmConfig.apiKey) {
    return { used_llm: false, text: buildHeuristicCapabilityNarrative(opportunity, capabilityStatements, company) };
  }
  const result = await chatJson({
    env,
    messages: [
      { role: "system", content: CAPABILITY_NARRATIVE_SYSTEM },
      { role: "user", content: prompt },
    ],
    max_tokens: 600,
    temperature: 0.2,
  });
  if (result.used_llm) {
    return { used_llm: true, model: result.model, text: result.content.trim() };
  }
  return { used_llm: false, text: buildHeuristicCapabilityNarrative(opportunity, capabilityStatements, company) };
}

function buildHeuristicCapabilityNarrative(opp = {}, capStatements = [], company = COMPANY_PROFILE) {
  const caps = capStatements.filter((s) => s.approved);
  const paragraphs = [
    `## 1. Corporate Overview\n\n${company.name} (${company.location}) is a small business specializing in ${company.core_services.slice(0, 4).join(", ")}. We deliver technology solutions with a senior-technical-owner model: a single engaged technologist drives discovery, build, and deployment end-to-end, eliminating the gap between technical lead and delivery that plagues larger firms.`,
  ];

  if (caps.length) {
    const [first, ...rest] = caps;
    paragraphs.push(`## 2. Technical Capabilities\n\n**${first.label}.** ${first.text}`);
    if (rest.length) {
      rest.slice(0, 3).forEach((cap) => {
        paragraphs.push(`**${cap.label}.** ${cap.text}`);
      });
    }
  }

  paragraphs.push(`## 3. Differentiation\n\n- **Speed to value:** We ship working software in days, not quarters.\n- **Direct ownership:** The same technologist who sells the work builds it.\n- **Modern stack:** Cloudflare Workers, Pages, D1, KV, R2, plus OpenAI and cloud-agnostic API integration.\n- **AI-ready:** We embed LLM-powered features (agents, semantic search, document extraction) as a standard capability.\n\n[OWNER CONFIRM: Add specific past performance examples with contract numbers, agency names, and outcomes before final submission.]`);

  return paragraphs.join("\n\n");
}

// ── LLM Section B Pricing Table ───────────────────────────────────────────────

const SECTION_B_SYSTEM = `You are a government proposal pricing specialist. Given an opportunity's estimated value and requirements, propose a structured Section B pricing table.

Return a JSON object:
{
  "contract_type": "T&M | FFP | Labor-Hour",
  "labor_categories": [
    { "category": "string", "hours": integer, "rate": number, "justification": "string" }
  ],
  "additional_line_items": [
    { "description": "string", "qty": number, "unit": "string", "unit_price": number }
  ],
  "total_estimated_hours": integer,
  "total_price": number,
  "price_low": number,
  "price_high": number,
  "pricing_confidence": "low | medium | high",
  "assumptions": ["array of assumption strings"],
  "owner_confirmation_required": ["array of strings"]
}`;

export async function generateSectionBPricing({ env, opportunity, rateCard = null, laborCategories = [] }) {
  const llmConfig = resolveLlmConfig(env);
  const value = Number(opportunity.estimated_value) || 0;
  const deadline = opportunity.response_deadline
    ? Math.max(0, (new Date(opportunity.response_deadline) - Date.now()) / (1000 * 60 * 60 * 24))
    : 7;

  const prompt = `Opportunity: ${opportunity.title || "—"}
Agency: ${opportunity.agency || "—"}
Est. Value: ${value ? "$" + value.toLocaleString() : "not specified"}
Deadline: ${opportunity.response_deadline || "—"}
Days remaining: ${deadline.toFixed(0)}
NAICS: ${opportunity.naics_codes_json || "—"}
Summary: ${(opportunity.summary || "").slice(0, 300)}
Rate card: ${rateCard ? `${rateCard.name} (${rateCard.min_labor_rate}–${rateCard.max_labor_rate}/hr)` : "none — use $75–$225/hr loaded commercial rates"}

Generate the Section B pricing table.`;

  if (!llmConfig.apiKey) {
    const heuristic = buildHeuristicPricing(opportunity, rateCard);
    return {
      used_llm: false,
      data: {
        contract_type: "T&M",
        labor_categories: heuristic.laborCategories,
        additional_line_items: [],
        total_estimated_hours: heuristic.totalEstimatedHours,
        total_price: heuristic.totalPrice,
        price_low: heuristic.priceLow,
        price_high: heuristic.priceHigh,
        pricing_confidence: "low",
        assumptions: [
          "Pricing is a heuristic estimate using blended commercial labor rates.",
          "No opportunity-specific rate card was applied.",
          "Hours are estimates based on solicitation scope and deadline.",
        ],
        owner_confirmation_required: [
          "Verify all hours and labor categories against the SOW/PWS/Performance Work Statement",
          "Apply the appropriate GSA rate card or approved subcontractor rates",
          "Confirm total price is within any pre-established ceiling or IDV limit",
        ],
      },
    };
  }

  const result = await chatJson({
    env,
    messages: [
      { role: "system", content: SECTION_B_SYSTEM },
      { role: "user", content: prompt },
    ],
    max_tokens: 700,
    temperature: 0.15,
  });
  if (result.used_llm) {
    const parsed = safeJsonParse(result.content, null);
    if (parsed) return { used_llm: true, model: result.model, data: parsed };
  }
  // Fallback to heuristic
  const heuristic = buildHeuristicPricing(opportunity, rateCard);
  return {
    used_llm: false,
    data: {
      contract_type: "T&M",
      labor_categories: heuristic.laborCategories,
      additional_line_items: [],
      total_estimated_hours: heuristic.totalEstimatedHours,
      total_price: heuristic.totalPrice,
      price_low: heuristic.priceLow,
      price_high: heuristic.priceHigh,
      pricing_confidence: "low",
      assumptions: ["LLM call failed; heuristic estimate used. Verify all numbers before submission."],
      owner_confirmation_required: [
        "Verify all hours and rates against the SOW/PWS",
        "Apply the appropriate GSA rate card or approved rates",
      ],
    },
  };
}

// ── Main pipeline function ──────────────────────────────────────────────────────

/**
 * Generate a full auto-tender draft for a single SAM opportunity.
 * Idempotent: uses upsert logic based on run_id + sam_item_id.
 *
 * @param {object} env - CF env (LEADS_DB, LLM keys, etc.)
 * @param {object} opp - gov_opportunity row
 * @param {string} runId - auto_tender_runs.id for this pipeline execution
 * @param {Date} now
 * @returns {object} { draftId, status, errors }
 */
export async function generateAutoTenderDraft({ env, opp, runId, now = new Date() }) {
  const errors = [];
  const drafts = [];

  try {
    // 1. Load capability statements
    const capRows = await env.LEADS_DB
      .prepare(`SELECT * FROM capability_statements WHERE approved = 1`)
      .all()
      .catch(() => ({ results: [] }));
    const capStatements = (capRows.results || []).map((r) => ({
      ...r,
      approved: Boolean(r.approved),
    }));

    // 2. Load rate card
    const rateCard = await loadDefaultRateCard(env.LEADS_DB);

    // 3. Generate cover letter
    const coverResult = await generateCoverLetter({ env, opportunity: opp });
    if (!coverResult.text) errors.push("cover_letter_empty");

    // 4. Generate Section K
    const sectionKResult = await generateSectionK({ env, opportunity: opp });
    if (!sectionKResult.data) errors.push("section_k_empty");

    // 5. Generate capability narrative
    const capResult = await generateCapabilityNarrative({ env, opportunity: opp, capabilityStatements: capStatements });
    if (!capResult.text) errors.push("capability_narrative_empty");

    // 6. Generate Section B pricing
    const pricingResult = await generateSectionBPricing({ env, opportunity: opp, rateCard });
    if (!pricingResult.data) errors.push("pricing_empty");

    // 7. Build Section B markdown
    let sectionBMarkdown = "";
    if (pricingResult.data) {
      sectionBMarkdown = buildSectionB({
        laborCategories: pricingResult.data.labor_categories || [],
        rateCard,
        contractType: pricingResult.data.contract_type || "T&M",
        opportunityTitle: opp.title,
        opportunityId: opp.id,
        additionalLineItems: pricingResult.data.additional_line_items || [],
      });
    }

    // 8. Compose the full draft document
    const generatedAt = now.toISOString();
    const draftId = `atd_${opp.id}_${generatedAt.replace(/[^0-9]/g, "").slice(0, 14)}`;

    const draft = {
      draftId,
      runId,
      opportunityId: opp.id,
      opportunityTitle: opp.title,
      agency: opp.agency,
      generatedAt,
      status: "draft",           // draft → pending_review → approved → submitted
      coverLetter: coverResult.text || "",
      sectionK: sectionKResult.data || {},
      capabilityNarrative: capResult.text || "",
      sectionBPricing: pricingResult.data || {},
      sectionBMarkdown,
      llmCoverLetter: coverResult.used_llm,
      llmSectionK: sectionKResult.used_llm,
      llmCapabilityNarrative: capResult.used_llm,
      llmSectionBPricing: pricingResult.used_llm,
      llmModels: [
        coverResult.model,
        sectionKResult.model,
        capResult.model,
        pricingResult.model,
      ].filter(Boolean),
      ownerConfirmationItems: [
        ...(sectionKResult.data?.owner_confirmation_required || []),
        ...(pricingResult.data?.owner_confirmation_required || []),
        "Verify fit score and bid decision before submission",
        "Confirm cover letter facts with owner",
      ],
      fitScore: opp.fit_score || null,
      pricingValidated: false,
      pricingConfirmed: false,
      guardrails: [
        { key: "owner_review_only", status: "active", detail: "This draft requires explicit owner approval before any submission." },
        { key: "no_auto_submit", status: "active", detail: "No part of this pipeline may be submitted automatically." },
        { key: "pricing_unconfirmed", status: "active", detail: "Pricing figures require owner confirmation with an approved rate card." },
      ],
    };

    return { draftId, status: "completed", errors, draft, pricingResult, sectionKResult, coverResult, capResult };
  } catch (err) {
    errors.push(`generate_exception: ${err?.message || String(err)}`);
    return { draftId: null, status: "failed", errors, draft: null };
  }
}

/**
 * Find all Discovery-stage SAM items with response_deadline 1..10 days from now.
 */
export async function findTenderableOpportunities(db, now = new Date()) {
  const daysFrom = DEADLINE_WINDOW_DAYS[0];
  const daysTo = DEADLINE_WINDOW_DAYS[1];
  const fromDate = new Date(now.getTime() + daysFrom * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  const toDate = new Date(now.getTime() + daysTo * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const rows = await db
    .prepare(
      `SELECT id, title, agency, office, source, source_url, opportunity_type,
              set_aside, naics_codes_json, posted_date, response_deadline,
              estimated_value, summary, fit_score, confidence, stage,
              requirements_json, evaluation_factors_json, attachments_json
       FROM gov_opportunities
       WHERE stage = ?
         AND response_deadline IS NOT NULL
         AND response_deadline != ''
         AND date(response_deadline) >= date(?)
         AND date(response_deadline) <= date(?)
       ORDER BY response_deadline ASC
       LIMIT ?`
    )
    .bind(PIPELINE_STAGE, fromDate, toDate, PIPELINE_LIMIT)
    .all()
    .catch((e) => ({ results: [], error: e?.message || String(e) }));

  if (rows.error) throw new Error("find_tenderable_opportunities: " + rows.error);
  return (rows.results || []).map((r) => ({
    ...r,
    requirements: safeJsonParse(r.requirements_json, []),
    evaluationFactors: safeJsonParse(r.evaluation_factors_json, []),
    attachments: safeJsonParse(r.attachments_json, []),
  }));
}
