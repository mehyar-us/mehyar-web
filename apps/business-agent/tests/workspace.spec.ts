import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// These explicit test fixtures validate browser/API contracts, not a live integration.
const user = {
  id: "test-user",
  name: "Sam Rivera",
  email: "owner@example.test",
};
const tenant = {
  id: "business-a",
  name: "Oak & Ivy Studio",
  website: "https://example.test",
  status: "trial",
  agentName: "Mayor",
  planId: "trial",
};
const secondTenant = {
  ...tenant,
  id: "business-b",
  name: "Northside Workshop",
};
const capabilities = {
  providers: {
    google: {
      configured: true,
      capabilities: [
        { id: "gmail_read", label: "Read business email", enabled: true },
        {
          id: "gmail_send",
          label: "Send business email",
          enabled: false,
          reason: "Awaiting provider approval",
        },
        {
          id: "calendar_read",
          label: "Check calendar availability",
          enabled: true,
        },
      ],
    },
    microsoft: {
      configured: true,
      capabilities: [
        { id: "mail_read", label: "Read business email", enabled: true },
      ],
    },
  },
};
type Fixtures = { signedIn?: boolean; empty?: boolean; unavailable?: boolean };
const briefFixture=()=>({brief:{revision:0,fields:Object.fromEntries('businessName category industryPack services prices currency hours locations serviceArea contactRoutes bookingSystem publicPolicies brandLanguage existingTools requestOwner serviceDuration staffResources cancellationRules escalationDestination tone permittedAutonomy'.split(' ').map(key=>[key,'']))},identityVerified:false,authorizesActions:false,industryOptions:[{id:'barbershops-salons',name:'Barbers and salons'},{id:'clinics-dentists',name:'Clinics and dentists'}],
  unresolvedQuestions:[{field:'requestOwner',question:'Who should own incoming requests?'}],recommendations:['Draft responses','Check availability','Follow up on inquiries'].map((name,i)=>({id:`fixture-${i}`,name,proposed:true,executionEnabled:false,prerequisites:['mailbox_connected'],example:'Prepare work for your review.',expectedImprovement:'Reduce repeated work.',plan:{name:'Business Agent',monthlyCents:34900,setupCents:150000},addon:null}))});
async function fixture(page: Page, options: Fixtures = {}) {
  let paused = false;
  const memories: { id: string; key: string; value: string; source: string }[] =
    [];
  const messages: {
    id: string;
    role: string;
    content: string;
    createdAt: string;
  }[] = [];
  const payloads: {
    path: string;
    method: string;
    body: unknown;
    key?: string;
  }[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const body = method === "POST" ? request.postDataJSON() : null;
    payloads.push({
      path,
      method,
      body,
      key: request.headers()["x-idempotency-key"],
    });
    const reply = (data: unknown, status = 200) =>
      route.fulfill({ json: data, status });
    if (path === "/api/session")
      return reply({ user: options.signedIn === false ? null : user });
    if (path === "/api/auth/capabilities")
      return reply(
        options.unavailable
          ? {
              providers: {
                google: { configured: false, capabilities: [] },
                microsoft: { configured: false, capabilities: [] },
              },
            }
          : capabilities,
      );
    if (path === "/api/catalog")
      return reply({
        version: "test-contract",
        brand: "Mayor AI",
        currency: "USD",
        commerceEnabled: false,
        plans: [],
        addons: [],
      });
    if (path === "/api/agent-billing/status")
      return reply({
        commerceEnabled: false,
        readiness: { setup: false, activation: false, reason: null },
        subscription: null,
        orders: [],
        currency: "USD",
      });
    if (path === "/api/auth/grants") return reply({ grants: [] });
    if (path === "/api/invitations") return reply({invitations:[],more:false});
    if(path.endsWith('/business-brief'))return reply(briefFixture());
    if (path === "/api/auth/sign-out") return reply({ ok: true });
    if (path === "/api/tenants" && method === "POST")
      return reply({ tenant: { ...tenant, ...body } });
    if (path === "/api/tenants")
      return reply({ tenants: options.empty ? [] : [tenant, secondTenant] });
    if (path.endsWith("/pause")) {
      paused = body.paused;
      return reply({ ok: true });
    }
    if (path.endsWith("/memory") && method === "POST") {
      memories.push({ id: "memory-1", ...body, source: "owner" });
      return reply({ memory: memories[0] });
    }
    if (path.endsWith("/memory/memory-1") && method === "DELETE") {
      memories.splice(0);
      return reply({ ok: true });
    }
    if (path.endsWith("/messages") && method === "POST") {
      const message = {
        id: `message-${messages.length}`,
        role: "user",
        content: body.content,
        createdAt: "2026-09-16T14:00:00Z",
      };
      messages.push(message);
      return reply({ message });
    }
    if (path.endsWith("/messages"))
      return reply({ messages: path.includes("business-b") ? [] : messages });
    if(path.endsWith('/usage'))return route.fulfill({json:{usage:{period:'trial',textCredits:{used:0,reserved:0,limit:50}}}});
    if(path.endsWith('/research'))return reply({jobs:[],nextOffset:null});
    if (path.startsWith("/api/tenants/"))
      return reply({
        tenant: {
          ...(path.endsWith("business-b") ? secondTenant : tenant),
          status: paused ? "paused" : "trial",
          paused,
        },
        membership: { role: "owner" },
        activity: [],
        memory: path.endsWith("business-b") ? [] : memories,
        connections: [],
        usage: {},
      });
    return reply(
      {
        error: {
          code: "not_available",
          message: "This connection is not available yet.",
        },
      },
      503,
    );
  });
  return payloads;
}

