import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Browser contract fixtures only: no live Stripe account, checkout, or charge.
const plans = [
  {
    id: "business",
    name: "Business Agent",
    monthlyCents: 34900,
    setupCents: 150000,
    annualCents: 376920,
    includedFeatures: ["Dedicated assistant", "Email and calendar"],
  },
  {
    id: "growth",
    name: "Growth Agent",
    monthlyCents: 54900,
    setupCents: 250000,
    annualCents: 592920,
    includedFeatures: ["Dedicated assistant", "Team workflows"],
  },
  {
    id: "operations",
    name: "Operations Agent",
    monthlyCents: 89900,
    setupCents: 450000,
    annualCents: 970920,
    includedFeatures: ["Dedicated assistant", "Multiple locations"],
  },
];
const tenants = [
  { id: "business-a", name: "Oak & Ivy Studio", status: "trial" },
  { id: "business-b", name: "Northside Workshop", status: "trial" },
];
const unavailable = {
  setup: false,
  activation: false,
  setupPlanIds: [],
  activationPlanId: null,
  reason: "Purchases are not enabled yet.",
};
const setupReady = {
  setup: true,
  activation: false,
  setupPlanIds: ["business"],
  activationPlanId: null,
  reason: null,
};
const subscription = {
  plan_id: "business",
  status: "active",
  paid_through: "2026-10-16T00:00:00Z",
  cancel_at_period_end: false,
  billing_interval: "monthly",
  grace_expires_at: null,
  access_state: "active",
  pending_plan_id: null,
  dispute_state: null,
};
const paidSetup = {
  id: "ao_fixture",
  sku: "mayor-business-setup",
  plan_id: "business",
  billing_interval: "monthly",
  amount_cents: 150000,
  currency: "usd",
  status: "paid",
  stage: "setup",
  created_at: "2026-09-16T12:00:00Z",
  paid_at: "2026-09-16T12:05:00Z",
  refunded_cents: 0,
};
type Call = {
  path: string;
  tenantId: string | null;
  body: unknown;
  key?: string;
};
async function fixture(
  page: Page,
  options: { role?: string; status?: Record<string, unknown> } = {},
) {
  const calls: Call[] = [];
  const status: Record<string, unknown> = {
    commerceEnabled: false,
    readiness: unavailable,
    portalAvailable: false,
    subscription: null,
    orders: [],
    currency: "USD",
    ...options.status,
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    calls.push({
      path,
      tenantId: url.searchParams.get("tenantId"),
      body: request.method() === "POST" ? request.postDataJSON() : null,
      key: request.headers()["x-idempotency-key"],
    });
    const reply = (data: unknown, code = 200) =>
      route.fulfill({ json: data, status: code });
    if (path === "/api/session")
      return reply({
        user: {
          id: "test-user",
          name: "Sam Rivera",
          email: "owner@example.test",
        },
      });
    if (path === "/api/auth/capabilities")
      return reply({
        providers: {
          google: { configured: false, capabilities: [] },
          microsoft: { configured: false, capabilities: [] },
        },
      });
    if (path === "/api/auth/grants") return reply({ grants: [] });
    // Public catalog deliberately remains proposed even when tenant readiness passes.
    if (path === "/api/catalog")
      return reply({
        version: "fixture-contract",
        brand: "Mayor AI",
        currency: "USD",
        commerceEnabled: false,
        plans,
        addons: [],
      });
    if (path === "/api/tenants") return reply({ tenants });
    if (path.endsWith("/messages")) return reply({ messages: [] });
    if(path.endsWith('/usage'))return reply({usage:{period:'trial',textCredits:{used:0,reserved:0,limit:50}}});
    if (path.startsWith("/api/tenants/"))
      return reply({
        tenant: tenants.find((tenant) => path.endsWith(tenant.id)),
        membership: { role: options.role || "owner" },
        memory: [],
        connections: [],
        activity: [],
        usage: {},
      });
    if (path === "/api/agent-billing/status") return reply(status);
    if (path === "/api/agent-billing/notices") return reply({notices:[],nextCursor:null});
    if (path === "/api/agent-billing/cancel")
      return reply({
        requested: true,
        status: "awaiting_verified_webhook",
        paidThroughPreserved: true,
      });
    return reply(
      {
        error: {
          code: "not_available",
          message: "Fixture action unavailable.",
        },
      },
      503,
    );
  });
  return { calls, status };
}

