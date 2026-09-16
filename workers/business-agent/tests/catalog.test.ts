import { describe, expect, it } from "vitest";
import { ADDONS, CATALOG_VERSION, LEGACY_BOUNDARY, METERS, METERING_RULES, PLANS, TRIAL, getAddon, getPlan, publicCatalog } from "../src/catalog";
import { PORTFOLIO, assertPortfolioReadContract, getProduct } from "../src/portfolio";

describe("Mayor AI commercial contract", () => {
  it("preserves all three authorized price anchors, setup and exact 10% annual discount", () => {
    expect(PLANS.map((plan) => [plan.id, plan.monthlyCents, plan.setupCents, plan.annualCents])).toEqual([
      ["business", 34900, 150000, 376920], ["growth", 54900, 250000, 592920], ["operations", 89900, 450000, 970920],
    ]);
    for (const plan of PLANS) {
      expect(plan.annualCents).toBe(Math.round(plan.monthlyCents * 12 * 0.9));
      expect(plan.annualCents / 12).toBeGreaterThan(30000);
      expect(plan.subscriptionReset).toBe("monthly_even_on_annual");
      expect(plan.rollover).toBe(false);
      expect(plan.activationRequires).toContain("us_number_and_voice_routing_ready");
    }
  });

  it("matches allowance commitments rather than silently reducing expensive features", () => {
    expect(PLANS.map((plan) => Object.values(plan.allowances))).toEqual([
      [1, 1, 3, 4, 5, 2000, 100, 1, 100, 2, 1000, 0, 30],
      [1, 1, 5, 8, 12, 5000, 300, 1, 300, 5, 3000, 1, 45],
      [1, 2, 10, 15, 25, 10000, 750, 2, 1000, 10, 10000, 2, 60],
    ]);
    expect(PLANS.map((plan) => plan.supportTarget)).toEqual([{ amount: 2, unit: "business_days" }, { amount: 1, unit: "business_days" }, { amount: 4, unit: "business_hours" }]);
    expect(getPlan("business")?.includedFeatures).not.toContain("advanced_nurture");
    expect(getPlan("growth")?.includedFeatures).toContain("advanced_nurture");
  });

  it("prices every fixed add-on in integer cents with the promised setup fees", () => {
    const expected: Record<string, [number, number]> = {
      "text-credits": [2500, 0], "voice-overage": [35, 0], "voice-expansion": [9900, 0], "local-number": [1000, 0],
      "whatsapp-business": [4900, 14900], "whatsapp-number": [2900, 14900], "sms-registration": [9900, 0],
      "team-seat": [1500, 0], "connected-account": [1500, 0], "workflow-capacity": [4900, 0], "workflow-configuration": [29900, 0],
      location: [14900, 49900], "advanced-templates": [9900, 29900], "social-publishing": [9900, 19900],
      "content-production": [14900, 0], "short-video": [19900, 0], storage: [1000, 0], "crawl-pages": [500, 0],
      "platform-emails": [500, 0], "managed-work": [15000, 0], "external-adapter": [9900, 150000],
      "isolated-execution": [19900, 75000], "execution-overage": [1500, 0], "enterprise-sso": [19900, 50000], "regulated-discovery": [75000, 0],
    };
    const fixed = ADDONS.filter((addon) => addon.pricing.kind === "fixed");
    expect(fixed).toHaveLength(Object.keys(expected).length);
    for (const addon of fixed) {
      if (addon.pricing.kind !== "fixed") throw new Error("unreachable");
      expect([addon.pricing.amountCents, addon.pricing.setupCents ?? 0], addon.id).toEqual(expected[addon.id]);
      expect(Number.isSafeInteger(addon.pricing.amountCents)).toBe(true);
      expect(addon.pricing.quantity).toBeGreaterThan(0);
    }
    expect(getAddon("voice-overage")?.pricing).toMatchObject({ quantity: 60, cadence: "usage" });
    expect(getAddon("execution-overage")?.pricing).toMatchObject({ quantity: 3600 });
    expect(getAddon("text-credits")?.entitlement).toMatchObject({ credits: 1000, expiresAfterMonths: 12 });
    expect(getAddon("social-publishing")?.entitlement).toMatchObject({ profiles: 2, posts: 30 });
    expect(getAddon("content-production")?.entitlement).toMatchObject({ posts: 12, revisionsPerPost: 1, sourceAssetsPerPost: 3 });
    expect(getAddon("short-video")?.entitlement).toMatchObject({ clips: 4, maxSecondsPerClip: 30 });
    expect(getAddon("regulated-discovery")?.entitlement).toMatchObject({ acceptedProjectCreditCents: 75000 });
  });

  it("represents variable charges and inherited plans without invented fixed prices", () => {
    for (const id of ["whatsapp-delivery", "sms-transport"]) expect(getAddon(id)?.pricing).toEqual({ kind: "pass_through", markupBasisPoints: 2000, freeProviderEventCents: 0, rateVersionRequired: true });
    expect(getAddon("independent-agent")?.pricing).toEqual({ kind: "chosen_plan", planIds: ["business", "growth", "operations"] });
    expect(getAddon("enterprise-sso")?.pricing).toMatchObject({ from: true });
    expect(getAddon("managed-work")?.entitlement.platformDefectsBillable).toBe(false);
    expect(getAddon("whatsapp-business")?.eligiblePlans).toEqual(["business"]);
  });

  it("cannot advertise checkout readiness from a definition or expose a mutable catalog", () => {
    const snapshot = publicCatalog();
    expect(snapshot.commerceEnabled).toBe(false);
    expect(snapshot.brand).toBe("Mayor AI");
    expect(snapshot.version).toBe(CATALOG_VERSION);
    for (const item of [...PLANS, ...ADDONS]) {
      expect(item.readiness.checkoutEnabled).toBe(false);
      expect(item.readiness.evidence).toEqual([]);
      expect(item.readiness.requiredGates).toEqual(expect.arrayContaining(["live_acceptance_evidence", "margin_validation", "pilot_release"]));
      expect(Object.isFrozen(item)).toBe(true);
    }
    expect(() => Object.assign(PLANS[0].allowances, { voiceMinutes: 999999 })).toThrow();
    snapshot.plans.splice(0);
    expect(PLANS).toHaveLength(3);
    expect(JSON.parse(JSON.stringify(publicCatalog())).currency).toBe("USD");
  });

  it("defines unique new SKUs, valid meters and no retried or double-metered usage", () => {
    const ids = [...PLANS, ...ADDONS].map((item) => item.id);
    const skus = [...PLANS, ...ADDONS].map((item) => item.sku);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(skus).size).toBe(skus.length);
    expect(skus.every((sku) => sku.startsWith("mayor-ai-"))).toBe(true);
    const meterIds = new Set(METERS.map((meter) => meter.id));
    for (const addon of ADDONS) expect(meterIds.has(addon.meter)).toBe(true);
    expect(METERS.every((meter) => !meter.billRetries)).toBe(true);
    expect(METERING_RULES).toMatchObject({ inputTokensPerCredit: 12000, outputTokensPerCredit: 2000, voiceDeductsTextCredits: false, billInternalRetries: false, billRetrievalOrDeterministicTools: false, warningPercentages: [70, 90, 100] });
    expect(getPlan("legacy-openclaw")).toBeUndefined();
    expect(getAddon("unlimited-voice")).toBeUndefined();
    expect(TRIAL).toMatchObject({ days: 7, cardRequired: false, crawlPages: 20, textAiCredits: 50, workflowPreviews: 2, autonomousSends: false });
  });
});