test("unconfigured providers never offer a fake sign-in", async ({ page }) => {
  await fixture(page, { signedIn: false, unavailable: true });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Sign-in is awaiting configuration.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your next great hire is always here." }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/sign-in-desktop.png",
    fullPage: true,
  });
});

test("Google requests only selected enabled capabilities", async ({ page }) => {
  const payloads = await fixture(page, { signedIn: false });
  await page.goto("/");
  await expect(
    page.getByLabel("Send business email", { exact: false }),
  ).toBeDisabled();
  await page.getByLabel("Read business email", { exact: true }).check();
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "This connection is not available yet.",
  );
  expect(
    payloads.find((request) => request.path === "/api/auth/start/google")?.body,
  ).toEqual({ capabilities: ["gmail_read"] });
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeEnabled();
});

test("knowledge creation/deletion and workspace switching use tenant routes", async ({
  page,
}) => {
  const payloads = await fixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Knowledge", exact: true }).click();
  await page.getByLabel("What is this about?").fill("Opening hours");
  await page
    .getByLabel("The detail to remember")
    .fill("Monday–Friday, 9 AM–5 PM Eastern.");
  await page.getByRole("button", { name: "Save knowledge" }).click();
  await expect(
    page.getByText("Monday–Friday, 9 AM–5 PM Eastern.", { exact: true }),
  ).toBeVisible();
  expect(
    payloads.find(
      (request) => request.path === "/api/tenants/business-a/memory",
    )?.body,
  ).toEqual({
    key: "Opening hours",
    value: "Monday–Friday, 9 AM–5 PM Eastern.",
  });
  await page.getByLabel("What is this about?").fill("Unsaved private detail");
  await page.getByLabel("YOUR WORKSPACE").selectOption("business-b");
  await expect(page.getByLabel("What is this about?")).toHaveValue("");
  await expect(
    page.getByText("Monday–Friday, 9 AM–5 PM Eastern.", { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("YOUR WORKSPACE").selectOption("business-a");
  await page.getByRole("button", { name: "Delete Opening hours" }).click();
  await page
    .getByRole("button", { name: "Remove detail", exact: true })
    .click();
  await expect(
    page.getByText("A fresh start for your knowledge"),
  ).toBeVisible();
});

test("message retries retain idempotency and offline drafts never auto-send", async ({
  page,
  context,
}) => {
  await fixture(page);
  let attempts = 0;
  const keys: string[] = [];
  await page.route("**/api/tenants/business-a/messages", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    keys.push(route.request().headers()["x-idempotency-key"]);
    attempts++;
    if (attempts === 1)
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: "temporarily_unavailable",
            message: "Try again shortly.",
          },
        },
      });
    return route.fallback();
  });
  await page.goto("/");
  await page
    .getByLabel("Message your assistant")
    .fill("Help with appointment policies.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Try again shortly.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByText("Help with appointment policies.", { exact: true }),
  ).toBeVisible();
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  await context.setOffline(true);
  await page
    .getByLabel("Message your assistant")
    .fill("Keep this as my offline draft.");
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeDisabled();
  await context.setOffline(false);
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeEnabled();
  expect(attempts).toBe(2);
});

test("pause waits for backend confirmation and billing never invents a charge", async ({
  page,
}) => {
  const payloads = await fixture(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Pause assistant", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume assistant", exact: true }),
  ).toBeVisible();
  expect(
    payloads.find((request) => request.path.endsWith("/pause"))?.body,
  ).toEqual({ paused: true });
  await page
    .getByRole("button", { name: "Billing & usage", exact: true })
    .click();
  await expect(
    page.getByText("Subscription checkout is not activated.", { exact: false }),
  ).toBeVisible();
  expect(payloads.some((request) => request.path.includes("/pay/"))).toBe(
    false,
  );
});

test("mobile navigation and conversation fit the screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Big plans. Let's make room for them." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Connections.", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/connections-mobile.png",
    fullPage: true,
  });
});