test('paid usage displays remaining credits and refreshes without exposing subscription identifiers',async({page})=>{
  await fixture(page);let used=120;
  await page.route('**/api/tenants/business-a/usage',route=>route.fulfill({json:{usage:{period:'subscription:sub_private_identifier:2026-09-16',resetsAt:'2026-10-16T12:00:00.000Z',textCredits:{used,reserved:3,limit:2000}}}}));
  await page.goto('/billing?tenantId=business-a');
  const panel=page.getByRole('region',{name:'Text credit usage'});
  await expect(panel).toContainText('2,000 credits');await expect(panel).toContainText('1,877');
  await expect(panel).toContainText('Next allowance reset');await expect(panel).toContainText('including on annual plans');
  await expect(panel).not.toContainText('sub_private_identifier');
  used=130;await panel.getByRole('button',{name:'Refresh usage',exact:true}).click();
  await expect(panel).toContainText('1,867');await expect(panel).not.toContainText('1,877');
});

test('billing activity loads older notices and clears private history after failure, offline or workspace changes',async({page,context})=>{
  await fixture(page);let failed=false;
  const first='a'.repeat(32),last='b'.repeat(32);
  await page.route('**/api/agent-billing/notices?**',route=>{
    const url=new URL(route.request().url());
    if(failed)return route.fulfill({status:403,json:{error:{message:'Billing access is unavailable.'}}});
    if(url.searchParams.get('tenantId')==='business-b')return route.fulfill({json:{notices:[],nextCursor:null}});
    const older=url.searchParams.has('cursor');
    return route.fulfill({json:{notices:[{id:older?last:first,recordedAt:'2026-09-16T12:00:00Z',title:older?'Annual renewal approaching':'Subscription payment failed',message:older?'Review your subscription before renewal.':'Review your payment method.'}],nextCursor:older?null:first}});
  });
  await page.goto('/billing');const panel=page.getByRole('region',{name:'Billing activity'});
  await expect(panel.getByRole('heading',{name:'Subscription payment failed'})).toBeVisible();
  await panel.getByRole('button',{name:'Load older billing activity'}).click();
  await expect(panel.getByRole('heading',{name:'Annual renewal approaching'})).toBeVisible();
  await expect(panel.getByRole('listitem')).toHaveCount(2);
  await expect(panel.getByRole('button',{name:'Load older billing activity'})).toHaveCount(0);
  expect((await new AxeBuilder({page}).include('[aria-label="Billing activity"]').analyze()).violations).toEqual([]);
  failed=true;await panel.getByRole('button',{name:'Refresh billing activity'}).click();
  await expect(panel.getByRole('alert')).toHaveText('Billing access is unavailable.');await expect(panel.getByRole('listitem')).toHaveCount(0);
  failed=false;await panel.getByRole('button',{name:'Refresh billing activity'}).click();await expect(panel.getByRole('listitem')).toHaveCount(1);
  await context.setOffline(true);await expect(panel).toContainText('Reconnect to load billing activity.');await expect(panel.getByRole('listitem')).toHaveCount(0);
  await context.setOffline(false);await expect(panel.getByRole('listitem')).toHaveCount(1);
  await page.getByLabel('YOUR WORKSPACE').selectOption('business-b');
  await expect(panel).toContainText('No billing updates have been recorded yet.');await expect(panel.getByRole('listitem')).toHaveCount(0);
});

