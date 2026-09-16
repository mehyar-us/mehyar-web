import { CATALOG_VERSION, getPlan, type PlanId } from "../catalog";
import type { Actor } from "../env";
import { HttpError, digest } from "../http";
import { StripeClient, agentMetadata, encodeParameters, objectId, type BillingEnv, type StripeObject } from "./stripe";

export type BillingInterval = "monthly" | "annual";
export interface CheckoutInput { stage: "setup" | "activation"; planId: PlanId; interval: BillingInterval; }
export interface BillingOrder {
  id: string; tenant_id: string; sku: string; price_id: string; amount_cents: number; currency: string; status: string;
  stripe_session_id: string | null; stage: "setup" | "activation"; plan_id: PlanId; billing_interval: BillingInterval;
  request_key: string; request_hash: string; checkout_url: string | null; provider_request_started_at: string | null;
  stripe_payment_intent_id: string | null; created_at: string;
}
export type PriceMap = Record<PlanId, { setup: string; monthly: string; annual: string }>;
export const RELEASE_GATES = ["catalog_approved", "stripe_account_verified", "billing_live_tests", "margin_validation", "pilot_release"] as const;
export function parsePriceMap(raw?: string): PriceMap {
  let parsed: PriceMap;
  try { parsed = JSON.parse(raw ?? ""); } catch { throw new HttpError(503, "billing_not_configured", "Billing is not ready for purchases."); }
  const used = new Set<string>();
  for (const plan of ["business", "growth", "operations"] as const) for (const cadence of ["setup", "monthly", "annual"] as const) {
    const value = parsed?.[plan]?.[cadence];
    if (!value || !/^price_[A-Za-z0-9]+$/.test(value) || used.has(value)) throw new HttpError(503, "invalid_price_map", "Billing prices are not ready.");
    used.add(value);
  }
  return parsed;
}
export function allowedPriceIds(env: BillingEnv): string[] { return Object.values(parsePriceMap(env.AGENT_STRIPE_PRICE_MAP)).flatMap((plan) => [plan.setup, plan.monthly, plan.annual]); }
export function configuredClient(env: BillingEnv, client?: StripeClient): StripeClient {
  if (!env.AGENT_STRIPE_SECRET_KEY || !env.AGENT_STRIPE_ACCOUNT_ID) throw new HttpError(503, "billing_not_configured", "Billing is not ready.");
  return client ?? new StripeClient(env.AGENT_STRIPE_SECRET_KEY);
}
export async function requireVerifiedGates(env: BillingEnv, scopeId: string, gates: readonly string[], now = new Date()): Promise<void> {
  const rows = await env.AGENT_DB.prepare("SELECT gate FROM agent_billing_readiness WHERE scope_id = ? AND catalog_version = ? AND status = 'verified' AND evidence_ref != '' AND verified_by != '' AND valid_until > ?").bind(scopeId, CATALOG_VERSION, now.toISOString()).all<{ gate: string }>();
  const passed = new Set(rows.results.map((row) => row.gate));
  if (gates.some((gate) => !passed.has(gate))) throw new HttpError(409, "activation_not_ready", "Required activation checks are not complete. No charge was started.");
}
export async function requireCommerceReady(env: BillingEnv, tenantId: string, stage: CheckoutInput["stage"], planId: PlanId): Promise<void> {
  if (env.COMMERCE_ENABLED !== "true") throw new HttpError(503, "commerce_disabled", "Purchases are not enabled yet.");
  if (!env.AGENT_STRIPE_WEBHOOK_SECRET) throw new HttpError(503, "webhook_not_configured", "Billing event processing is not ready.");
  configuredClient(env); parsePriceMap(env.AGENT_STRIPE_PRICE_MAP);
  await requireVerifiedGates(env, "catalog", RELEASE_GATES);
  await requireVerifiedGates(env, tenantId, stage === "setup" ? [`setup_scope_accepted:${planId}`] : [`setup_accepted:${planId}`, "voice_number_routing_ready", "business_policy_approved", "activation_approved"]);
  if (stage === "activation") {
    const setup = await env.AGENT_DB.prepare("SELECT id,plan_id FROM agent_billing_orders WHERE tenant_id = ? AND stage = 'setup' AND status = 'paid' AND refunded_cents = 0 LIMIT 1").bind(tenantId).first<{ id: string; plan_id: PlanId }>();
    if (!setup) throw new HttpError(409, "setup_not_paid", "Verified, unrefunded setup payment is required before subscription activation.");
    if (setup.plan_id !== planId) throw new HttpError(409, "setup_plan_mismatch", "Subscription activation must match the paid setup plan. A plan change requires a separately approved setup quote.");
  }
}
async function ensureCustomer(env: BillingEnv, tenantId: string, client: StripeClient): Promise<string> {
  const existing = await env.AGENT_DB.prepare("SELECT stripe_customer_id FROM agent_billing_customers WHERE tenant_id = ?").bind(tenantId).first<{ stripe_customer_id: string }>();
  if (existing) return existing.stripe_customer_id;
  const customer = await client.request("/v1/customers", "POST", encodeParameters({ metadata: agentMetadata(tenantId) }), `mayor-ai:customer:${tenantId}`);
  if (!/^cus_[A-Za-z0-9_]+$/.test(customer.id ?? "") || customer.metadata?.mehyar_agent_tenant_id !== tenantId || customer.metadata?.mehyar_billing_domain !== "business_agent") throw new HttpError(502, "customer_mapping_failed", "Billing setup could not be verified.");
  await env.AGENT_DB.prepare("INSERT INTO agent_billing_customers (tenant_id,stripe_customer_id,created_at) VALUES (?,?,?) ON CONFLICT(tenant_id) DO NOTHING").bind(tenantId, customer.id, new Date().toISOString()).run();
  const mapped = await env.AGENT_DB.prepare("SELECT stripe_customer_id FROM agent_billing_customers WHERE tenant_id = ?").bind(tenantId).first<{ stripe_customer_id: string }>();
  if (mapped?.stripe_customer_id !== customer.id) throw new HttpError(409, "customer_mapping_conflict", "Billing setup requires review.");
  return customer.id;
}
function validatePrice(price: StripeObject, expected: { id: string; amount: number; interval?: BillingInterval }): void {
  if (price.id !== expected.id || price.active !== true || price.currency !== "usd" || price.unit_amount !== expected.amount || (expected.interval ? price.recurring?.interval !== (expected.interval === "monthly" ? "month" : "year") || price.recurring?.interval_count !== 1 : price.recurring != null)) throw new HttpError(409, "price_contract_mismatch", "The billing price does not match the approved offer.");
}
export async function createCheckout(env: BillingEnv, actor: Actor, input: CheckoutInput, requestKey: string, injectedClient?: StripeClient) {
  await requireCommerceReady(env, actor.tenantId, input.stage, input.planId);
  const plan = getPlan(input.planId)!;
  const client = configuredClient(env, injectedClient);
  const priceId = parsePriceMap(env.AGENT_STRIPE_PRICE_MAP)[input.planId][input.stage === "setup" ? "setup" : input.interval];
  const amount = input.stage === "setup" ? plan.setupCents : input.interval === "annual" ? plan.annualCents : plan.monthlyCents;
  const hash = await digest(JSON.stringify({ ...input, priceId, catalogVersion: CATALOG_VERSION }));
  let order = await env.AGENT_DB.prepare("SELECT * FROM agent_billing_orders WHERE tenant_id = ? AND request_key = ?").bind(actor.tenantId, requestKey).first<BillingOrder>();
  if (order && order.request_hash !== hash) throw new HttpError(409, "request_key_conflict", "Use the original request or a new request key.");
  if (order?.checkout_url && order.status === "checkout_created") return { orderId: order.id, checkoutUrl: order.checkout_url, stage: order.stage, replay: true };
  if (order && !["pending", "checkout_created"].includes(order.status)) throw new HttpError(409, "order_already_resolved", "This billing request is already resolved.");
  if (!order) {
    if (input.stage === "setup" && await env.AGENT_DB.prepare("SELECT id FROM agent_billing_orders WHERE tenant_id = ? AND stage = 'setup' AND status = 'paid' LIMIT 1").bind(actor.tenantId).first()) throw new HttpError(409, "setup_already_paid", "This business already has a setup payment.");
    if (input.stage === "activation" && await env.AGENT_DB.prepare("SELECT tenant_id FROM agent_billing_subscriptions WHERE tenant_id = ? AND status NOT IN ('canceled','incomplete_expired')").bind(actor.tenantId).first()) throw new HttpError(409, "subscription_exists", "This business already has a subscription. Use its billing controls.");
    const now = new Date().toISOString(); const id = `ao_${crypto.randomUUID().replace(/-/g, "")}`;
    try {
      await env.AGENT_DB.prepare("INSERT INTO agent_billing_orders (id,tenant_id,sku,price_id,amount_cents,currency,status,created_at,stage,plan_id,billing_interval,catalog_version,request_key,request_hash,updated_at) VALUES (?,?,?,?,?,'usd','pending',?,?,?,?,?,?,?,?)").bind(id, actor.tenantId, `${plan.sku}-${input.stage === "setup" ? "setup" : input.interval}`, priceId, amount, now, input.stage, input.planId, input.interval, CATALOG_VERSION, requestKey, hash, now).run();
    } catch {
      const concurrent = await env.AGENT_DB.prepare("SELECT * FROM agent_billing_orders WHERE tenant_id = ? AND request_key = ?").bind(actor.tenantId, requestKey).first<BillingOrder>();
      if (!concurrent || concurrent.request_hash !== hash) throw new HttpError(409, "checkout_in_progress", "Another checkout is already in progress for this business.");
    }
    order = await env.AGENT_DB.prepare("SELECT * FROM agent_billing_orders WHERE tenant_id = ? AND request_key = ?").bind(actor.tenantId, requestKey).first<BillingOrder>();
  }
  if (!order) throw new HttpError(503, "order_unavailable", "Billing could not create the request.");
  if (order.provider_request_started_at && Date.now() - Date.parse(order.provider_request_started_at) > 23 * 3600000) throw new HttpError(409, "provider_reconciliation_required", "An earlier checkout requires reconciliation before retrying.");
  const account = await client.request("/v1/account");
  if (account.id !== env.AGENT_STRIPE_ACCOUNT_ID) throw new HttpError(409, "stripe_account_mismatch", "Billing account verification failed.");
  validatePrice(await client.request(`/v1/prices/${priceId}`), { id: priceId, amount, ...(input.stage === "activation" ? { interval: input.interval } : {}) });
  const customerId = await ensureCustomer(env, actor.tenantId, client);
  await env.AGENT_DB.prepare("UPDATE agent_billing_orders SET provider_request_started_at = COALESCE(provider_request_started_at,?),updated_at = ? WHERE id = ? AND tenant_id = ?").bind(new Date().toISOString(), new Date().toISOString(), order.id, actor.tenantId).run();
  const metadata = agentMetadata(actor.tenantId, order.id);
  const mode = input.stage === "setup" ? "payment" : "subscription";
  const origin = new URL(env.APP_ORIGIN).origin;
  const params = encodeParameters({ mode, customer: customerId, line_items: [{ price: priceId, quantity: 1 }],
    metadata, ...(mode === "payment" ? { payment_intent_data: { metadata } } : { subscription_data: { metadata } }),
    success_url: `${origin}/billing?tenantId=${encodeURIComponent(actor.tenantId)}&agentOrder=${encodeURIComponent(order.id)}`,
    cancel_url: `${origin}/billing?tenantId=${encodeURIComponent(actor.tenantId)}`, client_reference_id: order.id,
    automatic_tax: { enabled: true }, customer_update: { address: "auto" }, billing_address_collection: "required" });
  const session = await client.request("/v1/checkout/sessions", "POST", params, `mayor-ai:checkout:${order.id}`);
  if (!/^cs_[A-Za-z0-9_]+$/.test(session.id ?? "") || typeof session.url !== "string" || new URL(session.url).origin !== "https://checkout.stripe.com" || objectId(session.customer) !== customerId || session.metadata?.mehyar_agent_order_id !== order.id) throw new HttpError(502, "checkout_mapping_failed", "Checkout could not be verified.");
  await env.AGENT_DB.prepare("UPDATE agent_billing_orders SET stripe_session_id = ?,checkout_url = ?,status = 'checkout_created',updated_at = ? WHERE id = ? AND tenant_id = ? AND status = 'pending'").bind(session.id, session.url, new Date().toISOString(), order.id, actor.tenantId).run();
  return { orderId: order.id, checkoutUrl: session.url, stage: input.stage, replay: false };
}