test("conversation has no WCAG A/AA accessibility violations", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Big plans. Let's make room for them." }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/conversation-desktop.png",
    fullPage: true,
  });
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((violation) => ({
      id: violation.id,
      targets: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
});

test("sign-in has no WCAG A/AA accessibility violations", async ({ page }) => {
  await fixture(page, { signedIn: false });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((violation) => ({
      id: violation.id,
      targets: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
});

test("authorization attaches only after workspace confirmation and can be locally revoked", async ({
  page,
}) => {
  await fixture(page);
  const grant = {
    id: "grant-1",
    provider: "google",
    tenantId: null as string | null,
    grantedScopes: [],
    selectedCapabilities: ["gmail_read"],
    grantedCapabilities: ["gmail_read"],
    status: "authorized",
  };
  const grants = [grant];
  const calls: { path: string; body: unknown }[] = [];
  await page.route("**/api/auth/grants**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      calls.push({ path, body });
      if (path.endsWith("attach"))
        grants.push({ ...grant, id: "attached-1", tenantId: body.tenantId });
      if (path.endsWith("revoke")) {
        grants[1].status = "revoked";
        grants[1].grantedCapabilities = [];
      }
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { grants } });
  });
  await page.goto("/?connected=google");
  await page.getByRole("button", { name: "Use for this business" }).click();
  expect(calls).toHaveLength(0);
  await page
    .getByRole("button", { name: "Confirm business connection" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your account authorizations" }),
  ).toBeVisible();
  expect(calls[0]).toEqual({
    path: "/api/auth/grants/attach",
    body: { grantId: "grant-1", tenantId: "business-a" },
  });
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page
    .getByRole("button", { name: "Disconnect authorization", exact: true })
    .click();
  await expect(page.getByText("revoked", { exact: true })).toBeVisible();
  expect(calls[1]).toEqual({
    path: "/api/auth/grants/revoke",
    body: { grantId: "attached-1", tenantId: "business-a" },
  });
  await expect(
    page.getByRole("button", { name: "Disconnect", exact: true }),
  ).toHaveCount(0);
});

test("cancelled provider authorization is visible and does not create a fake session", async ({
  page,
}) => {
  await fixture(page, { signedIn: false });
  await page.goto("/?auth_error=1");
  await expect(page.getByRole("alert")).toContainText(
    "Authorization was not completed.",
  );
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  await expect(page).toHaveURL("http://127.0.0.1:5174/");
});

test("workspace creation retries keep the same idempotency key", async ({
  page,
}) => {
  await fixture(page, { empty: true });
  const keys: string[] = [];
  await page.route("**/api/tenants", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    keys.push(route.request().headers()["x-idempotency-key"]);
    return route.fulfill({
      status: 503,
      json: {
        error: {
          code: "temporarily_unavailable",
          message: "Please retry workspace creation.",
        },
      },
    });
  });
  await page.goto("/");
  await page
    .getByLabel("Business name", { exact: true })
    .fill("Oak & Ivy Studio");
  await page
    .getByLabel("What would you like help with?")
    .fill("Organize customer inquiries.");
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Please retry workspace creation.",
  );
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  await page
    .getByLabel("Business name", { exact: true })
    .fill("A different business");
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await expect.poll(() => keys.length).toBe(3);
  expect(keys[2]).not.toBe(keys[1]);
});

test('assistant rename preserves uncertain retry and refreshes the conversation identity',async({page})=>{
  await fixture(page);let name='Mayor';const attempts:{body:any;key:string|undefined}[]=[];
  await page.route('**/api/tenants/business-a',route=>route.fulfill({json:{tenant:{...tenant,agentName:name},membership:{role:'owner'},activity:[],memory:[],connections:[],usage:{}}}));
  await page.route('**/api/tenants/business-a/agent-name',route=>{
    attempts.push({body:route.request().postDataJSON(),key:route.request().headers()['x-idempotency-key']});
    if(attempts.length===1)return route.fulfill({status:503,json:{error:{message:'Unconfirmed name change'}}});
    name=attempts[0].body.agentName;return route.fulfill({json:{agentName:name}});
  });
  await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).click();
  const form=page.getByRole('form',{name:'Assistant name settings'});await form.getByLabel('Assistant display name').fill('Maya');await form.getByRole('button',{name:'Save assistant name'}).click();
  await expect(form.getByRole('alert')).toContainText('Unconfirmed name change');await expect(form.getByLabel('Assistant display name')).toBeDisabled();
  await form.getByRole('button',{name:'Retry same name change'}).click();await expect(form.getByRole('status')).toHaveText('Assistant name saved.');
  expect(attempts[0]).toEqual(attempts[1]);expect(attempts[0].body).toEqual({expectedName:'Mayor',agentName:'Maya'});
  expect((await new AxeBuilder({page}).include('[aria-label="Assistant name settings"]').analyze()).violations).toEqual([]);
  await page.getByRole('button',{name:'Conversation',exact:true}).click();await expect(page.getByText("I'm Maya, your business assistant.",{exact:false})).toBeVisible();
});

for(const changed of [false,true])test(`industry suggestion ${changed?'blocks a changed pack':'copies a reviewed industry answer'}`,async({page})=>{
  const requests=await fixture(page),data={...briefFixture(),brief:{...briefFixture().brief,fields:{...briefFixture().brief.fields,industryPack:changed?'clinics-dentists':'barbershops-salons'}},industryQuestions:changed?[]:[{field:'deposits',question:'What deposit rules should be explained?',answer:'',answered:false,fromBrief:false}]};
  await page.route('**/api/tenants/business-a/business-brief',route=>route.fulfill({json:data}));
  await page.route('**/api/tenants/business-a/messages',route=>route.fulfill({json:{messages:[{id:'reply',role:'assistant',content:'Review your deposit policy.',briefSuggestions:[{field:'industryAnswers.deposits',value:'No deposits',sourceMessageId:'owner-message',industryPack:'barbershops-salons'}]}]}}));
  await page.goto('/');await page.getByRole('button',{name:'Review suggested industry setup'}).click();
  const candidate=page.getByRole('region',{name:'Conversation brief draft'});
  if(changed){await expect(candidate.getByRole('alert')).toContainText('Your industry selection changed');await expect(candidate.getByRole('button',{name:'Copy to draft'})).toBeDisabled();}
  else{await expect(candidate.getByLabel('Business detail to update')).toHaveValue('industryAnswers.deposits');await candidate.getByRole('button',{name:'Copy to draft'}).click();await expect(page.getByLabel('What deposit rules should be explained?')).toHaveValue('No deposits');}
  expect(requests.some(r=>r.path.endsWith('/business-brief')&&r.method==='POST')).toBe(false);
});

