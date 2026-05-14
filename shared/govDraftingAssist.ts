export type GovOpportunitySource = "SAM.gov" | "USAspending" | "agency" | "owner_upload" | "other";

export interface GovCitation {
  sourceUrl: string;
  sourceRetrievedAt: string;
  label?: string;
}

export interface GovRequirementInput extends GovCitation {
  text: string;
}

export interface GovOpportunityInput {
  id: string;
  title: string;
  agency?: string;
  source: GovOpportunitySource | string;
  sourceUrl: string;
  sourceRetrievedAt: string;
  closeDate?: string | null;
  summary?: string | null;
  requirements?: GovRequirementInput[];
  evaluationFactors?: GovRequirementInput[];
  attachments?: GovCitation[];
}

export interface GovCapabilityBlockInput {
  key: string;
  label: string;
  text: string;
  approved: boolean;
  updatedAt: string;
  sourceUrl?: string;
}

export interface GovOwnerFactsInput {
  certifications?: string[];
  naicsCodes?: string[];
  pastPerformance?: string[];
  pricingGuidance?: string | null;
  eligibilityNotes?: string[];
}

export interface GovDraftInput {
  generatedAt?: string;
  actor?: string;
  opportunity: GovOpportunityInput;
  capabilityLibrary?: GovCapabilityBlockInput[];
  ownerFacts?: GovOwnerFactsInput;
}

export interface GovChecklistItem {
  id: string;
  requirement: string;
  ownerAction: string;
  status: "not_started" | "owner_confirmation_required" | "ready_for_owner_review";
  citations: GovCitation[];
}

export interface GovComplianceMatrixRow {
  id: string;
  sourceRequirement: string;
  responseLocation: string;
  draftResponseGuidance: string;
  evidenceNeeded: string;
  ownerConfirmationRequired: boolean;
  citations: GovCitation[];
}

export interface GovCapabilityStatementBlock {
  key: string;
  label: string;
  text: string;
  citations: GovCitation[];
  ownerEditable: boolean;
}

export interface GovOwnerConfirmationItem {
  topic: "certifications" | "past_performance" | "pricing" | "eligibility";
  prompt: string;
  reason: string;
}

export interface GovDraftAudit {
  draftId: string;
  opportunityId: string;
  generatedAt: string;
  actor: string;
  sourceCitations: GovCitation[];
  guardrailVersion: "gov-drafting-assist-v1";
}

export interface GovDraftGuardrail {
  key: string;
  status: "active";
  detail: string;
}

export interface GovOpportunityDraft {
  draftId: string;
  opportunityId: string;
  opportunityTitle: string;
  ownerReviewOnly: true;
  autoSubmitAllowed: false;
  status: "owner_review_required";
  generatedAt: string;
  requirementsChecklist: GovChecklistItem[];
  complianceMatrix: GovComplianceMatrixRow[];
  contractingOfficerQuestions: string[];
  responseOutline: Array<{ heading: string; bullets: string[]; citations: GovCitation[] }>;
  capabilityStatementBlocks: GovCapabilityStatementBlock[];
  ownerConfirmationItems: GovOwnerConfirmationItem[];
  riskFlags: string[];
  guardrails: GovDraftGuardrail[];
  audit: GovDraftAudit;
}

const GUARDRAILS: GovDraftGuardrail[] = [
  {
    key: "owner_review_only",
    status: "active",
    detail: "Generated material is an owner-review draft only and cannot be submitted automatically.",
  },
  {
    key: "no_invented_claims",
    status: "active",
    detail: "Certifications, eligibility, past performance, staffing, and pricing must come from owner-approved facts only.",
  },
  {
    key: "source_traceability",
    status: "active",
    detail: "Requirements and compliance rows carry source URLs and retrieval timestamps.",
  },
  {
    key: "manual_submission_gate",
    status: "active",
    detail: "The final package requires explicit owner approval and separate manual submission outside this workflow.",
  },
];

