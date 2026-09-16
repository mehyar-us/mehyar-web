import { describe, expect, it } from "vitest";
import { ADDONS, METERS } from "../src/catalog";
import { AUTOMATIONS, INDUSTRY_PACKS, evaluateAutomationEligibility, getAutomation, getIndustryPack } from "../src/automations";

describe("versioned automation definitions", () => {
  it("covers every specification group and required capability without pretending an executor exists", () => {
    const required = {
      setup: ["url-research", "business-brief", "missing-information", "connector-setup", "first-preview", "recovery"],
      "front-desk": ["faq", "intent", "contact", "assignment", "handoff", "after-hours"],
      email: ["inquiry-detection", "summary", "draft", "reply", "attachments", "unanswered-followup"],
      appointments: ["availability", "book", "confirmation", "reminder", "reschedule", "cancel", "no-show", "waitlist", "resources"],
      sales: ["qualify", "quote-draft", "proposal-draft", "estimate-followup", "booking-handoff", "nurture"],
      support: ["order-lookup", "delivery-status", "new-service-redelivery", "complaint", "refund-request", "review-draft"],
      retention: ["rebook", "renewal", "winback", "satisfaction", "optout"],
      content: ["calendar", "captions", "emails", "blog-faq", "asset", "publish"],
      documents: ["checklist", "retrieve", "extract", "missing-reminder", "report"],
      owner: ["morning-brief", "urgent-alert", "weekly-results", "workflow-health", "cost-report", "knowledge-refresh", "recurring-research"],
      products: ["monitor", "support-draft", "new-generate", "new-qa", "new-delivery", "subscription-renewal", "subscription-dunning"],
      voice: ["service", "intake", "scheduling", "handoff", "reminder", "callback"],
      whatsapp: ["service", "intake", "scheduling", "handoff", "reminder", "callback"],
    };
    for (const [prefix, ids] of Object.entries(required)) for (const id of ids) expect(getAutomation(`${prefix}.${id}`), `${prefix}.${id}`).toBeDefined();
    expect(AUTOMATIONS).toHaveLength(Object.values(required).flat().length);
    expect(new Set(AUTOMATIONS.map((item) => item.id)).size).toBe(AUTOMATIONS.length);
    for (const definition of AUTOMATIONS) {
      expect(definition.readiness).toMatchObject({ definition: "complete", executor: "not_implemented", executionEnabled: false, evidence: [] });
      expect(Object.isFrozen(definition.actionSequence)).toBe(true);
      expect(definition.inputs).toContain("tenant_id");
      expect(definition.permissions.length).toBeGreaterThan(0);
      expect(definition.evidenceSources.length).toBeGreaterThan(0);
      expect(definition.requiredTests).toContain("cross_tenant_denied");
    }
  });

  it("defines retriable, metered, cancellable and human-escalated work", () => {
    const meters = new Set<string>(METERS.map((meter) => meter.id));
    const addons = new Set(ADDONS.map((addon) => addon.id));
    for (const definition of AUTOMATIONS) {
      expect(definition.retry.ambiguousExternalEffect).toBe("reconcile_then_human_review_never_blind_resend");
      expect(definition.retry.idempotencyKey).toContain("tenant_id");
      expect(definition.cancellation.recheckBeforeEveryEffect).toBe(true);
      expect(definition.metering.retriesBillable).toBe(false);
      expect(definition.escalation.reasons).toContain("retry_exhausted");
      expect(definition.approval.modelMayGrantAuthority).toBe(false);
      if (!definition.eligibility.prerequisites.includes("tenant_exists_including_paused_or_past_due")) expect(definition.suppressions).toEqual(expect.arrayContaining(["self_reply", "auto_responder_loop", "duplicate_event", "opted_out_recipient", "stale_appointment", "resolved_case", "cold_outbound"]));
      if (definition.metering.meter) expect(meters.has(definition.metering.meter)).toBe(true);
      if (definition.eligibility.businessAddon) expect(addons.has(definition.eligibility.businessAddon)).toBe(true);
      if (definition.actionSequence.some((action) => action.effect === "external_write")) {
        expect(definition.eligibility.prerequisites).toContain("active_paid_plan");
        expect(definition.receipt.providerReceiptRequiredForExternalSuccess).toBe(true);
        expect(definition.readiness.requiredGates).toContain("live_provider_evidence");
      }
    }
    expect(getAutomation("voice.service")?.metering.meter).toBe("voice_connected_second");
    expect(getAutomation("voice.service")?.metering.voiceTextDoubleBilling).toBe(false);
    expect(getAutomation("appointments.availability")?.metering.meter).toBeNull();
    expect(getAutomation("content.asset")?.metering.meter).toBe("creative_post");
  });

  it("keeps drafts, campaigns and publishing within their approved modes", () => {
    expect(getAutomation("email.draft")?.modes).toEqual(["preview_draft"]);
    expect(getAutomation("content.publish")?.modes).not.toContain("automatic_policy");
    expect(getAutomation("sales.nurture")?.approval.perActionRequired).toBe(true);
    expect(getAutomation("appointments.cancel")?.approval.perActionRequired).toBe(true);
    expect(getAutomation("retention.optout")?.eligibility.plans).toContain("business");
    expect(getAutomation("retention.optout")?.eligibility.prerequisites).toContain("tenant_exists_including_paused_or_past_due");
    expect(getAutomation("retention.optout")?.suppressions).not.toContain("paused_tenant");
    expect(getAutomation("retention.optout")?.suppressions).not.toContain("opted_out_recipient");
  });

  it("never treats a catalog definition as completed execution or a grant of authority", () => {
    const definition = getAutomation("appointments.book")!;
    const result = evaluateAutomationEligibility(definition.id, { planId: "operations", mode: "automatic_policy", grantedPermissions: definition.permissions, satisfiedPrerequisites: definition.eligibility.prerequisites });
    expect(result).toEqual({ eligible: false, executionEnabled: false, reasons: ["executor_not_implemented", "live_readiness_not_verified"] });
    const denied = evaluateAutomationEligibility("email.reply", { planId: "business", mode: "automatic_policy" });
    expect(denied.reasons).toContain("permission_missing:email.send");
    expect(evaluateAutomationEligibility("unknown", { planId: "business", mode: "preview_draft" }).reasons).toEqual(["unknown_automation"]);
  });

  it("requires Growth or the correct Business add-on for advanced workflows", () => {
    const base = { planId: "business", mode: "preview_draft" as const };
    expect(evaluateAutomationEligibility("appointments.waitlist", base).reasons).toContain("plan_entitlement_missing");
    expect(evaluateAutomationEligibility("appointments.waitlist", { ...base, addonIds: ["advanced-templates"] }).reasons).not.toContain("plan_entitlement_missing");
    expect(evaluateAutomationEligibility("owner.recurring-research", { planId: "growth", mode: "preview_draft" }).reasons).toContain("plan_entitlement_missing");
  });

  it("keeps all existing product automation read-only and disallows legacy redelivery", () => {
    for (const definition of AUTOMATIONS) {
      expect(definition.legacyWritesAllowed).toBe(false);
      if (definition.legacyAccess === "read_only") expect(definition.actionSequence.some((step) => step.effect === "external_write")).toBe(false);
    }
    expect(getAutomation("support.new-service-redelivery")?.eligibility.prerequisites).toContain("new_service_order_only");
    expect(getAutomation("products.new-delivery")?.eligibility.prerequisites).toContain("new_service_order_only");
    expect(getAutomation("products.subscription-renewal")?.eligibility.prerequisites).toContain("new_subscription_event_namespace");
    expect(getAutomation("products.legacy-repair")).toBeUndefined();
  });
});