test('grounded assistant suggestion opens the correct editable field without saving it',async({page})=>{
  const requests=await fixture(page);
  await page.route('**/api/tenants/business-a/messages',route=>route.fulfill({json:{messages:[{id:'reply',role:'assistant',content:'Review your hours.',briefSuggestions:[{field:'hours',value:'9 AM to 5 PM',sourceMessageId:'owner-message'}]}]}}));
  await page.goto('/');await page.getByRole('button',{name:'Review suggested business hours'}).click();
  const candidate=page.getByRole('region',{name:'Conversation brief draft'});
  await expect(candidate.getByLabel('Business detail to update')).toHaveValue('hours');await expect(candidate.getByLabel('Proposed wording')).toHaveValue('9 AM to 5 PM');
  await candidate.getByRole('button',{name:'Copy to draft'}).click();
  const panel=page.getByRole('region',{name:'Business brief'});await expect(panel.getByLabel('Business hours')).toHaveValue('9 AM to 5 PM');
  await expect(panel.getByRole('button',{name:'Save reviewed brief'})).toBeDisabled();expect(requests.some(r=>r.path.endsWith('/business-brief')&&r.method==='POST')).toBe(false);
});

test('owner conversation wording becomes a reviewed brief edit without an automatic write',async({page})=>{
  await fixture(page);let data=briefFixture();data.brief.fields.services='Existing services';const writes:any[]=[];
  await page.route('**/api/tenants/business-a/business-brief',route=>{
    if(route.request().method()==='POST'){const body=route.request().postDataJSON();writes.push(body);data={...data,brief:{revision:1,fields:body.fields}};return route.fulfill({json:{brief:data.brief}});}
    return route.fulfill({json:data});
  });
  await page.route('**/api/tenants/business-a/messages',route=>route.fulfill({json:{messages:[{id:'mine',role:'user',content:'Haircuts and beard trims',createdAt:'2026-09-16T12:00:00Z'},{id:'model',role:'assistant',content:'Unconfirmed model suggestion',createdAt:'2026-09-16T12:01:00Z'}]}}));
  await page.goto('/');await expect(page.getByRole('button',{name:'Use in business brief'})).toHaveCount(1);
  await page.getByRole('button',{name:'Use in business brief'}).click();
  const panel=page.getByRole('region',{name:'Business brief'}),candidate=page.getByRole('region',{name:'Conversation brief draft'});
  await expect(candidate.getByText('Current draft value: Existing services')).toBeVisible();
  expect((await new AxeBuilder({page}).include('[aria-label="Conversation brief draft"]').analyze()).violations).toEqual([]);
  await candidate.getByLabel('Proposed wording').fill('Haircuts, beard trims and styling');expect(writes).toHaveLength(0);
  await candidate.getByRole('button',{name:'Replace this draft value'}).click();
  await expect(panel.getByLabel('Services and products')).toHaveValue('Haircuts, beard trims and styling');expect(writes).toHaveLength(0);
  await expect(panel.getByRole('button',{name:'Save reviewed brief'})).toBeDisabled();
  await panel.getByLabel('I reviewed these business details.').check();await panel.getByRole('button',{name:'Save reviewed brief'}).click();
  await expect(panel.getByRole('status')).toContainText('Business brief saved');expect(writes).toHaveLength(1);expect(writes[0].fields.services).toBe('Haircuts, beard trims and styling');
  await page.getByRole('button',{name:'Conversation',exact:true}).click();await page.getByRole('button',{name:'Use in business brief'}).click();
  await expect(candidate).toBeVisible();await page.getByLabel('YOUR WORKSPACE').selectOption('business-b');
  await expect(candidate).toHaveCount(0);await page.getByLabel('YOUR WORKSPACE').selectOption('business-a');await expect(candidate).toHaveCount(0);
});

test('industry setup saves reviewed gaps and moves answered questions out of the remaining list',async({page})=>{
  await fixture(page);let answered=false;const requests:any[]=[];
  await page.route('**/api/tenants/business-a/business-brief',route=>{
    const data={...briefFixture(),brief:{revision:answered?1:0,fields:{...briefFixture().brief.fields,industryPack:'barbershops-salons'},industryAnswers:answered?{deposits:'No deposit required'}:{}},industryQuestions:[{field:'deposits',question:'What deposit rules should be explained?',answer:answered?'No deposit required':'',answered,fromBrief:false}]};
    if(route.request().method()==='POST'){requests.push(route.request().postDataJSON());answered=true;return route.fulfill({json:{brief:{...data.brief,revision:1,industryAnswers:{deposits:'No deposit required'}}}});}
    return route.fulfill({json:data});
  });
  await page.goto('/');await page.getByRole('button',{name:'Knowledge',exact:true}).click();const panel=page.getByRole('region',{name:'Business brief'});
  await expect(panel.getByRole('heading',{name:'Remaining industry setup'})).toBeVisible();
  await panel.getByLabel('What deposit rules should be explained?').fill('No deposit required');await panel.getByLabel('I reviewed these business details.').check();await panel.getByRole('button',{name:'Save reviewed brief'}).click();
  await expect(panel.getByRole('heading',{name:'Remaining industry setup'})).toHaveCount(0);
  await panel.getByText('Saved industry answers',{exact:true}).click();await expect(panel.getByLabel('What deposit rules should be explained?')).toHaveValue('No deposit required');
  expect(requests[0].industryAnswers).toEqual({deposits:'No deposit required'});
});