function citationFromOpportunity(opportunity: GovOpportunityInput): GovCitation {
  return {
    sourceUrl: opportunity.sourceUrl,
    sourceRetrievedAt: opportunity.sourceRetrievedAt,
    label: `${opportunity.source}: ${opportunity.title}`,
  };
}

function citationFromRequirement(requirement: GovRequirementInput): GovCitation {
  return {
    sourceUrl: requirement.sourceUrl,
    sourceRetrievedAt: requirement.sourceRetrievedAt,
    label: requirement.label,
  };
}

function hasValidCitation(citation: GovCitation) {
  return Boolean(citation.sourceUrl?.trim() && citation.sourceRetrievedAt?.trim());
}

function traceableScope(opportunity: GovOpportunityInput) {
  const statements = [
    opportunity.summary,
    ...(opportunity.requirements || []).map((item) => item.text),
    ...(opportunity.evaluationFactors || []).map((item) => item.text),
  ]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  return statements.length
    ? statements.slice(0, 2).join(" ").replace(/\s+/g, " ").slice(0, 260)
    : "the cited solicitation requirements";
}

function uniqCitations(citations: GovCitation[]): GovCitation[] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = `${citation.sourceUrl}|${citation.sourceRetrievedAt}|${citation.label || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function slug(index: number) {
  return String(index + 1).padStart(2, "0");
}

function requiresOwnerConfirmation(text: string) {
  return /(certification|eligib|past performance|reference|price|pricing|cost|rate|clearance|registration|set-aside|small-business)/i.test(text);
}

function ownerActionFor(text: string) {
  if (/past performance|reference/i.test(text)) return "Owner must select truthful, supportable references or mark as not available.";
  if (/certification|eligib|registration|set-aside|small-business/i.test(text)) return "Owner must verify registrations, eligibility, and certifications before using any claim.";
  if (/price|pricing|cost|rate/i.test(text)) return "Owner must provide pricing strategy; assistant must not invent numbers.";
  return "Draft response language and attach supporting evidence for owner review.";
}

function evidenceFor(text: string) {
  if (/past performance|reference/i.test(text)) return "Owner-approved references only; leave blank if not available.";
  if (/certification|eligib|registration|set-aside|small-business/i.test(text)) return "SAM/UEI/NAICS/certification evidence verified by owner.";
  if (/price|pricing|cost|rate/i.test(text)) return "Owner-approved pricing worksheet or explicit no-bid decision.";
  return "Technical approach notes, project plan, screenshots, or approved capability block.";
}

function deriveConfirmationItems(opportunity: GovOpportunityInput, ownerFacts: GovOwnerFactsInput): GovOwnerConfirmationItem[] {
  const allRequirementText = [...(opportunity.requirements || []), ...(opportunity.evaluationFactors || [])]
    .map((item) => item.text)
    .join("\n");
  const items: GovOwnerConfirmationItem[] = [];

  if (/certification|eligib|registration|set-aside|small-business|NAICS/i.test(allRequirementText)) {
    items.push({
      topic: "certifications",
      prompt: "Confirm exact active registrations, NAICS codes, set-aside eligibility, and certifications before this language is used.",
      reason: ownerFacts.certifications?.length || ownerFacts.naicsCodes?.length ? "Owner facts are present but still require final confirmation." : "No owner-approved certification/eligibility facts were provided.",
    });
  }
  if (/past performance|reference/i.test(allRequirementText) || !ownerFacts.pastPerformance?.length) {
    items.push({
      topic: "past_performance",
      prompt: "Provide truthful past-performance references or decide to mark this requirement as unavailable/not a fit.",
      reason: ownerFacts.pastPerformance?.length ? "Past-performance claims must be matched to the solicitation requirement." : "No owner-approved past-performance references were provided.",
    });
  }
  if (/price|pricing|cost|rate/i.test(allRequirementText) || !ownerFacts.pricingGuidance) {
    items.push({
      topic: "pricing",
      prompt: "Provide pricing guidance separately; do not let the assistant invent pricing, discounts, or labor rates.",
      reason: ownerFacts.pricingGuidance ? "Pricing exists but requires owner signoff." : "No owner-approved pricing guidance was provided.",
    });
  }
  if (/eligib|set-aside|small-business|registration/i.test(allRequirementText)) {
    items.push({
      topic: "eligibility",
      prompt: "Confirm the opportunity is legally eligible and commercially worth pursuing before drafting final response language.",
      reason: "Eligibility must be verified by the owner against the live solicitation and company registrations.",
    });
  }
  return items;
}

function deriveRiskFlags(items: GovOwnerConfirmationItem[]) {
  return items.map((item) => `${item.topic}_owner_confirmation_required`);
}

export function generateGovOpportunityDraft(input: GovDraftInput): GovOpportunityDraft {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const actor = input.actor || "system";
  const opportunityCitation = citationFromOpportunity(input.opportunity);
  const requirements = input.opportunity.requirements || [];
  const evaluationFactors = input.opportunity.evaluationFactors || [];
  const responseObligations = [
    ...requirements.map((requirement, index) => ({ kind: "REQ", index, item: requirement })),
    ...evaluationFactors.map((requirement, index) => ({ kind: "EVAL", index, item: requirement })),
  ];
  const scopedNeed = traceableScope(input.opportunity);
  const ownerFacts = input.ownerFacts || {};
  const confirmationItems = deriveConfirmationItems(input.opportunity, ownerFacts);
  const riskFlags = deriveRiskFlags(confirmationItems);
  const draftId = `govdraft_${input.opportunity.id}_${generatedAt.replace(/[^0-9]/g, "").slice(0, 14)}`;

  const requirementsChecklist: GovChecklistItem[] = responseObligations.map((obligation) => {
    const needsOwner = requiresOwnerConfirmation(obligation.item.text);
    return {
      id: `${obligation.kind}-${slug(obligation.index)}`,
      requirement: obligation.item.text,
      ownerAction: ownerActionFor(obligation.item.text),
      status: needsOwner ? "owner_confirmation_required" : "not_started",
      citations: [citationFromRequirement(obligation.item)],
    };
  });

  const complianceMatrix: GovComplianceMatrixRow[] = responseObligations.map((obligation) => {
    const needsOwner = requiresOwnerConfirmation(obligation.item.text);
    return {
      id: `CM-${obligation.kind}-${slug(obligation.index)}`,
      sourceRequirement: obligation.item.text,
      responseLocation: `Response outline section for ${obligation.kind}-${slug(obligation.index)}`,
      draftResponseGuidance: needsOwner
        ? "Do not claim compliance yet. Add owner-confirmed facts and supporting evidence before final use."
        : "Draft concise, source-aligned response language and keep evidence attached for owner review.",
      evidenceNeeded: evidenceFor(obligation.item.text),
      ownerConfirmationRequired: needsOwner,
      citations: [citationFromRequirement(obligation.item)],
    };
  });

  const contractingOfficerQuestions = [
    "Can the agency confirm the required submission format, page limits, and any attachment naming rules?",
    "Are subcontractor/team member references acceptable for any past performance requirement, or must all references be prime-contractor work?",
    "Which registrations, representations, NAICS codes, or set-aside eligibility checks are mandatory at quote/proposal submission versus award?",
    "Are there incumbent constraints, integration dependencies, or existing systems vendors should assume?",
    "Will the agency accept a phased delivery approach with discovery, draft review, implementation, and acceptance milestones?",
  ];

  const responseOutline = [
    {
      heading: "Executive summary",
      bullets: [
        `Summarize understanding of ${input.opportunity.agency || "the agency"}'s need using only cited facts: ${scopedNeed}`,
        "State that final eligibility, pricing, and references remain owner-confirmed before submission.",
      ],
      citations: [opportunityCitation],
    },
    {
      heading: "Technical approach",
      bullets: [
        `Map the proposed approach directly to the cited requirements: ${scopedNeed}`,
        "Describe discovery, implementation, testing, deployment, documentation, and handoff without overclaiming certifications or unsupported experience.",
      ],
      citations: uniqCitations(evaluationFactors.map(citationFromRequirement).concat(opportunityCitation)),
    },
    {
      heading: "Management plan",
      bullets: [
        "Outline owner-reviewed milestones, communication cadence, risk handling, and acceptance checkpoints.",
        "Identify open owner-confirmation items before final submission.",
      ],
      citations: requirements.length ? [citationFromRequirement(requirements[0])] : [opportunityCitation],
    },
    {
      heading: "Compliance matrix and attachments",
      bullets: [
        "Attach the compliance matrix with every row tied to a source citation and retrieval timestamp.",
        "Keep unsupported claims blank or marked owner-confirmation-required.",
      ],
      citations: uniqCitations(requirements.map(citationFromRequirement)),
    },
  ];

  const capabilityStatementBlocks: GovCapabilityStatementBlock[] = (input.capabilityLibrary || [])
    .filter((block) => block.approved)
    .map((block) => ({
      key: block.key,
      label: block.label,
      text: block.text,
      ownerEditable: true,
      citations: [
        {
          sourceUrl: block.sourceUrl || "owner-approved-capability-library",
          sourceRetrievedAt: block.updatedAt,
          label: block.label,
        },
      ],
    }));

  const sourceCitations = uniqCitations([
    opportunityCitation,
    ...requirements.map(citationFromRequirement),
    ...evaluationFactors.map(citationFromRequirement),
    ...(input.opportunity.attachments || []),
    ...capabilityStatementBlocks.flatMap((block) => block.citations),
  ]);

  return {
    draftId,
    opportunityId: input.opportunity.id,
    opportunityTitle: input.opportunity.title,
    ownerReviewOnly: true,
    autoSubmitAllowed: false,
    status: "owner_review_required",
    generatedAt,
    requirementsChecklist,
    complianceMatrix,
    contractingOfficerQuestions,
    responseOutline,
    capabilityStatementBlocks,
    ownerConfirmationItems: confirmationItems,
    riskFlags,
    guardrails: GUARDRAILS,
    audit: {
      draftId,
      opportunityId: input.opportunity.id,
      generatedAt,
      actor,
      sourceCitations,
      guardrailVersion: "gov-drafting-assist-v1",
    },
  };
}

