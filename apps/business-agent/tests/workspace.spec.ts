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