test('saved brief sources survive refresh and manual edits stop claiming that source',async({page})=>{
  await fixture(page);const source={id:'saved-source',field:'businessName',value:'Sourced name',sourceUrl:'https://salon.example.com/',retrievedAt:'2026-09-16T12:00:00Z',confirmedAt:'2026-09-16T13:00:00Z',confidence:'high'};
  let data={...briefFixture(),sources:[source],brief:{...briefFixture().brief,sources:{} as Record<string,typeof source>}};const bodies:any[]=[];
  await page.route('**/api/tenants/business-a/business-brief',route=>{
    if(route.request().method()==='POST'){const body=route.request().postDataJSON();bodies.push(body);data={...data,brief:{revision:body.expectedRevision+1,fields:body.fields,sources:body.sourceIds.businessName?{businessName:source}:{}}};return route.fulfill({json:{brief:data.brief}});}
    return route.fulfill({json:data});
  });
  await page.goto('/');await page.getByRole('button',{name:'Knowledge',exact:true}).click();const panel=page.getByRole('region',{name:'Business brief'});
  await panel.getByText('Confirmed research suggestions (1)',{exact:true}).click();await panel.getByRole('button',{name:'Copy into empty field'}).click();
  await panel.getByLabel('I reviewed these business details.').check();await panel.getByRole('button',{name:'Save reviewed brief'}).click();
  await expect(panel.getByRole('link',{name:'Saved source for business name'})).toHaveAttribute('href',source.sourceUrl);
  expect(bodies[0].sourceIds).toEqual({businessName:source.id});expect(bodies[0]).not.toHaveProperty('sources');
  await panel.getByLabel('Business name',{exact:true}).fill('Owner revised name');await expect(panel.getByRole('link',{name:'Saved source for business name'})).toHaveCount(0);
  await panel.getByLabel('I reviewed these business details.').check();await panel.getByRole('button',{name:'Save reviewed brief'}).click();
  await expect.poll(()=>bodies.length).toBe(2);expect(bodies[1].sourceIds).toEqual({});
});

test('confirmed research fills only empty brief drafts and requires a separate save',async({page})=>{
  await fixture(page);let writes=0;
  const data={...briefFixture(),sources:[{id:'source-name',field:'businessName',value:'Owner confirmed salon',sourceUrl:'https://salon.example.com/',retrievedAt:'2026-09-16T12:00:00Z',confirmedAt:'2026-09-16T13:00:00Z',confidence:'high'}]};
  await page.route('**/api/tenants/business-a/business-brief',route=>{if(route.request().method()==='POST')writes++;return route.fulfill({json:data});});
  await page.goto('/');await page.getByRole('button',{name:'Knowledge',exact:true}).click();const panel=page.getByRole('region',{name:'Business brief'});
  await panel.getByText('Confirmed research suggestions (1)',{exact:true}).click();
  await expect(panel.getByRole('link',{name:'View confirmed source'})).toHaveAttribute('href','https://salon.example.com/');
  await panel.getByRole('button',{name:'Copy into empty field'}).click();
  await expect(panel.getByLabel('Business name',{exact:true})).toHaveValue('Owner confirmed salon');
  await expect(panel.getByRole('button',{name:'Copy into empty field'})).toBeDisabled();
  await expect(panel.getByRole('button',{name:'Save reviewed brief'})).toBeDisabled();expect(writes).toBe(0);
  await panel.getByLabel('Business name',{exact:true}).fill('My existing name');
  await expect(panel.getByRole('button',{name:'Copy into empty field'})).toBeDisabled();
  await panel.getByRole('button',{name:'Reload saved brief'}).click();
  await expect(panel.getByLabel('Business name',{exact:true})).toHaveValue('');expect(writes).toBe(0);
});