test('usage failures remove stale totals and malformed accounting is never displayed',async({page})=>{
  await fixture(page);let state='valid';
  await page.route('**/api/tenants/business-a/usage',route=>state==='failure'?route.fulfill({status:503,json:{error:{message:'Usage service unavailable'}}})
    :route.fulfill({json:{usage:{period:'trial',textCredits:{used:state==='valid'?5:-1,reserved:0,limit:50}}}}));
  await page.goto('/billing?tenantId=business-a');
  const panel=page.getByRole('region',{name:'Text credit usage'});
  await expect(panel).toContainText('Trial allowance');await expect(panel).toContainText('45');
  state='failure';await panel.getByRole('button',{name:'Refresh usage',exact:true}).click();
  await expect(panel.getByRole('alert')).toContainText('Usage service unavailable');await expect(panel).not.toContainText('Available credits');
  state='invalid';await panel.getByRole('button',{name:'Refresh usage',exact:true}).click();
  await expect(panel.getByRole('alert')).toContainText('not available yet');await expect(panel).not.toContainText('-1');
});

test('unverified paid allowances and offline usage do not pretend to have zero consumption',async({page,context})=>{
  await fixture(page);
  await page.route('**/api/tenants/business-a/usage',route=>route.fulfill({json:{usage:{period:'unavailable',textCredits:{used:0,reserved:0,limit:0}}}}));
  await page.goto('/billing?tenantId=business-a');
  const panel=page.getByRole('region',{name:'Text credit usage'});
  await expect(panel).toContainText('Your text allowance is unavailable');await expect(panel).not.toContainText('Completed responses');
  await context.setOffline(true);await expect(panel).toContainText('Reconnect to load current usage');
  await expect(panel.getByRole('button',{name:'Refresh usage',exact:true})).toBeDisabled();
});