describe("industry packs", () => {
  it("contains ten reusable packs and exactly the three defined initial pilots", () => {
    expect(INDUSTRY_PACKS).toHaveLength(10);
    expect(new Set(INDUSTRY_PACKS.map((pack) => pack.id)).size).toBe(10);
    expect(INDUSTRY_PACKS.filter((pack) => pack.initialPilot).map((pack) => pack.id)).toEqual(["barbershops-salons", "home-services", "professional-services"]);
    for (const pack of INDUSTRY_PACKS) {
      for (const id of [...pack.defaultAutomationIds, ...pack.previewAutomationIds]) expect(getAutomation(id), `${pack.id}:${id}`).toBeDefined();
      expect(pack.requiredFacts.length).toBeGreaterThan(0);
      expect(pack.prerequisites.length).toBeGreaterThan(0);
      expect(pack.prohibitedActions.length).toBeGreaterThan(0);
      expect(pack.readiness).toBe("definition_ready_executor_and_live_tests_pending");
    }
  });

  it("restricts clinics to public FAQs until a separately documented review", () => {
    const clinic = getIndustryPack("clinics-dentists")!;
    expect(clinic.defaultScope).toBe("public_faq_only");
    expect(clinic.defaultAutomationIds).toEqual(["front-desk.faq"]);
    expect(clinic.extraReleaseGates).toEqual(expect.arrayContaining(["documented_privacy_security_vendor_assessment", "appropriate_contracts"]));
    expect(evaluateAutomationEligibility("appointments.book", { planId: "operations", mode: "automatic_policy", industryPackId: clinic.id }).reasons).toContain("clinic_additional_review_required");
    expect(evaluateAutomationEligibility("front-desk.faq", { planId: "business", mode: "preview_draft", industryPackId: clinic.id }).reasons).not.toContain("clinic_additional_review_required");
  });
});
