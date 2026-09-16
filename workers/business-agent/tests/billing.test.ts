import { env as workerEnv } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { CATALOG_VERSION, getPlan } from "../src/catalog";
import { handleBillingRequest } from "../src/billing";
import { processBillingEvent } from "../src/billing/events";
import {auditSubscription,runBillingReconciliation} from '../src/billing/reconciliation';
import { RELEASE_GATES, createCheckout, enforceExpiredBillingGrace, parsePriceMap, type CheckoutInput } from "../src/billing/service";
import { AGENT_BILLING_DOMAIN, STRIPE_API_VERSION, StripeClient, agentMetadata, assertNoLegacyMetadata, encodeParameters, verifyStripeSignature, type BillingEnv, type StripeEvent, type StripeObject } from "../src/billing/stripe";
import type { Actor } from "../src/env";

const priceMap = Object.fromEntries(["business", "growth", "operations"].map((id) => [id, { setup: `price_${id}setup`, monthly: `price_${id}monthly`, annual: `price_${id}annual` }]));
const uid = () => crypto.randomUUID().replace(/-/g, "");

class FakeStripe {
  beforeRequest?: (path: string) => Promise<void>;
  readonly calls: { path: string; method: string; parameters: URLSearchParams; headers: Headers }[] = [];
  readonly sessions = new Map<string, StripeObject>();
  readonly subscriptions = new Map<string, StripeObject>();
  readonly invoices = new Map<string, StripeObject>();
  readonly idempotent = new Map<string, StripeObject>();
  readonly client = new StripeClient("sk_test_synthetic_fixture_only", async (rawUrl, init) => {
    const url = new URL(rawUrl); const method = init?.method ?? "GET"; const headers = new Headers(init?.headers);
    const parameters = new URLSearchParams(String(init?.body ?? ""));
    await this.beforeRequest?.(url.pathname);
    this.calls.push({ path: url.pathname, method, parameters, headers });
    expect(url.origin).toBe("https://api.stripe.com");
    expect(headers.get("Stripe-Version")).toBe(STRIPE_API_VERSION);
    if (method === "POST") expect(headers.get("Idempotency-Key")).toMatch(/^mayor-ai:/);
    const key = headers.get("Idempotency-Key");
    if (key && this.idempotent.has(key)) return Response.json(this.idempotent.get(key));
    let result: StripeObject | undefined;
    if (url.pathname === "/v1/account") result = { id: "acct_fixture" };
    else if (url.pathname.startsWith("/v1/prices/")) {
      const id = url.pathname.split("/").at(-1)!;
      for (const planId of ["business", "growth", "operations"] as const) for (const interval of ["setup", "monthly", "annual"] as const) if (priceMap[planId][interval] === id) {
        const plan = getPlan(planId)!;
        result = { id, active: true, currency: "usd", unit_amount: interval === "setup" ? plan.setupCents : interval === "monthly" ? plan.monthlyCents : plan.annualCents, recurring: interval === "setup" ? null : { interval: interval === "monthly" ? "month" : "year", interval_count: 1 } };
      }
    } else if (url.pathname === "/v1/customers" && method === "POST") result = { id: `cus_${uid()}`, metadata: this.metadata(parameters) };
    else if (url.pathname === "/v1/checkout/sessions" && method === "POST") {
      const id = `cs_${uid()}`; const price = parameters.get("line_items[0][price]")!;
      const planId = (Object.keys(priceMap).find((planId) => Object.values(priceMap[planId]).includes(price))) as "business";
      const plan = getPlan(planId)!; const mode = parameters.get("mode");
      result = { id, url: `https://checkout.stripe.com/c/pay/${id}`, customer: parameters.get("customer"), metadata: this.metadata(parameters), mode, status: "open", payment_status: "unpaid", currency: "usd", amount_subtotal: mode === "payment" ? plan.setupCents : price === priceMap[planId].annual ? plan.annualCents : plan.monthlyCents, line_items: { data: [{ price: { id: price }, quantity: 1 }] } };
      this.sessions.set(id, result);
    } else if (url.pathname.startsWith("/v1/checkout/sessions/")) result = this.sessions.get(url.pathname.split("/").at(-1)!);
    else if (url.pathname.startsWith("/v1/subscriptions/")) {
      result = this.subscriptions.get(url.pathname.split("/").at(-1)!);
      if (method === "POST" && result && parameters.get("cancel_at_period_end") === "true") result.cancel_at_period_end = true;
    } else if (url.pathname.startsWith("/v1/invoices/")) result = this.invoices.get(url.pathname.split("/").at(-1)!);
    else if (url.pathname === "/v1/billing_portal/sessions") result = { id: "bps_fixture", url: "https://billing.stripe.com/p/session/fixture" };
    if (!result) throw new Error(`Unstubbed Stripe request: ${method} ${url.pathname}`);
    if (key) this.idempotent.set(key, result);
    return Response.json(result);
  });
  metadata(params: URLSearchParams) { return Object.fromEntries([...params].filter(([key]) => key.startsWith("metadata[")).map(([key, value]) => [key.slice(9, -1), value])); }
  session(orderId: string) { return [...this.sessions.values()].find((session) => session.metadata.mehyar_agent_order_id === orderId)!; }
}

