import assert from "node:assert/strict";
import {
  generateGovOpportunityDraft,
  validateGovDraftForOwnerReview,
} from "../shared/govDraftingAssist.ts";

const generatedAt = "2026-05-13T21:30:00.000Z";
const draft = generateGovOpportunityDraft({
  generatedAt,
  actor: "system:test",
  opportunity: {
    id: "opp-001",
    title: "Workflow Automation Support",
    agency: "Example Agency",
    source: "SAM.gov",
    sourceUrl: "https://sam.gov/opp/example",
    sourceRetrievedAt: "2026-05-13T20:00:00.000Z",
    closeDate: "2026-06-12",
    summary: "Agency requests workflow automation, CRM integration, and reporting dashboard support.",
    requirements: [
      { text: "Submit technical approach and management plan.", sourceUrl: "https://sam.gov/opp/example#section-l", sourceRetrievedAt: "2026-05-13T20:00:00.000Z" },
      { text: "Provide at least two past performance references.", sourceUrl: "https://sam.gov/opp/example#section-m", sourceRetrievedAt: "2026-05-13T20:00:00.000Z" },
      { text: "Identify required small-business registration and NAICS fit.", sourceUrl: "https://sam.gov/opp/example#section-c", sourceRetrievedAt: "2026-05-13T20:00:00.000Z" },
    ],
    evaluationFactors: [
      { text: "Technical approach", sourceUrl: "https://sam.gov/opp/example#eval", sourceRetrievedAt: "2026-05-13T20:00:00.000Z" },
      { text: "Relevant past performance", sourceUrl: "https://sam.gov/opp/example#eval", sourceRetrievedAt: "2026-05-13T20:00:00.000Z" },
    ],
  },
  capabilityLibrary: [
    {
      key: "company_summary",
      label: "Company summary",
      text: "MehyarSoft builds focused software, workflow automation, CRM, and reporting systems for small teams.",
      approved: true,
      updatedAt: "2026-05-11T00:00:00.000Z",
    },
    {
      key: "unapproved_claim",
      label: "Unapproved claim",
      text: "Do not include this unreviewed claim.",
      approved: false,
      updatedAt: "2026-05-11T00:00:00.000Z",
    },
  ],
  ownerFacts: {
    certifications: [],
    naicsCodes: ["541511", "541512"],
    pastPerformance: [],
    pricingGuidance: null,
  },
});

assert.equal(draft.ownerReviewOnly, true);
assert.equal(draft.autoSubmitAllowed, false);
assert.equal(draft.status, "owner_review_required");
assert.equal(draft.audit.generatedAt, generatedAt);
assert.equal(draft.audit.sourceCitations.length >= 4, true);
assert.equal(draft.requirementsChecklist.length, 5);
assert.ok(draft.requirementsChecklist.every((item) => item.citations.length >= 1));
assert.equal(draft.complianceMatrix.length, 5);
assert.ok(draft.contractingOfficerQuestions.some((question) => question.includes("past performance")));
assert.ok(draft.responseOutline.some((section) => section.heading === "Technical approach"));
assert.deepEqual(draft.capabilityStatementBlocks.map((block) => block.key), ["company_summary"]);
assert.ok(!JSON.stringify(draft).includes("Do not include this unreviewed claim"));
assert.ok(draft.ownerConfirmationItems.some((item) => item.topic === "past_performance"));
assert.ok(draft.ownerConfirmationItems.some((item) => item.topic === "pricing"));
assert.ok(draft.ownerConfirmationItems.some((item) => item.topic === "certifications"));
assert.ok(draft.riskFlags.includes("past_performance_owner_confirmation_required"));
assert.ok(draft.guardrails.every((guardrail) => guardrail.status === "active"));

const validation = validateGovDraftForOwnerReview(draft);
assert.deepEqual(validation.errors, []);
assert.equal(validation.ok, true);

const unsafeDraft = { ...draft, autoSubmitAllowed: true, ownerReviewOnly: false };
const unsafeValidation = validateGovDraftForOwnerReview(unsafeDraft);
assert.equal(unsafeValidation.ok, false);
assert.ok(unsafeValidation.errors.includes("owner_review_only_required"));
assert.ok(unsafeValidation.errors.includes("auto_submit_must_be_false"));

const malformedCitationDraft = generateGovOpportunityDraft({
  generatedAt,
  opportunity: {
    id: "opp-bad-cite",
    title: "Bad citation",
    source: "SAM.gov",
    sourceUrl: "",
    sourceRetrievedAt: "",
    requirements: [{ text: "Submit a quality control plan.", sourceUrl: "", sourceRetrievedAt: "" }],
  },
});
const malformedCitationValidation = validateGovDraftForOwnerReview(malformedCitationDraft);
assert.equal(malformedCitationValidation.ok, false);
assert.ok(malformedCitationValidation.errors.includes("valid_audit_citations_required"));
assert.ok(malformedCitationValidation.errors.includes("valid_checklist_citations_required"));
assert.ok(malformedCitationValidation.errors.includes("valid_compliance_citations_required"));

const sourceNeutralDraft = generateGovOpportunityDraft({
  generatedAt,
  opportunity: {
    id: "opp-002",
    title: "Records Retention Policy Review",
    agency: "Example Records Office",
    source: "SAM.gov",
    sourceUrl: "https://sam.gov/opp/records",
    sourceRetrievedAt: "2026-05-13T20:00:00.000Z",
    summary: "Agency requests records retention policy review and document inventory support.",
    requirements: [{ text: "Submit records inventory approach.", sourceUrl: "https://sam.gov/opp/records#req", sourceRetrievedAt: "2026-05-13T20:00:00.000Z" }],
    evaluationFactors: [{ text: "Understanding of records retention requirements.", sourceUrl: "https://sam.gov/opp/records#eval", sourceRetrievedAt: "2026-05-13T20:00:00.000Z" }],
  },
});
const sourceNeutralJson = JSON.stringify(sourceNeutralDraft);
assert.ok(!/CRM|dashboard|workflow automation/i.test(sourceNeutralJson));
assert.ok(sourceNeutralDraft.requirementsChecklist.some((item) => item.id.startsWith("EVAL-")));
assert.ok(sourceNeutralDraft.complianceMatrix.some((row) => row.id.startsWith("CM-EVAL-")));

console.log("gov drafting assist tests passed");