test("billing returns select only verified workspaces and never infer payment from the URL", async ({
  page,
}) => {
  const { calls } = await fixture(page);
  await page.goto("/billing?tenantId=business-b&agentOrder=forged-success");
  await expect(
    page.getByRole("heading", { name: "Billing & usage." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No active paid subscription" }),
  ).toBeVisible();
  expect(
    calls
      .filter((call) => call.path.includes("agent-billing"))
      .every((call) => call.tenantId === "business-b"),
  ).toBe(true);
  await page.goto("/billing?tenantId=unknown-tenant&agentOrder=forged-success");
  await expect(
    page.getByRole("heading", { name: "No active paid subscription" }),
  ).toBeVisible();
  expect(
    calls.some(
      (call) =>
        call.tenantId === "unknown-tenant" ||
        call.path.includes("unknown-tenant"),
    ),
  ).toBe(false);
  expect(calls.some((call) => call.path.includes("/pay/"))).toBe(false);
});

test('billing findings are visible without implying full reconciliation or allowing checkout',async({page})=>{
  await fixture(page,{status:{reconciliation:{state:'needs_review',checkedAt:'2026-09-14T12:00:00Z',stale:true,issues:['Paid-through access ends before the latest paid invoice period.']}}});
  await page.route('**/api/agent-billing/status?tenantId=business-b',route=>route.fulfill({json:{commerceEnabled:false,readiness:unavailable,portalAvailable:false,subscription:null,orders:[],currency:'USD',reconciliation:null}}));
  await page.goto('/billing');
  const check=page.getByRole('region',{name:'Billing record check'});await expect(check.getByRole('heading')).toHaveText('Billing records need review');
  await expect(check.getByText('Paid-through access ends before the latest paid invoice period.')).toBeVisible();await expect(check.getByText('These findings are more than a day old.')).toBeVisible();
  await expect(check.getByText('This check covers your subscription and latest invoice.',{exact:false})).toBeVisible();
  expect((await new AxeBuilder({page}).include('[aria-label="Billing record check"]').analyze()).violations).toEqual([]);
  await page.getByLabel('YOUR WORKSPACE').selectOption('business-b');
  await expect(page.getByRole('heading',{name:'No active paid subscription'})).toBeVisible();
  await expect(check).toHaveCount(0);
});

test('billing checks distinguish current, stale, failed and malformed reports',async({page})=>{
  const {status}=await fixture(page,{status:{reconciliation:{state:'checked',checkedAt:new Date().toISOString(),stale:false,issues:[]}}});
  const check=page.getByRole('region',{name:'Billing record check'});
  await page.goto('/billing');
  await expect(check.getByRole('heading')).toHaveText('No differences found in the last billing check');
  for(const [report,title] of [
    [{state:'checked',checkedAt:'2026-09-14T12:00:00Z',stale:true,issues:[]},'Last billing check is out of date'],
    [{state:'failed',checkedAt:'2026-09-14T12:00:00Z',stale:true,issues:['The subscription status differs from the saved record.']},'Billing check could not finish'],
    [{state:'checked',checkedAt:'invalid',stale:false,issues:[]},'Billing check unavailable'],
  ] as const){
    status.reconciliation=report;await page.reload();
    await expect(check.getByRole('heading')).toHaveText(title);
    if(report.state==='failed')await expect(check).toContainText('Findings from the previous completed check:');
    await expect(page.getByRole('button',{name:'Review setup'}).first()).toBeDisabled();
  }
});

test("unavailable checkout shows separate prices, truthful status, accessible mobile layout", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/billing");
  await expect(page.getByText("Purchases are not enabled yet.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review setup" }).first(),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Review activation" }).first(),
  ).toBeDisabled();
  await expect(
    page.getByText("Plus $1,500 one-time setup", { exact: true }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Annual", exact: true }).check();
  await expect(
    page.getByText("$3,769.20", { exact: false }).first(),
  ).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      targets: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  await page.screenshot({
    path: "test-results/billing-fixture-desktop.png",
    fullPage: true,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page
        .locator(".sidebar")
        .evaluate((element) => element.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/billing-fixture-mobile.png",
    fullPage: true,
  });
});

test("setup checkout retries preserve idempotency and redirect only to verified Stripe checkout", async ({
  page,
}) => {
  await fixture(page, {
    status: { commerceEnabled: true, readiness: setupReady },
  });
  const attempts: { body: unknown; key?: string }[] = [];
  await page.route("**/api/agent-billing/checkout?*", async (route) => {
    attempts.push({
      body: route.request().postDataJSON(),
      key: route.request().headers()["x-idempotency-key"],
    });
    if (attempts.length === 1) return route.abort("failed");
    return route.fulfill({
      json: {
        orderId: "ao_fixture",
        checkoutUrl: "https://checkout.stripe.com/c/pay/fixture",
        stage: "setup",
        replay: true,
      },
    });
  });
  await page.route("https://checkout.stripe.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Explicit Stripe redirect fixture</h1>",
    }),
  );
  await page.goto("/billing");
  await expect(
    page.getByRole("button", { name: "Review setup" }).nth(1),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Review setup" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Review your setup" });
  await expect(
    dialog.getByText("$1,500 · due at checkout", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText("$349 / month", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Continue to Stripe" }).click();
  await expect(dialog.getByRole("alert")).toContainText("couldn't reach");
  await dialog.getByRole("button", { name: "Continue to Stripe" }).click();
  await expect(page).toHaveURL("https://checkout.stripe.com/c/pay/fixture");
  expect(attempts).toHaveLength(2);
  expect(attempts[0].key).toMatch(/^[0-9a-f-]{36}$/);
  expect(attempts[1].key).toBe(attempts[0].key);
  expect(attempts[0].body).toEqual({
    stage: "setup",
    planId: "business",
    interval: "monthly",
  });
});

test("activation requires the exact paid setup plan and missing plan gates fail closed", async ({
  page,
}) => {
  const { status } = await fixture(page, {
    status: {
      commerceEnabled: true,
      readiness: {
        ...unavailable,
        activation: true,
        activationPlanId: "business",
        reason: null,
      },
      orders: [paidSetup],
    },
  });
  await page.goto("/billing");
  await expect(
    page.getByRole("button", { name: "Review activation" }).first(),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Review activation" }).nth(1),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Review activation" }).nth(2),
  ).toBeDisabled();
  await page.getByRole("radio", { name: "Annual", exact: true }).check();
  await page.getByRole("button", { name: "Review activation" }).first().click();
  const dialog = page.getByRole("dialog", {
    name: "Review subscription activation",
  });
  await expect(
    dialog.getByText("$3,769.20 / year", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("$1,500 · separate payment", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Back", exact: true }).click();
  status.readiness = { setup: true, activation: true, reason: null };
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(
    page.getByRole("button", { name: "Review activation" }).first(),
  ).toBeDisabled();
});

test("untrusted checkout redirects cannot navigate or grant access", async ({
  page,
}) => {
  await fixture(page, {
    status: { commerceEnabled: true, readiness: setupReady },
  });
  await page.route("**/api/agent-billing/checkout?*", (route) =>
    route.fulfill({
      json: {
        orderId: "ao_fixture",
        checkoutUrl: "https://checkout.stripe.com.attacker.test/pay",
        stage: "setup",
      },
    }),
  );
  await page.goto("/billing");
  await page.getByRole("button", { name: "Review setup" }).first().click();
  await page.getByRole("button", { name: "Continue to Stripe" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "destination could not be verified",
  );
  await expect(page).toHaveURL(/127\.0\.0\.1:5174\/billing$/);
  await expect(
    page.getByRole("heading", { name: "No active paid subscription" }),
  ).toBeAttached();
});

test("cancellation preserves verified access until webhook confirmation, even when sales are off", async ({
  page,
}) => {
  const { calls, status } = await fixture(page, { status: { subscription } });
  await page.goto("/billing");
  await page
    .getByRole("button", { name: "Cancel at period end", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("paid period");
  await page
    .getByRole("button", { name: "Request cancellation", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Waiting for verified billing confirmation",
  );
  await expect(
    page.getByText("Subscription active · Access active", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancellation pending confirmation" }),
  ).toBeDisabled();
  expect(calls.find((call) => call.path.endsWith("/cancel"))?.key).toMatch(
    /^[0-9a-f-]{36}$/,
  );
  status.subscription = { ...subscription, cancel_at_period_end: true };
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(
    page.getByText("Cancellation is scheduled", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancellation scheduled" }),
  ).toBeDisabled();
});

test("billing role can open a verified portal; other members cannot request billing data", async ({
  page,
}) => {
  const { calls } = await fixture(page, {
    role: "manager",
    status: { subscription, portalAvailable: true },
  });
  await page.goto("/billing");
  await expect(
    page.getByRole("heading", { name: "Billing access is limited" }),
  ).toBeVisible();
  expect(calls.some((call) => call.path.includes("agent-billing"))).toBe(false);
  await page.unroute("**/api/**");
  await fixture(page, {
    role: "billing",
    status: { subscription, portalAvailable: true },
  });
  await page.route("**/api/agent-billing/portal?*", (route) =>
    route.fulfill({
      json: { url: "https://billing.stripe.com/p/session/fixture" },
    }),
  );
  await page.route("https://billing.stripe.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Explicit portal redirect fixture</h1>",
    }),
  );
  await page.goto("/billing");
  await page.getByRole("button", { name: "Manage billing in Stripe" }).click();
  await expect(page).toHaveURL("https://billing.stripe.com/p/session/fixture");
});

test("billing API failure and offline mode disable purchases without cached authority", async ({
  page,
}) => {
  await fixture(page, {
    status: { commerceEnabled: true, readiness: setupReady },
  });
  await page.goto("/billing");
  await expect(
    page.getByRole("button", { name: "Review setup" }).first(),
  ).toBeEnabled();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    dispatchEvent(new Event("offline"));
  });
  await expect(
    page.getByRole("button", { name: "Review setup" }).first(),
  ).toBeDisabled();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
    dispatchEvent(new Event("online"));
  });
  await page.route("**/api/agent-billing/status?*", (route) =>
    route.fulfill({
      status: 403,
      json: {
        error: { code: "forbidden", message: "Billing access was removed." },
      },
    }),
  );
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Billing access was removed.",
  );
  await expect(page.getByRole("button", { name: "Review setup" })).toHaveCount(
    0,
  );
});
