/** New Mayor AI commerce only. This module must never be imported by legacy billing. */
export const CATALOG_VERSION = "2026-09-16.1";
export const PLAN_IDS = ["business", "growth", "operations"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const LIVE_GATES = ["provider_approval", "executor_implemented", "live_acceptance_evidence", "margin_validation", "pilot_release"] as const;
export type LiveGate = (typeof LIVE_GATES)[number];
export interface SaleReadiness {
  readonly status: "proposed";
  readonly checkoutEnabled: false;
  readonly requiredGates: readonly LiveGate[];
  readonly evidence: readonly string[];
}
const readiness: SaleReadiness = deepFreeze({ status: "proposed", checkoutEnabled: false, requiredGates: LIVE_GATES, evidence: [] });

export const METERS = deepFreeze([
  { id: "text_ai_credit", unit: "completed_generation_credit", kind: "consumption", billRetries: false },
  { id: "voice_connected_second", unit: "connected_second", kind: "consumption", billRetries: false },
  { id: "local_number", unit: "active_us_local_number", kind: "capacity", billRetries: false },
  { id: "whatsapp_number", unit: "active_business_number", kind: "capacity", billRetries: false },
  { id: "whatsapp_provider_cent", unit: "actual_provider_cent", kind: "pass_through", billRetries: false },
  { id: "sms_provider_cent", unit: "actual_provider_carrier_cent", kind: "pass_through", billRetries: false },
  { id: "registration", unit: "approved_assistance_project", kind: "one_time", billRetries: false },
  { id: "team_seat", unit: "active_member", kind: "capacity", billRetries: false },
  { id: "connected_account", unit: "distinct_provider_account", kind: "capacity", billRetries: false },
  { id: "active_workflow", unit: "enabled_configuration", kind: "capacity", billRetries: false },
  { id: "workflow_configuration", unit: "scoped_workflow", kind: "one_time", billRetries: false },
  { id: "location", unit: "operating_location", kind: "capacity", billRetries: false },
  { id: "business_agent", unit: "independent_business_agent", kind: "capacity", billRetries: false },
  { id: "advanced_templates", unit: "template_pack", kind: "capacity", billRetries: false },
  { id: "published_post", unit: "provider_confirmed_post", kind: "consumption", billRetries: false },
  { id: "creative_post", unit: "approved_text_or_static_image_post", kind: "consumption", billRetries: false },
  { id: "video_clip", unit: "approved_clip_up_to_30_seconds", kind: "consumption", billRetries: false },
  { id: "storage_byte", unit: "stored_byte", kind: "capacity", billRetries: false },
  { id: "crawl_page", unit: "successful_permitted_page", kind: "consumption", billRetries: false },
  { id: "platform_email", unit: "provider_accepted_platform_message", kind: "consumption", billRetries: false },
  { id: "managed_work_second", unit: "approved_work_second", kind: "consumption", billRetries: false },
  { id: "external_adapter", unit: "scoped_documented_api", kind: "capacity", billRetries: false },
  { id: "execution_second", unit: "active_execution_second", kind: "consumption", billRetries: false },
  { id: "identity_provider", unit: "configured_identity_provider", kind: "capacity", billRetries: false },
  { id: "discovery_project", unit: "delivered_discovery", kind: "one_time", billRetries: false },
] as const);
export type MeterId = (typeof METERS)[number]["id"];

export interface Allowances {
  readonly agents: number; readonly locations: number; readonly seats: number;
  readonly connectedAccounts: number; readonly activeWorkflows: number; readonly textAiCredits: number;
  readonly voiceMinutes: number; readonly localNumbers: number; readonly crawlPages: number;
  readonly storageGB: number; readonly platformEmails: number; readonly whatsappNumbers: number;
  readonly improvementMinutes: number;
}
export interface Plan {
  readonly id: PlanId; readonly sku: string; readonly name: string; readonly version: string;
  readonly monthlyCents: number; readonly setupCents: number; readonly annualCents: number;
  readonly allowances: Allowances; readonly includedFeatures: readonly string[];
  readonly supportTarget: { readonly amount: number; readonly unit: "business_days" | "business_hours" };
  readonly subscriptionReset: "monthly_even_on_annual"; readonly rollover: false;
  readonly activationRequires: readonly string[]; readonly cancellation: string; readonly readiness: SaleReadiness;
}
const sharedFeatures = ["dedicated_agent", "owner_pwa", "private_memory", "audit_trail", "pause_controls", "monitored_execution", "maintenance", "standard_support", "primary_website_widget", "core_automation_templates"];
function plan(id: PlanId, name: string, monthlyCents: number, setupCents: number, annualCents: number, allowances: Allowances, supportTarget: Plan["supportTarget"], extras: string[] = []): Plan {
  return { id, sku: `mayor-ai-${id}-v1`, name, version: CATALOG_VERSION, monthlyCents, setupCents, annualCents, allowances,
    includedFeatures: [...sharedFeatures, ...extras], supportTarget, subscriptionReset: "monthly_even_on_annual", rollover: false,
    activationRequires: ["confirmed_business", "approved_policy", "us_number_and_voice_routing_ready", ...LIVE_GATES],
    cancellation: "Cancel renewal at period end; stop paid effects at entitlement expiry; preserve required receipts and export. Setup is not discounted by annual billing.", readiness };
}
export const PLANS: readonly Plan[] = deepFreeze([
  plan("business", "Business Agent", 34900, 150000, 376920, { agents: 1, locations: 1, seats: 3, connectedAccounts: 4, activeWorkflows: 5, textAiCredits: 2000, voiceMinutes: 100, localNumbers: 1, crawlPages: 100, storageGB: 2, platformEmails: 1000, whatsappNumbers: 0, improvementMinutes: 30 }, { amount: 2, unit: "business_days" }),
  plan("growth", "Growth Agent", 54900, 250000, 592920, { agents: 1, locations: 1, seats: 5, connectedAccounts: 8, activeWorkflows: 12, textAiCredits: 5000, voiceMinutes: 300, localNumbers: 1, crawlPages: 300, storageGB: 5, platformEmails: 3000, whatsappNumbers: 1, improvementMinutes: 45 }, { amount: 1, unit: "business_days" }, ["whatsapp_management", "advanced_nurture", "advanced_waitlist", "document_templates", "content_templates"]),
  plan("operations", "Operations Agent", 89900, 450000, 970920, { agents: 1, locations: 2, seats: 10, connectedAccounts: 15, activeWorkflows: 25, textAiCredits: 10000, voiceMinutes: 750, localNumbers: 2, crawlPages: 1000, storageGB: 10, platformEmails: 10000, whatsappNumbers: 2, improvementMinutes: 60 }, { amount: 4, unit: "business_hours" }, ["whatsapp_management", "advanced_nurture", "advanced_waitlist", "document_templates", "content_templates", "multiple_recurring_research_briefs"]),
]);

export type AddonPricing =
  | { readonly kind: "fixed"; readonly amountCents: number; readonly cadence: "one_time" | "monthly" | "usage"; readonly quantity: number; readonly setupCents?: number; readonly from?: true }
  | { readonly kind: "pass_through"; readonly markupBasisPoints: 2000; readonly freeProviderEventCents: 0; readonly rateVersionRequired: true }
  | { readonly kind: "chosen_plan"; readonly planIds: readonly PlanId[] };
export interface Addon {
  readonly id: string; readonly sku: string; readonly version: string; readonly name: string;
  readonly pricing: AddonPricing; readonly meter: MeterId; readonly scope: string;
  readonly eligiblePlans: readonly PlanId[]; readonly prerequisites: readonly string[];
  readonly entitlement: Readonly<Record<string, number | boolean | string>>;
  readonly cancellation: string; readonly readiness: SaleReadiness;
}
function fixed(amountCents: number, cadence: "one_time" | "monthly" | "usage", quantity = 1, setupCents?: number): AddonPricing {
  return { kind: "fixed", amountCents, cadence, quantity, ...(setupCents === undefined ? {} : { setupCents }) };
}
function addon(id: string, name: string, pricing: AddonPricing, meter: MeterId, scope: string, entitlement: Addon["entitlement"], prerequisites: string[] = [], eligiblePlans: readonly PlanId[] = PLAN_IDS): Addon {
  return { id, sku: `mayor-ai-addon-${id}-v1`, version: CATALOG_VERSION, name, pricing, meter, scope, entitlement, prerequisites: ["active_plan", ...prerequisites], eligiblePlans,
    cancellation: pricing.kind === "fixed" && pricing.cadence === "monthly" ? "Cancel at renewal; capacity/allowance ends at paid period end. Export or reduce usage before expiry; no silent deletion." : "Only authorized settled usage or delivered scope is charged; release failed reservations. No automatic repeat purchase.", readiness };
}
const passThrough: AddonPricing = { kind: "pass_through", markupBasisPoints: 2000, freeProviderEventCents: 0, rateVersionRequired: true };
export const ADDONS: readonly Addon[] = deepFreeze([
  addon("text-credits", "Extra text AI credits", fixed(2500, "one_time", 1000), "text_ai_credit", "1,000 prepaid standard credits; 12-month expiry disclosed before purchase.", { credits: 1000, expiresAfterMonths: 12 }),
  addon("voice-overage", "Additional US AI voice", fixed(35, "usage", 60), "voice_connected_second", "Actual connected seconds aggregated by billing period; failed connection time excluded. No duplicate text-credit charge.", { secondsPerPriceUnit: 60 }, ["voice_ready", "opted_in_spend_cap"]),
  addon("voice-expansion", "Voice expansion pack", fixed(9900, "monthly"), "voice_connected_second", "300 additional US minutes each month, no rollover.", { voiceMinutes: 300, rollover: false }, ["voice_ready"]),
  addon("local-number", "Additional US local number", fixed(1000, "monthly"), "local_number", "One US local number; specialty and international numbers separately quoted.", { localNumbers: 1 }, ["number_eligibility"]),
  addon("whatsapp-business", "WhatsApp management on Business", fixed(4900, "monthly", 1, 14900), "whatsapp_number", "One business number; Meta delivery fees separate.", { whatsappNumbers: 1 }, ["meta_signup_approved", "number_ready"], ["business"]),
  addon("whatsapp-number", "Additional WhatsApp number", fixed(2900, "monthly", 1, 14900), "whatsapp_number", "Per-number setup and health; provider messaging fees separate.", { whatsappNumbers: 1 }, ["meta_signup_approved", "base_whatsapp_entitlement", "number_ready"]),
  addon("whatsapp-delivery", "WhatsApp delivery", passThrough, "whatsapp_provider_cent", "Actual Meta charge plus 20%; market/category rate version and estimate required before approval; free events stay free.", { markupBasisPoints: 2000 }, ["whatsapp_ready", "approved_message_purpose"]),
  addon("sms-transport", "SMS/MMS transport", passThrough, "sms_provider_cent", "Actual provider/carrier cost plus 20%; disclose segments, destination, carrier and registration charges.", { markupBasisPoints: 2000 }, ["sms_registration_ready", "message_consent"]),
  addon("sms-registration", "SMS registration assistance", fixed(9900, "one_time"), "registration", "Assistance only; provider registration fees shown separately, no instant approval promise.", { assistanceProjects: 1 }, ["regional_eligibility"]),
  addon("team-seat", "Additional team seat", fixed(1500, "monthly"), "team_seat", "One member in the same tenant, subject to role permissions.", { seats: 1 }),
  addon("connected-account", "Additional standard connected account", fixed(1500, "monthly"), "connected_account", "One distinct account beyond plan allowance; provider subscription remains customer-owned.", { connectedAccounts: 1 }, ["supported_connector"]),
  addon("workflow-capacity", "Five additional active workflows", fixed(4900, "monthly"), "active_workflow", "Five enabled configurations from existing templates, not custom engineering.", { activeWorkflows: 5 }),
  addon("workflow-configuration", "Custom workflow configuration", fixed(29900, "one_time"), "workflow_configuration", "One workflow using supported connectors, up to two hours; additional approved work $150/hour.", { workflows: 1, includedWorkMinutes: 120 }, ["agreed_scope", "supported_connectors"]),
  addon("location", "Additional operating location", fixed(14900, "monthly", 1, 49900), "location", "Same business and agent with separate location rules. Independent businesses need their own plan.", { locations: 1 }, ["same_business_verified"]),
  addon("independent-agent", "Another independent business or brand agent", { kind: "chosen_plan", planIds: PLAN_IDS }, "business_agent", "Full chosen plan and setup; separate data, subscription and consent. No automatic cross-brand sharing.", { agents: 1, separateTenantRequired: true }, ["new_tenant"]),
  addon("advanced-templates", "Advanced nurture and documents pack", fixed(9900, "monthly", 1, 29900), "advanced_templates", "Growth-level advanced nurture, waitlist and document templates using existing usage allowance.", { advancedNurture: true, advancedWaitlist: true, documentTemplates: true }, ["workflow_prerequisites"], ["business"]),
  addon("social-publishing", "Social publishing management", fixed(9900, "monthly", 1, 19900), "published_post", "Two approved supported profiles, 30 approved scheduled posts/month; creative production and ad spend excluded.", { profiles: 2, posts: 30 }, ["provider_public_posting_approval", "connected_profiles", "rights_and_owner_approval"]),
  addon("content-production", "Content production pack", fixed(14900, "monthly"), "creative_post", "12 approved text/static-image posts, one revision and up to three source assets per post; video excluded.", { posts: 12, revisionsPerPost: 1, sourceAssetsPerPost: 3 }, ["rights_verified", "creative_executor_ready"]),
  addon("short-video", "Four short video clips", fixed(19900, "one_time", 4), "video_clip", "Four clips up to 30 seconds each; supplied/licensed assets and one revision; custom filming excluded.", { clips: 4, maxSecondsPerClip: 30, revisionsPerClip: 1 }, ["rights_verified", "video_executor_ready"]),
  addon("storage", "Five additional GB storage", fixed(1000, "monthly"), "storage_byte", "5 GB tenant capacity with retention controls (decimal GB).", { storageGB: 5 }),
  addon("crawl-pages", "100 additional crawl pages", fixed(500, "one_time", 100), "crawl_page", "100 successful permitted pages; technical retries never billed twice.", { crawlPages: 100 }, ["safe_crawl_ready"]),
  addon("platform-emails", "1,000 additional platform emails", fixed(500, "one_time", 1000), "platform_email", "Transactional or consented platform messages; connected mailbox correspondence uses AI/workflow allowance instead.", { platformEmails: 1000 }, ["verified_sender", "message_purpose"]),
  addon("managed-work", "Additional managed support or improvement", fixed(15000, "usage", 3600), "managed_work_second", "Approved estimate at $150/hour; fixing platform defects is not billable improvement.", { secondsPerPriceUnit: 3600, platformDefectsBillable: false }, ["approved_work_estimate"]),
  addon("external-adapter", "Standard external adapter project", fixed(9900, "monthly", 1, 150000), "external_adapter", "One documented API, up to five named operations, agreed monitoring; eligibility and discovery first.", { adapters: 1, maxNamedOperations: 5 }, ["discovery_approved", "documented_api", "adapter_ready"]),
  addon("isolated-execution", "Advanced isolated execution", fixed(19900, "monthly", 1, 75000), "execution_second", "One isolated tenant cell, up to ten active execution hours/month; defined tools only.", { cells: 1, activeExecutionHours: 10 }, ["isolated_cell_ready", "allowed_tools", "hosting_margin_validated"]),
  addon("execution-overage", "Additional isolated execution", fixed(1500, "usage", 3600), "execution_second", "Additional active execution at $15/hour, subject to the owner's spending cap.", { secondsPerPriceUnit: 3600 }, ["isolated_execution_entitlement", "opted_in_spend_cap"]),
  addon("enterprise-sso", "Enterprise SSO", { ...fixed(19900, "monthly", 1, 50000), kind: "fixed", amountCents: 19900, cadence: "monthly", quantity: 1, from: true }, "identity_provider", "From $199/month + $500 setup; one IdP, vendor costs and exact scope quoted; no billing before ready.", { identityProviders: 1 }, ["approved_quote", "identity_provider_ready"]),
  addon("regulated-discovery", "Complex or regulated integration discovery", fixed(75000, "one_time"), "discovery_project", "Data map, vendor eligibility, fixed scope and quote; credited to accepted project. Does not enable unsupported integration.", { discoveryProjects: 1, acceptedProjectCreditCents: 75000 }, ["approved_discovery_scope"]),
]);

export const TRIAL = deepFreeze({ days: 7, cardRequired: false, agents: 1, crawlPages: 20, textAiCredits: 50, workflowPreviews: 2, modes: ["preview_draft"], autonomousSends: false, paidPhoneProvisioning: false, dataRetentionAfterTrialDays: 30 });
export const METERING_RULES = deepFreeze({ inputTokensPerCredit: 12000, outputTokensPerCredit: 2000, minimumCompletedGenerationCredits: 1, formula: "max(ceil(input/12000),ceil(output/2000),1)", premiumRouteRequiresPublishedMultiplier: true, reserveBeforeExecution: true, settleOnSuccess: true, releaseOnFailure: true, billInternalRetries: false, billRetrievalOrDeterministicTools: false, voiceDeductsTextCredits: false, creativeUsesSeparateSku: true, warningPercentages: [70, 90, 100], defaultAtLimit: "pause_optional_paid_actions_and_human_fallback", autoTopUp: "opt_in_with_monthly_dollar_cap", connectedAccountCounting: "one_distinct_provider_account_regardless_of_enabled_services" });
export const LEGACY_BOUNDARY = deepFreeze({ writesAllowed: false, protectedPaths: ["functions/api/pay/", "functions/api/audit/full-report/", "functions/api/_shared/payFulfillment.js", "functions/api/_shared/fulfill"], protectedContracts: ["checkout", "webhook", "status", "download", "backfill", "metadata", "sku", "tokens", "success_urls", "fulfillment", "legacy_tables"], legacyRetainerStackingAllowed: false, legacyLifetimeEntitlementsPreserved: true });

export function getPlan(id: string): Plan | undefined { return PLANS.find((item) => item.id === id); }
export function getAddon(id: string): Addon | undefined { return ADDONS.find((item) => item.id === id); }
export function publicCatalog() {
  // A detached serializable snapshot; mutation by a client cannot alter the authoritative definitions.
  return JSON.parse(JSON.stringify({ version: CATALOG_VERSION, brand: "Mayor AI", currency: "USD", commerceEnabled: false, plans: PLANS, addons: ADDONS, meters: METERS, trial: TRIAL, metering: METERING_RULES, legacyBoundary: LEGACY_BOUNDARY })) as { version: string; brand: string; currency: "USD"; commerceEnabled: false; plans: Plan[]; addons: Addon[]; meters: typeof METERS; trial: typeof TRIAL; metering: typeof METERING_RULES; legacyBoundary: typeof LEGACY_BOUNDARY };
}