async function fixture(commerceEnabled = "true") {
  const id = uid(); const actor: Actor = { userId: `user_${id}`, tenantId: `tenant_${id}` };
  const env = { ...workerEnv, AGENT_DB: (workerEnv as any).AGENT_DB, APP_ORIGIN: "https://app.example.test", ENVIRONMENT: "staging", COMMERCE_ENABLED: commerceEnabled, AGENT_STRIPE_SECRET_KEY: "sk_test_synthetic_fixture_only", AGENT_STRIPE_WEBHOOK_SECRET: "whsec_synthetic_fixture_only", AGENT_STRIPE_ACCOUNT_ID: "acct_fixture", AGENT_STRIPE_PRICE_MAP: JSON.stringify(priceMap), AGENT_STRIPE_PORTAL_CONFIGURATION: "bpc_fixture" } as BillingEnv;
  const now = new Date().toISOString();
  await env.AGENT_DB.prepare("INSERT INTO agent_tenants (id,name,owner_id,status,plan_id,created_at,updated_at,trial_expires_at) VALUES (?,? ,?,'trial','trial',?,?,?)").bind(actor.tenantId, "Synthetic fixture business", actor.userId, now, now, new Date(Date.now() + 7 * 86400000).toISOString()).run();
  await env.AGENT_DB.prepare("INSERT INTO agent_memberships (tenant_id,user_id,role,status,created_at) VALUES (?,?,'owner','active',?)").bind(actor.tenantId, actor.userId, now).run();
  const gates = [...RELEASE_GATES.map((gate) => ["catalog", gate]), ...["setup_scope_accepted:business", "setup_scope_accepted:growth", "setup_scope_accepted:operations", "setup_accepted:business", "setup_accepted:growth", "setup_accepted:operations", "voice_number_routing_ready", "business_policy_approved", "activation_approved"].map((gate) => [actor.tenantId, gate])];
  for (const [scope, gate] of gates) await env.AGENT_DB.prepare("INSERT INTO agent_billing_readiness (scope_id,gate,catalog_version,status,evidence_ref,verified_by,verified_at,valid_until) VALUES (?,?,?,'verified','fixture:isolated-test','test-operator',?,?) ON CONFLICT(scope_id,gate,catalog_version) DO UPDATE SET status='verified',valid_until=excluded.valid_until").bind(scope, gate, CATALOG_VERSION, now, new Date(Date.now() + 86400000).toISOString()).run();
  return { env, actor, stripe: new FakeStripe() };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const event = (type: string, object: StripeObject, created = Math.floor(Date.now() / 1000)): StripeEvent => JSON.parse(JSON.stringify({ id: `evt_${uid()}`, type, created, livemode: false, api_version: STRIPE_API_VERSION, data: { object } }));
async function paidSetup(f: Fixture) {
  const checkout = await createCheckout(f.env, f.actor, { stage: "setup", planId: "business", interval: "monthly" }, uid(), f.stripe.client);
  const session = f.stripe.session(checkout.orderId); Object.assign(session, { payment_status: "paid", status: "complete", payment_intent: `pi_${uid()}` });
  const delivered = event("checkout.session.completed", session); await processBillingEvent(f.env, delivered, f.stripe.client);
  return { checkout, session, delivered };
}
async function activated(f: Fixture) {
  await paidSetup(f);
  const checkout = await createCheckout(f.env, f.actor, { stage: "activation", planId: "business", interval: "monthly" }, uid(), f.stripe.client);
  const session = f.stripe.session(checkout.orderId); const subId = `sub_${uid()}`; const invoiceId = `in_${uid()}`;
  const sub = { id: subId, billing_cycle_anchor: Math.floor(Date.now() / 1000), metadata: agentMetadata(f.actor.tenantId, checkout.orderId), customer: session.customer, status: "active", latest_invoice: invoiceId, cancel_at_period_end: false, items: { data: [{ price: { id: priceMap.business.monthly }, quantity: 1 }] } };
  f.stripe.subscriptions.set(subId, sub);
  Object.assign(session, { subscription: subId, payment_status: "paid", status: "complete" });
  await processBillingEvent(f.env, event("checkout.session.completed", session), f.stripe.client);
  const invoice = { id: invoiceId, customer: session.customer, parent: { subscription_details: { subscription: subId } }, status: "paid", paid: true, amount_remaining: 0, amount_paid: 34900, currency: "usd", lines: { data: [{ pricing: { price_details: { price: priceMap.business.monthly } }, period: { end: Math.floor(Date.now() / 1000) + 30 * 86400 } }] }, payments: { data: [{ payment: { type: "payment_intent", payment_intent: `pi_${uid()}` } }] } };
  f.stripe.invoices.set(invoiceId, invoice);
  const paidEvent = event("invoice.paid", invoice); await processBillingEvent(f.env, paidEvent, f.stripe.client);
  return { checkout, session, sub, invoice, paidEvent };
}
async function sign(raw: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const result = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${raw}`));
  return `t=${timestamp},v1=${[...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

describe("Stripe signature and metadata boundary", () => {
  it('records the verified subscription usage anchor and does not refill credits on a later anchor change',async()=>{
    const f=await fixture(),a=await activated(f);
    const expected=new Date(a.sub.billing_cycle_anchor*1000).toISOString();
    expect(await f.env.AGENT_DB.prepare('SELECT usage_anchor FROM agent_billing_subscriptions WHERE tenant_id=?').bind(f.actor.tenantId).first()).toEqual({usage_anchor:expected});
    a.sub.billing_cycle_anchor+=86400;
    await processBillingEvent(f.env,event('customer.subscription.updated',a.sub),f.stripe.client);
    expect(await f.env.AGENT_DB.prepare('SELECT usage_anchor FROM agent_billing_subscriptions WHERE tenant_id=?').bind(f.actor.tenantId).first()).toEqual({usage_anchor:expected});
  });
  it("verifies exact raw bytes, rotated multiple v1 signatures and timestamp bounds", async () => {
    const raw = '{ "message": "fixture ✓", "id": 1 }'; const signature = await sign(raw, "whsec_test"); const bytes = new TextEncoder().encode(raw);
    await expect(verifyStripeSignature(bytes, `${signature},v1=${"0".repeat(64)},v0=obsolete`, "whsec_test")).resolves.toBeUndefined();
    await expect(verifyStripeSignature(new TextEncoder().encode(JSON.stringify(JSON.parse(raw))), signature, "whsec_test")).rejects.toMatchObject({ code: "invalid_signature" });
    await expect(verifyStripeSignature(bytes, signature, "wrong_secret")).rejects.toMatchObject({ code: "invalid_signature" });
    await expect(verifyStripeSignature(bytes, `${signature},t=1`, "whsec_test")).rejects.toMatchObject({ code: "invalid_signature" });
    const old = await sign(raw, "whsec_test", Math.floor(Date.now() / 1000) - 301);
    const future = await sign(raw, "whsec_test", Math.floor(Date.now() / 1000) + 301);
    await expect(verifyStripeSignature(bytes, old, "whsec_test")).rejects.toMatchObject({ code: "expired_signature" });
    await expect(verifyStripeSignature(bytes, future, "whsec_test")).rejects.toMatchObject({ code: "expired_signature" });
  });

  it("uses only namespaced metadata including nested Stripe objects", () => {
    expect(agentMetadata("tenant_a", "ao_a")).toEqual({ mehyar_billing_domain: AGENT_BILLING_DOMAIN, mehyar_agent_tenant_id: "tenant_a", mehyar_agent_order_id: "ao_a" });
    expect(() => assertNoLegacyMetadata({ subscription_data: { metadata: { payment_id: "1" } } })).toThrow();
    expect(() => encodeParameters({ payment_intent_data: { metadata: { report_id: "1" } } })).toThrow();
    expect(() => parsePriceMap(JSON.stringify({ business: { setup: "price_a", monthly: "price_a" } }))).toThrow();
  });

  it("accepts a valid unrelated signed webhook without auth/origin or any billing effects", async () => {
    const f = await fixture(); const body = JSON.stringify(event("checkout.session.completed", { id: "cs_legacy", customer: "cus_legacy", metadata: { payment_id: "123" } }));
    const request = new Request("https://app.example.test/api/agent-billing/webhook", { method: "POST", body, headers: { "stripe-signature": await sign(body, f.env.AGENT_STRIPE_WEBHOOK_SECRET!) } });
    const response = await handleBillingRequest(request, f.env, undefined, f.stripe.client);
    expect(await response.json()).toMatchObject({ received: true, outcome: "unrelated_metadata" });
    expect(f.stripe.calls).toHaveLength(0);
    const counts = await f.env.AGENT_DB.prepare("SELECT COUNT(*) AS count FROM agent_billing_orders WHERE tenant_id = ?").bind(f.actor.tenantId).first<{ count: number }>();
    expect(counts?.count).toBe(0);
  });
});

describe("new-agent two-stage checkout", () => {
  it("fails closed with commerce disabled or absent evidence and performs no remote request", async () => {
    const f = await fixture("false");
    await expect(createCheckout(f.env, f.actor, { stage: "setup", planId: "business", interval: "monthly" }, uid(), f.stripe.client)).rejects.toMatchObject({ code: "commerce_disabled" });
    f.env.COMMERCE_ENABLED = "true";
    await f.env.AGENT_DB.prepare("UPDATE agent_billing_readiness SET status='revoked' WHERE scope_id = ? AND gate='setup_scope_accepted:business'").bind(f.actor.tenantId).run();
    await expect(createCheckout(f.env, f.actor, { stage: "setup", planId: "business", interval: "monthly" }, uid(), f.stripe.client)).rejects.toMatchObject({ code: "activation_not_ready" });
    expect(f.stripe.calls).toHaveLength(0);
  });

  it("requires verified setup and activation readiness before recurring billing", async () => {
    const f = await fixture();
    await expect(createCheckout(f.env, f.actor, { stage: "activation", planId: "business", interval: "annual" }, uid(), f.stripe.client)).rejects.toMatchObject({ code: "setup_not_paid" });
    await paidSetup(f);
    await f.env.AGENT_DB.prepare("UPDATE agent_billing_readiness SET status='revoked' WHERE scope_id = ? AND gate='voice_number_routing_ready'").bind(f.actor.tenantId).run();
    await expect(createCheckout(f.env, f.actor, { stage: "activation", planId: "business", interval: "monthly" }, uid(), f.stripe.client)).rejects.toMatchObject({ code: "activation_not_ready" });
  });

  it("cannot activate a higher-priced plan with a cheaper setup or a partially refunded setup", async () => {
    const f = await fixture(); const paid = await paidSetup(f); const callsBefore = f.stripe.calls.length;
    await expect(createCheckout(f.env, f.actor, { stage: "activation", planId: "operations", interval: "monthly" }, uid(), f.stripe.client)).rejects.toMatchObject({ code: "setup_plan_mismatch" });
    expect(f.stripe.calls).toHaveLength(callsBefore);
    const status = await handleBillingRequest(new Request(`https://app.example.test/api/agent-billing/status?tenantId=${f.actor.tenantId}`), f.env, f.actor, f.stripe.client);
    expect(await status.json()).toMatchObject({ readiness: { setup: false, activation: true, activationPlanId: "business" }, orders: [expect.objectContaining({ plan_id: "business", refunded_cents: 0 })] });
    await f.env.AGENT_DB.prepare("UPDATE agent_billing_orders SET refunded_cents=1 WHERE id=?").bind(paid.checkout.orderId).run();
    await expect(createCheckout(f.env, f.actor, { stage: "activation", planId: "business", interval: "monthly" }, uid(), f.stripe.client)).rejects.toMatchObject({ code: "setup_not_paid" });
  });

  it("uses server prices and stable request idempotency without touching legacy identifiers", async () => {
    const f = await fixture(); const key = uid(); const input: CheckoutInput = { stage: "setup", planId: "business", interval: "monthly" };
    const first = await createCheckout(f.env, f.actor, input, key, f.stripe.client);
    const replay = await createCheckout(f.env, f.actor, input, key, f.stripe.client);
    expect(replay).toMatchObject({ orderId: first.orderId, replay: true });
    const creates = f.stripe.calls.filter((call) => call.path === "/v1/checkout/sessions" && call.method === "POST");
    expect(creates).toHaveLength(1);
    expect(creates[0].parameters.get("mode")).toBe("payment");
    expect(creates[0].parameters.get("line_items[0][price]")).toBe(priceMap.business.setup);
    expect(creates[0].parameters.get("metadata[mehyar_agent_order_id]")).toBe(first.orderId);
    expect(creates[0].parameters.get("payment_intent_data[metadata][mehyar_billing_domain]")).toBe(AGENT_BILLING_DOMAIN);
    expect([...creates[0].parameters.keys()].some((key) => /\[(payment_id|report_id)\]/.test(key))).toBe(false);
    await expect(createCheckout(f.env, f.actor, { ...input, planId: "growth" }, key, f.stripe.client)).rejects.toMatchObject({ code: "request_key_conflict" });
    await expect(createCheckout(f.env, f.actor, input, uid(), f.stripe.client)).rejects.toMatchObject({ code: "checkout_in_progress" });
  });

  it("checks both browser origin and active billing membership", async () => {
    const f = await fixture(); const body = JSON.stringify({ stage: "setup", planId: "business", interval: "monthly" });
    const request = (origin: string) => new Request(`https://app.example.test/api/agent-billing/checkout?tenantId=${f.actor.tenantId}`, { method: "POST", headers: { origin, "content-type": "application/json", "x-idempotency-key": uid() }, body });
    await expect(handleBillingRequest(request("https://evil.example"), f.env, f.actor, f.stripe.client)).rejects.toMatchObject({ code: "invalid_origin" });
    await expect(handleBillingRequest(request(f.env.APP_ORIGIN), f.env, { ...f.actor, userId: "unrelated_user" }, f.stripe.client)).rejects.toMatchObject({ code: "workspace_not_found" });
    expect(f.stripe.calls).toHaveLength(0);
  });

  it("permits originless authenticated status reads and reports actual setup/activation readiness", async () => {
    const f = await fixture();
    const request = new Request(`https://app.example.test/api/agent-billing/status?tenantId=${f.actor.tenantId}`);
    const response = await handleBillingRequest(request, f.env, f.actor, f.stripe.client);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ readiness: { setup: true, activation: false }, portalAvailable: false });
    await expect(handleBillingRequest(request, f.env, { ...f.actor, userId: "wrong_user" }, f.stripe.client)).rejects.toMatchObject({ code: "workspace_not_found" });
    expect(f.stripe.calls).toHaveLength(0);
  });
});

describe("new-agent verified lifecycle and recovery", () => {
  it('audits mapped subscriptions and latest invoices without changing entitlements or Stripe',async()=>{
    const f=await fixture(),a=await activated(f);Object.assign(a.sub,{livemode:false});Object.assign(a.sub.items,{has_more:false});Object.assign(a.invoice,{livemode:false});
    const before=await f.env.AGENT_DB.prepare('SELECT * FROM agent_billing_subscriptions WHERE tenant_id=?').bind(f.actor.tenantId).first();const callStart=f.stripe.calls.length;
    expect(await auditSubscription(f.env,f.actor.tenantId,f.stripe.client)).toEqual([]);
    Object.assign(a.sub,{status:'canceled',cancel_at_period_end:true});Object.assign(a.invoice,{amount_paid:100});
    expect(await auditSubscription(f.env,f.actor.tenantId,f.stripe.client)).toEqual(['subscription_status_mismatch','cancellation_mismatch','invoice_snapshot_mismatch']);
    expect(await f.env.AGENT_DB.prepare('SELECT * FROM agent_billing_subscriptions WHERE tenant_id=?').bind(f.actor.tenantId).first()).toEqual(before);
    expect(f.stripe.calls.slice(callStart).every(call=>call.method==='GET')).toBe(true);
    Object.assign(a.sub.metadata,{payment_id:'legacy'});await expect(auditSubscription(f.env,f.actor.tenantId,f.stripe.client)).rejects.toMatchObject({code:'legacy_metadata_forbidden'});
  });
  it('schedules gated daily comparisons and stores sanitized failures with backoff',async()=>{
    const f=await fixture(),a=await activated(f);Object.assign(a.sub,{livemode:false});Object.assign(a.sub.items,{has_more:false});Object.assign(a.invoice,{livemode:false});
    const before=f.stripe.calls.length;expect(await runBillingReconciliation(f.env,f.stripe.client)).toEqual({checked:0,disabled:true});expect(f.stripe.calls).toHaveLength(before);
    f.env.AGENT_BILLING_RECONCILIATION_ENABLED='true';await expect(runBillingReconciliation(f.env,f.stripe.client)).rejects.toMatchObject({code:'activation_not_ready'});
    const stamp=new Date().toISOString();for(const gate of ['stripe_account_verified','billing_reconciliation_tests'])await f.env.AGENT_DB.prepare("INSERT INTO agent_billing_readiness(scope_id,gate,catalog_version,status,evidence_ref,verified_by,verified_at,valid_until) VALUES (?,?,?,'verified','fixture','fixture',?,?)")
      .bind('billing:reconciliation:acct_fixture',gate,CATALOG_VERSION,stamp,new Date(Date.now()+86400000).toISOString()).run();
    expect(await runBillingReconciliation(f.env,f.stripe.client)).toEqual({checked:1,disabled:false});
    const report=await f.env.AGENT_DB.prepare('SELECT * FROM agent_billing_reconciliation WHERE tenant_id=?').bind(f.actor.tenantId).first<StripeObject>();expect(report).toMatchObject({status:'checked',findings_json:'[]',lease_token:null});expect(Date.parse(report!.next_check_at)-Date.now()).toBeGreaterThan(23*3600000);
    expect(await runBillingReconciliation(f.env,f.stripe.client)).toEqual({checked:0,disabled:false});
    await f.env.AGENT_DB.prepare("UPDATE agent_billing_reconciliation SET next_check_at='2000-01-01' WHERE tenant_id=?").bind(f.actor.tenantId).run();Object.assign(a.sub,{customer:'cus_foreign'});
    expect(await runBillingReconciliation(f.env,f.stripe.client)).toEqual({checked:0,disabled:false});
    expect(await f.env.AGENT_DB.prepare('SELECT status,last_error_code FROM agent_billing_reconciliation WHERE tenant_id=?').bind(f.actor.tenantId).first()).toEqual({status:'failed',last_error_code:'subscription_contract_mismatch'});
  });
  it('rejects a comparison when a webhook changes the local subscription mid-read',async()=>{
    const f=await fixture(),a=await activated(f);Object.assign(a.sub,{livemode:false});Object.assign(a.sub.items,{has_more:false});Object.assign(a.invoice,{livemode:false});
    f.stripe.beforeRequest=async path=>{if(path.startsWith('/v1/invoices/'))await f.env.AGENT_DB.prepare("UPDATE agent_billing_subscriptions SET access_state='paused' WHERE tenant_id=?").bind(f.actor.tenantId).run();};
    await expect(auditSubscription(f.env,f.actor.tenantId,f.stripe.client)).rejects.toMatchObject({code:'billing_snapshot_changed'});
  });
  it("deduplicates setup events without activating the subscription or duplicate notices", async () => {
    const f = await fixture(); const paid = await paidSetup(f);
    expect(await processBillingEvent(f.env, paid.delivered, f.stripe.client)).toMatchObject({ outcome: "duplicate" });
    await processBillingEvent(f.env, event("checkout.session.async_payment_succeeded", paid.session), f.stripe.client);
    const order = await f.env.AGENT_DB.prepare("SELECT status FROM agent_billing_orders WHERE id = ?").bind(paid.checkout.orderId).first<{ status: string }>();
    const tenant = await f.env.AGENT_DB.prepare("SELECT plan_id FROM agent_tenants WHERE id = ?").bind(f.actor.tenantId).first<{ plan_id: string }>();
    expect(order?.status).toBe("paid"); expect(tenant?.plan_id).toBe("trial");
    const notices = await f.env.AGENT_DB.prepare("SELECT COUNT(*) AS count FROM agent_billing_notices WHERE tenant_id=? AND kind='setup_paid'").bind(f.actor.tenantId).first<{ count: number }>();
    expect(notices?.count).toBe(1);
  });

  it("activates only from a paid owned invoice and preserves paid-through cancellation access", async () => {
    const f = await fixture(); const a = await activated(f);
    let sub = await f.env.AGENT_DB.prepare("SELECT * FROM agent_billing_subscriptions WHERE tenant_id = ?").bind(f.actor.tenantId).first<StripeObject>();
    expect(sub).toMatchObject({ status: "active", access_state: "active", plan_id: "business" });
    a.sub.cancel_at_period_end = true;
    await processBillingEvent(f.env, event("customer.subscription.updated", a.sub), f.stripe.client);
    sub = await f.env.AGENT_DB.prepare("SELECT * FROM agent_billing_subscriptions WHERE tenant_id = ?").bind(f.actor.tenantId).first<StripeObject>();
    expect(sub?.cancel_at_period_end).toBe(1); expect(sub?.access_state).toBe("active");
    a.sub.status = "canceled";
    await processBillingEvent(f.env, event("customer.subscription.deleted", a.sub), f.stripe.client);
    expect(await f.env.AGENT_DB.prepare("SELECT access_state FROM agent_billing_subscriptions WHERE tenant_id = ?").bind(f.actor.tenantId).first()).toMatchObject({ access_state: "paid_through" });
  });

  it("enforces a single seven-day grace window then restores only after verified payment", async () => {
    const f = await fixture(); const a = await activated(f); const nextId = `in_${uid()}`;
    const next = { ...a.invoice, id: nextId, status: "open", paid: false, amount_remaining: 34900, amount_paid: 0 };
    f.stripe.invoices.set(nextId, next); a.sub.status = "past_due"; a.sub.latest_invoice = nextId;
    const failure = event("invoice.payment_failed", next);
    await processBillingEvent(f.env, failure, f.stripe.client);
    const grace = await f.env.AGENT_DB.prepare("SELECT access_state,grace_expires_at FROM agent_billing_subscriptions WHERE tenant_id = ?").bind(f.actor.tenantId).first<StripeObject>();
    expect(grace?.access_state).toBe("grace");
    expect(Date.parse(grace!.grace_expires_at)).toBe((failure.created + 7 * 86400) * 1000);
    await processBillingEvent(f.env, event("invoice.payment_failed", next, failure.created + 30), f.stripe.client);
    expect(await f.env.AGENT_DB.prepare("SELECT grace_expires_at FROM agent_billing_subscriptions WHERE tenant_id = ?").bind(f.actor.tenantId).first()).toMatchObject({ grace_expires_at: grace!.grace_expires_at });
    await enforceExpiredBillingGrace(f.env, new Date(Date.parse(grace!.grace_expires_at) + 1));
    expect(await f.env.AGENT_DB.prepare("SELECT access_state FROM agent_billing_subscriptions WHERE tenant_id = ?").bind(f.actor.tenantId).first()).toMatchObject({ access_state: "paused" });
    Object.assign(next, { status: "paid", paid: true, amount_remaining: 0, amount_paid: 34900 }); a.sub.status = "active";
    await processBillingEvent(f.env, event("invoice.paid", next), f.stripe.client);
    expect(await f.env.AGENT_DB.prepare("SELECT access_state,grace_expires_at FROM agent_billing_subscriptions WHERE tenant_id = ?").bind(f.actor.tenantId).first()).toMatchObject({ access_state: "active", grace_expires_at: null });
    // Out-of-order old failure resolves against current Stripe state instead of regressing access.
    await processBillingEvent(f.env, event("invoice.payment_failed", next), f.stripe.client);
    expect(await f.env.AGENT_DB.prepare("SELECT access_state FROM agent_billing_subscriptions WHERE tenant_id = ?").bind(f.actor.tenantId).first()).toMatchObject({ access_state: "active" });
  });

  it("records refunds and disputes without inventing legacy writes or deleting deliverables", async () => {
    const f = await fixture(); const setup = await paidSetup(f);
    await processBillingEvent(f.env, event("charge.refunded", { id: `ch_${uid()}`, customer: setup.session.customer, payment_intent: setup.session.payment_intent, amount_refunded: 150000, refunded: true }), f.stripe.client);
    expect(await f.env.AGENT_DB.prepare("SELECT status,refunded_cents FROM agent_billing_orders WHERE id = ?").bind(setup.checkout.orderId).first()).toMatchObject({ status: "refunded", refunded_cents: 150000 });
    const g = await fixture(); const a = await activated(g);
    await processBillingEvent(g.env, event("charge.dispute.created", { id: `dp_${uid()}`, payment_intent: a.invoice.payments.data[0].payment.payment_intent, amount: 34900, status: "needs_response" }), g.stripe.client);
    expect(await g.env.AGENT_DB.prepare("SELECT access_state,dispute_state FROM agent_billing_subscriptions WHERE tenant_id = ?").bind(g.actor.tenantId).first()).toMatchObject({ access_state: "paused", dispute_state: "needs_response" });
    await processBillingEvent(g.env, event("credit_note.created", { id: `cn_${uid()}`, invoice: a.invoice.id, amount: 500, status: "issued" }), g.stripe.client);
    expect(await g.env.AGENT_DB.prepare("SELECT COUNT(*) AS count FROM agent_billing_adjustments WHERE tenant_id = ?").bind(g.actor.tenantId).first()).toMatchObject({ count: 2 });
  });

  it("rejects cross-tenant metadata and unallowlisted prices without granting access", async () => {
    const f = await fixture(); const a = await activated(f);
    const bad = event("checkout.session.completed", { ...a.session, metadata: { ...a.session.metadata, mehyar_agent_tenant_id: "other_tenant" } });
    expect(await processBillingEvent(f.env, bad, f.stripe.client)).toMatchObject({ outcome: "unrelated_or_unready" });
    a.sub.items.data[0].price.id = "price_unapproved";
    const eventToRetry = event("customer.subscription.updated", a.sub);
    await expect(processBillingEvent(f.env, eventToRetry, f.stripe.client)).rejects.toMatchObject({ code: "subscription_price_mismatch" });
    expect(await f.env.AGENT_DB.prepare("SELECT status FROM agent_inbox WHERE provider='stripe_business_agent' AND event_id = ?").bind(eventToRetry.id).first()).toMatchObject({ status: "failed" });
    expect(await f.env.AGENT_DB.prepare("SELECT price_id FROM agent_billing_subscriptions WHERE tenant_id = ?").bind(f.actor.tenantId).first()).toMatchObject({ price_id: priceMap.business.monthly });
  });

  it("rejects adjustments whose customer and payment mappings disagree across tenants", async () => {
    const f = await fixture(); const setup = await paidSetup(f);
    const other = await fixture(); const otherSetup = await paidSetup(other);
    const mismatched = event("charge.refunded", { id: `ch_${uid()}`, customer: otherSetup.session.customer, payment_intent: setup.session.payment_intent, amount_refunded: 150000, refunded: true });
    await expect(processBillingEvent(f.env, mismatched, f.stripe.client)).rejects.toMatchObject({ code: "adjustment_mapping_conflict" });
    expect(await f.env.AGENT_DB.prepare("SELECT status,refunded_cents FROM agent_billing_orders WHERE id = ?").bind(setup.checkout.orderId).first()).toMatchObject({ status: "paid", refunded_cents: 0 });
    expect(await f.env.AGENT_DB.prepare("SELECT COUNT(*) AS count FROM agent_billing_adjustments WHERE stripe_object_id = ?").bind(mismatched.data.object.id).first()).toMatchObject({ count: 0 });
    expect(await f.env.AGENT_DB.prepare("SELECT status FROM agent_inbox WHERE provider='stripe_business_agent' AND event_id = ?").bind(mismatched.id).first()).toMatchObject({ status: "failed" });
  });

  it("serializes different events for one tenant and preserves renewed access after late checkout", async () => {
    const f = await fixture(); const a = await activated(f);
    const renewedEnd = Math.floor(Date.now() / 1000) + 60 * 86400;
    const renewed = { ...a.invoice, id: `in_${uid()}`, lines: { data: [{ pricing: { price_details: { price: priceMap.business.monthly } }, period: { end: renewedEnd } }] } };
    f.stripe.invoices.set(renewed.id, renewed); a.sub.latest_invoice = renewed.id;
    let release!: () => void; let entered!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const processing = new Promise<void>((resolve) => { entered = resolve; });
    f.stripe.beforeRequest = async (path) => { if (path === `/v1/invoices/${renewed.id}`) { entered(); await barrier; } };
    const renewal = processBillingEvent(f.env, event("invoice.paid", renewed), f.stripe.client);
    await processing;
    const lateCheckout = event("checkout.session.completed", a.session);
    await expect(processBillingEvent(f.env, lateCheckout, f.stripe.client)).rejects.toMatchObject({ code: "tenant_billing_busy" });
    release(); await renewal; f.stripe.beforeRequest = undefined;
    await processBillingEvent(f.env, lateCheckout, f.stripe.client);
    expect(await f.env.AGENT_DB.prepare("SELECT paid_through,access_state FROM agent_billing_subscriptions WHERE tenant_id = ?").bind(f.actor.tenantId).first()).toMatchObject({ paid_through: new Date(renewedEnd * 1000).toISOString(), access_state: "active" });
    expect(await f.env.AGENT_DB.prepare("SELECT COUNT(*) AS count FROM agent_billing_tenant_leases WHERE tenant_id = ?").bind(f.actor.tenantId).first()).toMatchObject({ count: 0 });
  });

  it("retries a clearly owned webhook arriving before the checkout mapping commit", async () => {
    const f = await fixture();
    const checkout = await createCheckout(f.env, f.actor, { stage: "setup", planId: "business", interval: "monthly" }, uid(), f.stripe.client);
    const session = f.stripe.session(checkout.orderId); Object.assign(session, { payment_status: "paid", status: "complete", payment_intent: `pi_${uid()}` });
    await f.env.AGENT_DB.prepare("UPDATE agent_billing_orders SET stripe_session_id=NULL,status='pending' WHERE id = ?").bind(checkout.orderId).run();
    const early = event("checkout.session.completed", session);
    await expect(processBillingEvent(f.env, early, f.stripe.client)).rejects.toMatchObject({ code: "order_mapping_pending", status: 503 });
    expect(await f.env.AGENT_DB.prepare("SELECT status FROM agent_inbox WHERE provider='stripe_business_agent' AND event_id=?").bind(early.id).first()).toMatchObject({ status: "failed" });
    await f.env.AGENT_DB.prepare("UPDATE agent_billing_orders SET stripe_session_id=?,status='checkout_created' WHERE id = ?").bind(session.id, checkout.orderId).run();
    await processBillingEvent(f.env, early, f.stripe.client);
    expect(await f.env.AGENT_DB.prepare("SELECT status FROM agent_billing_orders WHERE id = ?").bind(checkout.orderId).first()).toMatchObject({ status: "paid" });
  });
});