test('business brief requires review, preserves retries and displays proposed plan pricing',async({page})=>{
  await fixture(page);let data=briefFixture();const requests:{body:any;key:string|undefined}[]=[];
  await page.route('**/api/tenants/business-a/business-brief',route=>{
    if(route.request().method()==='POST'){
      const body=route.request().postDataJSON();requests.push({body,key:route.request().headers()['x-idempotency-key']});
      if(requests.length===1)return route.fulfill({status:503,json:{error:{message:'Unconfirmed save'}}});
      data={...data,brief:{revision:1,fields:body.fields},unresolvedQuestions:[]};return route.fulfill({json:{brief:data.brief}});
    }
    return route.fulfill({json:data});
  });
  await page.goto('/');await page.getByRole('button',{name:'Knowledge',exact:true}).click();
  const panel=page.getByRole('region',{name:'Business brief'});
  await panel.getByLabel('Business name',{exact:true}).fill('Oak & Ivy');
  await panel.getByLabel('Owner of incoming requests').fill('Sam');
  await panel.getByText('Business details and operating preferences',{exact:true}).click();
  await panel.getByLabel('Industry workflow pack').selectOption('barbershops-salons');
  await expect(panel.getByRole('button',{name:'Save reviewed brief'})).toBeDisabled();
  await panel.getByLabel('I reviewed these business details.').check();await panel.getByRole('button',{name:'Save reviewed brief'}).click();
  await expect(panel.getByRole('alert')).toHaveText('Unconfirmed save');
  await expect(panel.getByLabel('Business name',{exact:true})).toBeDisabled();
  await panel.getByRole('button',{name:'Retry same brief update'}).click();
  await expect(panel.getByRole('status')).toContainText('Business brief saved');
  expect(requests).toHaveLength(2);expect(requests[0]).toEqual(requests[1]);expect(requests[0].key).toBeTruthy();
  expect(requests[0].body.fields.industryPack).toBe('barbershops-salons');
  await expect(panel.getByText('Who should own incoming requests?')).toHaveCount(0);
  await expect(panel.getByText('Business Agent: $349.00/month plus $1,500.00 setup.',{exact:true})).toHaveCount(3);
  await page.setViewportSize({width:390,height:844});
  expect((await new AxeBuilder({page}).include('[aria-label="Business brief"]').analyze()).violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await panel.screenshot({path:'test-results/business-brief-mobile.png',animations:'disabled'});
});

test('brief revision conflicts require refresh and managers cannot save',async({page})=>{
  await fixture(page);let data=briefFixture();
  await page.route('**/api/tenants/business-a/business-brief',route=>{
    if(route.request().method()==='POST'){data={...data,brief:{revision:2,fields:{...data.brief.fields,businessName:'Another owner edit'}}};return route.fulfill({status:409,json:{error:{code:'brief_revision_conflict',message:'The business brief changed. Refresh it before saving your edits.'}}});}
    return route.fulfill({json:data});
  });
  await page.goto('/');await page.getByRole('button',{name:'Knowledge',exact:true}).click();
  const panel=page.getByRole('region',{name:'Business brief'});
  await panel.getByLabel('Business name',{exact:true}).fill('My edit');await panel.getByLabel('I reviewed these business details.').check();await panel.getByRole('button',{name:'Save reviewed brief'}).click();
  await expect(panel.getByRole('alert')).toContainText('Refresh');await expect(panel.getByLabel('Business name',{exact:true})).toHaveValue('My edit');
  await panel.getByRole('button',{name:'Reload saved brief'}).click();await expect(panel.getByLabel('Business name',{exact:true})).toHaveValue('Another owner edit');
  await page.route('**/api/tenants/business-a',route=>route.fulfill({json:{tenant,membership:{role:'manager'},activity:[],connections:[],usage:{},memory:[]}}));
  await page.reload();await page.getByRole('button',{name:'Knowledge',exact:true}).click();
  await expect(panel.getByLabel('Business name',{exact:true})).toBeDisabled();await expect(panel.getByRole('button',{name:'Save reviewed brief'})).toHaveCount(0);
});

test('website research retries preserve the request and open the accepted job',async({page})=>{
  await fixture(page);const requests:{key:string|undefined;body:unknown}[]=[];
  const job={id:'new-research',website:'https://salon.example.com/',status:'reserved',pageLimit:20,evidencePages:0,usedPages:0,reservedPages:20};
  await page.route('**/api/tenants/business-a/research**',route=>{
    if(route.request().method()==='POST'){
      requests.push({key:route.request().headers()['x-idempotency-key'],body:route.request().postDataJSON()});
      return route.fulfill(requests.length===1?{status:503,json:{error:{message:'Response lost'}}}:{status:202,json:{job}});
    }
    return route.fulfill({json:new URL(route.request().url()).pathname.endsWith('/new-research')?{job,pages:[],nextOffset:null}:{jobs:[],nextOffset:null}});
  });
  await page.goto('/');await page.getByRole('button',{name:'Knowledge',exact:true}).click();
  const panel=page.getByRole('region',{name:'Website research'});
  await panel.getByLabel('Website to research').fill(job.website);
  await panel.getByRole('button',{name:'Request website research',exact:true}).click();
  await expect(panel.getByRole('alert')).toContainText('Response lost');
  await expect(panel.getByLabel('Website to research')).toBeDisabled();
  await panel.getByRole('button',{name:'Retry same research request'}).click();
  await expect(panel.getByText('Queued',{exact:true})).toBeVisible();
  expect(requests).toHaveLength(2);expect(requests[0]).toEqual(requests[1]);
  expect(requests[0].key).toMatch(/^[a-zA-Z0-9_-]{16,128}$/);
  expect(requests[0].body).toEqual({url:job.website,pages:20,depth:2});
});

test('research readiness rejection keeps manual fallback and permits a corrected website',async({page})=>{
  await fixture(page);
  await page.route('**/api/tenants/business-a/research**',route=>route.fulfill(route.request().method()==='POST'?{status:503,json:{error:{code:'research_disabled',message:'Website research is not enabled yet. You can add business knowledge manually.'}}}:{json:{jobs:[],nextOffset:null}}));
  await page.goto('/');await page.getByRole('button',{name:'Knowledge',exact:true}).click();
  const panel=page.getByRole('region',{name:'Website research'});
  await panel.getByLabel('Website to research').fill('https://salon.example.com/');
  await panel.getByRole('button',{name:'Request website research',exact:true}).click();
  await expect(panel.getByRole('alert')).toContainText('not enabled yet');
  await expect(panel.getByLabel('Website to research')).toBeEnabled();
  await expect(panel.getByText('No website research is available yet.',{exact:false})).toBeVisible();
  expect((await new AxeBuilder({page}).include('.research-panel').analyze()).violations).toEqual([]);
});

test('research displays unverified sources as text and clears failed refreshes', async ({page})=>{
  await page.setViewportSize({width:390,height:844});
  await fixture(page);
  const job={id:'research-one',website:'https://salon.example.com/',status:'completed',pageLimit:20,evidencePages:1,usedPages:1,reservedPages:0};
  let failed=false;
  await page.route('**/api/tenants/business-a/research**',route=>{
    if(failed)return route.fulfill({status:503,json:{error:{message:'Research unavailable'}}});
    const detail=new URL(route.request().url()).pathname.endsWith('/research-one');
    return route.fulfill({json:detail?{job,pages:[{url:job.website,retrievedAt:'2026-09-16T12:00:00Z',warnings:[],evidence:[{field:'business_name',value:'<script>window.injected=true</script>',sourceUrl:job.website,retrievedAt:'2026-09-16T12:00:00Z',confidence:'high',selector:'title'}]}],nextOffset:null}:{jobs:[job],nextOffset:null}});
  });
  await page.goto('/');await page.getByRole('button',{name:'Open navigation'}).click();await page.getByRole('button',{name:'Knowledge',exact:true}).click();
  const panel=page.getByRole('region',{name:'Website research'});
  await panel.getByRole('button',{name:'View source evidence'}).click();
  await expect(panel.getByText('<script>window.injected=true</script>',{exact:true})).toBeVisible();
  await expect(panel.getByText('Unverified website claim',{exact:false})).toBeVisible();
  await expect(panel.getByRole('link',{name:'Claim source'})).toHaveAttribute('href',job.website);
  expect(await page.evaluate(()=>('injected' in window))).toBe(false);
  expect((await new AxeBuilder({page}).include('.research-panel').analyze()).violations).toEqual([]);
  await panel.scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await panel.screenshot({path:'test-results/research-panel.png',animations:'disabled'});
  failed=true;await panel.getByRole('button',{name:'Refresh research'}).click();
  await expect(panel.getByRole('alert')).toHaveText('Research unavailable');
  await expect(panel.getByText('<script>window.injected=true</script>',{exact:true})).toHaveCount(0);
});

test('research offers manual fallback and rejects unsafe result links',async({page})=>{
  await fixture(page);await page.goto('/');await page.getByRole('button',{name:'Knowledge',exact:true}).click();
  const panel=page.getByRole('region',{name:'Website research'});
  await expect(panel.getByText('No website research is available yet.',{exact:false})).toBeVisible();
  await page.route('**/api/tenants/business-a/research**',route=>route.fulfill({json:{jobs:[{id:'bad',website:'javascript:alert(1)',status:'completed',pageLimit:20,evidencePages:0,usedPages:0,reservedPages:0}],nextOffset:null}}));
  await panel.getByRole('button',{name:'Refresh research'}).click();
  await expect(panel.getByRole('alert')).toContainText('unexpected response');
  await expect(panel.locator('a')).toHaveCount(0);
});

test('owner confirmation requires review, preserves uncertain retries and refreshes knowledge',async({page})=>{
  await fixture(page);
  const job={id:'research-confirm',website:'https://salon.example.com/',status:'completed',pageLimit:20,evidencePages:1,usedPages:1,reservedPages:0};
  const bodies:unknown[]=[];let saved=false;
  await page.route('**/api/tenants/business-a',route=>route.fulfill({json:{tenant,membership:{role:'owner'},activity:[],connections:[],usage:{},memory:saved?[{id:'confirmed-memory',key:'Business name',value:'Oak Salon',source:'owner_confirmed_website'}]:[]}}));
  await page.route('**/api/tenants/business-a/research**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/confirm')){bodies.push(route.request().postDataJSON());if(bodies.length===1)return route.abort('failed');saved=true;return route.fulfill({json:{confirmed:true,removed:false,memory:{key:'Business name',value:'Oak Salon'}}});}
    return route.fulfill({json:path.endsWith('/research-confirm')?{job,pages:[{url:job.website,retrievedAt:'2026-09-16T12:00:00Z',warnings:[],evidence:[{field:'business_name',value:'Oak Salon',sourceUrl:job.website,retrievedAt:'2026-09-16T12:00:00Z',confidence:'high',selector:'title'}]}],nextOffset:null}:{jobs:[job],nextOffset:null}});
  });
  await page.goto('/');await page.getByRole('button',{name:'Knowledge',exact:true}).click();
  const panel=page.getByRole('region',{name:'Website research'});
  await panel.getByRole('button',{name:'View source evidence'}).click();
  await panel.getByRole('button',{name:'Review for business knowledge'}).click();
  await expect(panel.getByRole('button',{name:'Confirm and save fact'})).toBeDisabled();
  await panel.getByLabel('Knowledge topic').fill('Business name');
  await panel.getByRole('checkbox').check();
  expect((await new AxeBuilder({page}).include('.research-panel').analyze()).violations).toEqual([]);
  await panel.screenshot({path:'test-results/research-confirmation.png',animations:'disabled'});
  await panel.getByRole('button',{name:'Confirm and save fact'}).click();
  await expect(panel.getByRole('alert')).toBeVisible();await expect(panel.getByLabel('Knowledge topic')).toBeDisabled();
  await panel.getByRole('button',{name:'Retry same confirmation'}).click();
  await expect(panel.getByRole('status')).toHaveText('Saved to business knowledge with its source.');
  expect(bodies).toEqual([{url:job.website,index:0,key:'Business name',expectedValue:'Oak Salon'},{url:job.website,index:0,key:'Business name',expectedValue:'Oak Salon'}]);
  await expect(page.getByText('Website claim confirmed by owner',{exact:false})).toBeVisible();
  await expect(page.locator('.memory-list').getByText('Oak Salon',{exact:true})).toBeVisible();
});