export async function portalSession(env: BillingEnv, actor: Actor, key: string, client?: StripeClient) {
  if (!env.AGENT_STRIPE_PORTAL_CONFIGURATION) throw new HttpError(503, "portal_not_ready", "Billing management is not configured yet.");
  const customer = await env.AGENT_DB.prepare("SELECT stripe_customer_id FROM agent_billing_customers WHERE tenant_id = ?").bind(actor.tenantId).first<{ stripe_customer_id: string }>();
  if (!customer) throw new HttpError(404, "billing_customer_missing", "This business has no billing customer.");
  const result = await configuredClient(env, client).request("/v1/billing_portal/sessions", "POST", encodeParameters({ customer: customer.stripe_customer_id, configuration: env.AGENT_STRIPE_PORTAL_CONFIGURATION, return_url: `${new URL(env.APP_ORIGIN).origin}/billing?tenantId=${encodeURIComponent(actor.tenantId)}` }), `mayor-ai:portal:${actor.tenantId}:${key}`);
  if (typeof result.url !== "string" || new URL(result.url).origin !== "https://billing.stripe.com") throw new HttpError(502, "portal_invalid", "Billing management could not be opened.");
  return { url: result.url };
}
export async function cancelAtPeriodEnd(env: BillingEnv, actor: Actor, key: string, client?: StripeClient) {
  const sub = await env.AGENT_DB.prepare("SELECT stripe_subscription_id FROM agent_billing_subscriptions WHERE tenant_id = ? AND status NOT IN ('canceled','incomplete_expired')").bind(actor.tenantId).first<{ stripe_subscription_id: string }>();
  if (!sub) throw new HttpError(404, "subscription_missing", "No active subscription was found.");
  // Cancellation remains available when new sales are disabled. Webhook confirms the state.
  const result = await configuredClient(env, client).request(`/v1/subscriptions/${sub.stripe_subscription_id}`, "POST", encodeParameters({ cancel_at_period_end: true }), `mayor-ai:cancel:${actor.tenantId}:${key}`);
  if (result.id !== sub.stripe_subscription_id || result.cancel_at_period_end !== true) throw new HttpError(502, "cancellation_unconfirmed", "Cancellation could not be confirmed.");
  return { requested: true, status: "awaiting_verified_webhook", paidThroughPreserved: true };
}