describe("read-only portfolio compatibility", () => {
  it("maps exactly 18 real product identities and distinguishes incomplete source", () => {
    expect(PORTFOLIO).toHaveLength(18);
    expect(new Set(PORTFOLIO.map((product) => product.id)).size).toBe(18);
    expect(getProduct("promptpack")?.sourceCoverage).toBe("empty_repository");
    expect(getProduct("freelanceros")?.sourceCoverage).toBe("readme_only");
    expect(getProduct("crayonkid")?.sourceCoverage).toBe("placeholder");
    expect(getProduct("rizza")?.billingSystem).toBe("independent_base44");
    expect(getProduct("aimech")?.billingSystem).toBe("independent_base44");
    expect(getProduct("designful")?.legacySkus).toHaveLength(7);
    expect(getProduct("freelanceros")?.limits).toContain("preserve_lifetime_entitlement");
    expect(getProduct("crayonkid")?.priceEvidence[0].status).toBe("future_proposal_not_authorized");
  });

  it("never authorizes legacy purchases, repairs, webhook replays or second executors", () => {
    expect(LEGACY_BOUNDARY.writesAllowed).toBe(false);
    expect(LEGACY_BOUNDARY.legacyRetainerStackingAllowed).toBe(false);
    for (const product of PORTFOLIO) {
      expect(product.access).toMatchObject({ mode: "read_only", canModifyLegacy: false, canTriggerLegacyFulfillment: false, canReplayWebhooks: false, canCreateLegacyPurchase: false, emailMatchLinksAccounts: false });
      expect(product.readiness.executorEnabled).toBe(false);
      for (const method of ["POST", "PATCH", "DELETE", "PUT"]) expect(() => assertPortfolioReadContract(product.id, method, "https://mehyar.us/api/pay/fulfill-backfill")).toThrow("legacy_write_prohibited");
    }
  });

  it("allowlists exact verified read surfaces and rejects query/path/host confusion", () => {
    expect(assertPortfolioReadContract("designful", "GET", "https://mehyar.us/api/pay/status?token=fixture").purpose).toBe("payment_status");
    for (const url of [
      "https://evil.example/api/pay/status?token=fixture", "https://mehyar.us/api/pay/fulfill-backfill?token=fixture",
      "https://mehyar.us/api/pay/status?token=fixture&repair=1", "https://mehyar.us/api/pay/status?token=fixture&token=other",
      "https://user:pass@mehyar.us/api/pay/status?token=fixture", "https://mehyar.us/api/pay/status",
    ]) expect(() => assertPortfolioReadContract("designful", "GET", url)).toThrow();
    expect(() => assertPortfolioReadContract("rizza", "GET", "https://mehyar.us/api/pay/status?token=fixture")).toThrow("unverified_legacy_read_interface");
  });
});