test('managers can review sources but cannot confirm website claims',async({page})=>{
  await fixture(page);
  await page.route('**/api/tenants/business-a',route=>route.fulfill({json:{tenant,membership:{role:'manager'},activity:[],connections:[],usage:{},memory:[]}}));
  const job={id:'research-manager',website:'https://salon.example.com/',status:'completed',pageLimit:20,evidencePages:1,usedPages:1,reservedPages:0};
  await page.route('**/api/tenants/business-a/research**',route=>route.fulfill({json:new URL(route.request().url()).pathname.endsWith('/research-manager')?{job,pages:[{url:job.website,retrievedAt:'2026-09-16T12:00:00Z',warnings:[],evidence:[{field:'business_name',value:'Owner review required',sourceUrl:job.website,retrievedAt:'2026-09-16T12:00:00Z',confidence:'high',selector:'title'}]}],nextOffset:null}:{jobs:[job],nextOffset:null}}));
  await page.goto('/');await page.getByRole('button',{name:'Knowledge',exact:true}).click();
  const panel=page.getByRole('region',{name:'Website research'});await panel.getByRole('button',{name:'View source evidence'}).click();
  await expect(panel.getByText('Owner review required',{exact:true})).toBeVisible();
  await expect(panel.getByRole('button',{name:'Review for business knowledge'})).toHaveCount(0);
});