export async function billingStatus(env: BillingEnv, actor: Actor) {
  const subscription = await env.AGENT_DB.prepare("SELECT plan_id,status,paid_through,cancel_at_period_end,billing_interval,grace_expires_at,access_state,pending_plan_id,dispute_state FROM agent_billing_subscriptions WHERE tenant_id = ?").bind(actor.tenantId).first<StripeObject>();
  const orders = await env.AGENT_DB.prepare("SELECT id,sku,plan_id,billing_interval,amount_cents,currency,status,stage,created_at,paid_at,refunded_cents FROM agent_billing_orders WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 25").bind(actor.tenantId).all();
  if (subscription?.grace_expires_at && Date.parse(subscription.grace_expires_at) <= Date.now() && subscription.access_state === "grace") subscription.access_state = "paused";
  if (subscription?.paid_through && Date.parse(subscription.paid_through) <= Date.now() && ["active", "paid_through"].includes(subscription.access_state)) subscription.access_state = "expired";
  const customer = await env.AGENT_DB.prepare("SELECT tenant_id FROM agent_billing_customers WHERE tenant_id = ?").bind(actor.tenantId).first();
  return { commerceEnabled: env.COMMERCE_ENABLED === "true", readiness: await billingReadiness(env, actor.tenantId), portalAvailable: Boolean(env.AGENT_STRIPE_PORTAL_CONFIGURATION && env.AGENT_STRIPE_SECRET_KEY && customer), subscription, orders: orders.results, currency: "USD" };
}