export function validateGovDraftForOwnerReview(draft: Partial<GovOpportunityDraft>) {
  const errors: string[] = [];
  if (draft.ownerReviewOnly !== true) errors.push("owner_review_only_required");
  if (draft.autoSubmitAllowed !== false) errors.push("auto_submit_must_be_false");
  if (draft.status !== "owner_review_required") errors.push("owner_review_required_status_missing");
  if (!draft.audit?.generatedAt || !draft.audit?.sourceCitations?.length) errors.push("audit_citations_required");
  if (draft.audit?.sourceCitations?.some((citation) => !hasValidCitation(citation))) errors.push("valid_audit_citations_required");
  if (!draft.guardrails?.length || draft.guardrails.some((guardrail) => guardrail.status !== "active")) errors.push("active_guardrails_required");
  if (!draft.requirementsChecklist?.every((item) => item.citations?.length)) errors.push("checklist_citations_required");
  if (draft.requirementsChecklist?.some((item) => item.citations?.some((citation) => !hasValidCitation(citation)))) errors.push("valid_checklist_citations_required");
  if (!draft.complianceMatrix?.every((row) => row.citations?.length)) errors.push("compliance_citations_required");
  if (draft.complianceMatrix?.some((row) => row.citations?.some((citation) => !hasValidCitation(citation)))) errors.push("valid_compliance_citations_required");
  return { ok: errors.length === 0, errors };
}