test('research cancellation stays available while paused and does not claim provider completion',async({page})=>{
  await fixture(page);
  await page.route('**/api/tenants/business-a',route=>route.fulfill({json:{tenant,membership:{role:'owner'},activity:[],connections:[],usage:{paused:true},memory:[]}}));
  const job={id:'research-cancel',website:'https://salon.example.com/',status:'running',pageLimit:20,evidencePages:0,usedPages:0,reservedPages:20};
  let cancelled=0;
  await page.route('**/api/tenants/business-a/research**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/cancel')){cancelled++;expect(route.request().method()).toBe('POST');return route.fulfill({json:{job:{...job,status:'cancel_requested'}}});}
    return route.fulfill({json:path.endsWith('/research-cancel')?{job,pages:[],nextOffset:null}:{jobs:[job],nextOffset:null}});
  });
  await page.goto('/');await page.getByRole('button',{name:'Knowledge',exact:true}).click();
  const panel=page.getByRole('region',{name:'Website research'});await panel.getByRole('button',{name:'View source evidence'}).click();
  await expect(panel.getByRole('button',{name:'Cancel research'})).toBeEnabled();
  await panel.getByRole('button',{name:'Cancel research'}).click();
  await expect(panel.getByRole('status')).toContainText('Page reservations remain until the provider confirms');
  await expect(panel.getByText('Stopping',{exact:true})).toBeVisible();
  await expect(panel.getByText('20 reserved',{exact:false})).toBeVisible();
  await expect(panel.getByRole('button',{name:'Cancel research'})).toHaveCount(0);expect(cancelled).toBe(1);
});

test('exhausted cancellation delivery explains the held reservation and clears after settlement',async({page})=>{
  await fixture(page);
  let job={id:'stop-review',website:'https://salon.example.com/',status:'cancel_requested',attention:'stop_limit' as string|null,pageLimit:20,evidencePages:0,usedPages:0,reservedPages:20};
  await page.route('**/api/tenants/business-a/research**',route=>route.fulfill({json:new URL(route.request().url()).pathname.endsWith('/stop-review')?{job,pages:[],nextOffset:null}:{jobs:[job],nextOffset:null}}));
  await page.goto('/');await page.getByRole('button',{name:'Knowledge',exact:true}).click();
  const panel=page.getByRole('region',{name:'Website research'});
  await expect(panel.getByText('Needs attention',{exact:false})).toBeVisible();
  await panel.getByRole('button',{name:'View source evidence'}).click();
  await expect(panel.getByText('Automatic stop requests have paused.',{exact:false})).toBeVisible();
  await expect(panel.getByText('20 reserved',{exact:false})).toBeVisible();
  await expect(panel.getByText('Research needs review before status checks can resume',{exact:false})).toHaveCount(0);
  await expect(panel.getByRole('button',{name:'Cancel research'})).toHaveCount(0);
  job={...job,status:'cancelled',attention:null,reservedPages:0};
  await panel.getByRole('button',{name:'Refresh research'}).click();
  await expect(panel.getByText('Cancelled',{exact:true})).toBeVisible();
  await expect(panel.getByText('Needs attention',{exact:true})).toHaveCount(0);
  await expect(panel.getByText('Automatic stop requests have paused.',{exact:false})).toHaveCount(0);
});

test('exhausted research checks show needs attention without claiming continued progress',async({page})=>{
  await fixture(page);
  const job={id:'research-review',website:'https://salon.example.com/',status:'running',attention:'poll_limit',pageLimit:20,evidencePages:0,usedPages:0,reservedPages:20};
  await page.route('**/api/tenants/business-a/research**',route=>route.fulfill({json:new URL(route.request().url()).pathname.endsWith('/research-review')?{job,pages:[],nextOffset:null}:{jobs:[job],nextOffset:null}}));
  await page.goto('/');await page.getByRole('button',{name:'Knowledge',exact:true}).click();
  const panel=page.getByRole('region',{name:'Website research'});
  await expect(panel.getByText('Needs attention',{exact:false})).toBeVisible();
  await panel.getByRole('button',{name:'View source evidence'}).click();
  await expect(panel.getByText('Needs attention',{exact:true})).toBeVisible();
  await expect(panel.getByRole('status')).toContainText('Research needs review before status checks can resume');
  await expect(panel.getByText('Researching',{exact:true})).toHaveCount(0);
  await expect(panel.getByRole('button',{name:'Cancel research'})).toBeEnabled();
});