/** Read-only readiness for UI; provider secrets and evidence contents never leave the server. */
export async function billingReadiness(env: BillingEnv, tenantId: string): Promise<{ setup: boolean; activation: boolean; reason: string | null; setupPlanIds: PlanId[]; activationPlanId: PlanId | null }> {
  let setup = false; let activation = false; let reason: string | null = null;
  const setupPlanIds: PlanId[] = [];
  for (const planId of ["business", "growth", "operations"] as const) {
    try { await requireCommerceReady(env, tenantId, "setup", planId); setupPlanIds.push(planId); } catch (error) { reason ??= error instanceof HttpError ? error.message : "Billing readiness could not be verified."; }
  }
  setup = setupPlanIds.length > 0;
  const paidSetup = await env.AGENT_DB.prepare("SELECT id,plan_id,refunded_cents FROM agent_billing_orders WHERE tenant_id = ? AND stage = 'setup' AND status = 'paid' LIMIT 1").bind(tenantId).first<{ id: string; plan_id: PlanId; refunded_cents: number }>();
  if (paidSetup) {
    try { await requireCommerceReady(env, tenantId, "activation", paidSetup.plan_id); activation = true; } catch (error) { reason ??= error instanceof HttpError ? error.message : "Subscription activation checks are incomplete."; }
  }
  const activeSubscription = await env.AGENT_DB.prepare("SELECT tenant_id FROM agent_billing_subscriptions WHERE tenant_id = ? AND status NOT IN ('canceled','incomplete_expired')").bind(tenantId).first();
  if (paidSetup) setup = false;
  if (activeSubscription) { setup = false; activation = false; reason = "This business already has a subscription. Use its billing controls."; }
  if (setup || activation) reason = null;
  return { setup, activation, reason, setupPlanIds: setup ? setupPlanIds : [], activationPlanId: activation && paidSetup ? paidSetup.plan_id : null };
}

/** Call from scheduled processing AND authorization checks; a missed cron cannot extend grace. */
export async function enforceExpiredBillingGrace(env: BillingEnv, now = new Date()): Promise<number> {
  const result = await env.AGENT_DB.prepare("UPDATE agent_billing_subscriptions SET access_state = 'paused',updated_at = ? WHERE (access_state = 'grace' AND grace_expires_at <= ?) OR (access_state IN ('active','paid_through') AND paid_through <= ?)").bind(now.toISOString(), now.toISOString(), now.toISOString()).run();
  await env.AGENT_DB.prepare("UPDATE agent_tenants SET status = 'past-due',updated_at = ? WHERE id IN (SELECT tenant_id FROM agent_billing_subscriptions WHERE access_state = 'paused') AND status NOT IN ('deleted','offboarding','paused')").bind(now.toISOString()).run();
  return result.meta.changes;
}
