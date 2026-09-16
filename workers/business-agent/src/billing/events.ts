import { CATALOG_VERSION, getPlan } from "../catalog";
import { HttpError, digest } from "../http";
import { allowedPriceIds, configuredClient, parsePriceMap, type BillingOrder } from "./service";
import { AGENT_BILLING_DOMAIN, STRIPE_API_VERSION, StripeClient, assertNoLegacyMetadata, objectId, type BillingEnv, type StripeEvent, type StripeObject } from "./stripe";

export const BILLING_EVENT_TYPES = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "customer.subscription.paused", "customer.subscription.resumed", "invoice.paid", "invoice.payment_failed", "invoice.payment_action_required", "invoice.upcoming", "charge.refunded", "charge.dispute.created", "charge.dispute.closed", "credit_note.created", "credit_note.voided"] as const;
const PROVIDER = "stripe_business_agent";
type SubRow = { tenant_id: string; stripe_subscription_id: string; plan_id: string; status: string; paid_through: string | null; access_state: string; grace_expires_at: string | null; price_id: string | null; activation_order_id: string | null; dispute_state: string | null; last_event_created: number };
type OwnedSubscription = { current: StripeObject; order: BillingOrder; customer: string; existing: SubRow | null };
function iso(seconds: unknown): string | null { return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null; }
function metadataIsOurs(metadata: StripeObject | undefined): boolean { return metadata?.mehyar_billing_domain === AGENT_BILLING_DOMAIN; }
function invoiceSubscription(invoice: StripeObject): string | undefined { return objectId(invoice.parent?.subscription_details?.subscription) ?? objectId(invoice.subscription); }
function priceId(item: StripeObject): string | undefined { return objectId(item.price) ?? item.pricing?.price_details?.price; }
function stmt(env: BillingEnv, query: string, ...values: unknown[]) { return env.AGENT_DB.prepare(query).bind(...values); }
function notice(env: BillingEnv, tenantId: string, event: StripeEvent, kind: string) {
  return stmt(env, "INSERT INTO agent_billing_notices (id,tenant_id,event_id,kind,created_at) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING", `bn_${tenantId}_${event.data.object.id}_${kind}`, tenantId, event.id, kind, new Date().toISOString());
}
async function knownCustomer(env: BillingEnv, customerId?: string): Promise<{ tenant_id: string } | null> {
  if (!customerId) return null;
  return env.AGENT_DB.prepare("SELECT tenant_id FROM agent_billing_customers WHERE stripe_customer_id = ?").bind(customerId).first<{ tenant_id: string }>();
}
async function ownedSubscription(env: BillingEnv, client: StripeClient, subscriptionId: string, expectedCustomer?: string): Promise<OwnedSubscription | null> {
  if (!/^sub_[A-Za-z0-9_]+$/.test(subscriptionId)) return null;
  const current = await client.request(`/v1/subscriptions/${subscriptionId}`);
  if (current.id !== subscriptionId || !metadataIsOurs(current.metadata)) return null;
  assertNoLegacyMetadata(current.metadata);
  const customer = objectId(current.customer); if (!customer || (expectedCustomer && customer !== expectedCustomer)) return null;
  const mapped = await knownCustomer(env, customer); if (!mapped || mapped.tenant_id !== current.metadata.mehyar_agent_tenant_id) return null;
  const order = await env.AGENT_DB.prepare("SELECT * FROM agent_billing_orders WHERE id = ? AND tenant_id = ? AND stage = 'activation'").bind(current.metadata.mehyar_agent_order_id ?? "", mapped.tenant_id).first<BillingOrder>();
  if (order?.status === "pending") throw new HttpError(503, "order_mapping_pending", "The activation order is still being recorded. Retry this event.");
  if (!order || !["checkout_created", "completed"].includes(order.status)) return null;
  const items: StripeObject[] = current.items?.data ?? [];
  if (items.length !== 1 || priceId(items[0]) !== order.price_id || !allowedPriceIds(env).includes(order.price_id) || (items[0].quantity ?? 1) !== 1) throw new HttpError(409, "subscription_price_mismatch", "Subscription ownership could not be verified.");
  const map = parsePriceMap(env.AGENT_STRIPE_PRICE_MAP);
  if (map[order.plan_id]?.[order.billing_interval] !== order.price_id) throw new HttpError(409, "subscription_plan_mismatch", "Subscription plan needs review.");
  const existing = await env.AGENT_DB.prepare("SELECT * FROM agent_billing_subscriptions WHERE tenant_id = ?").bind(order.tenant_id).first<SubRow>();
  if (existing && existing.stripe_subscription_id !== subscriptionId && !["canceled", "incomplete_expired"].includes(existing.status)) throw new HttpError(409, "subscription_mapping_conflict", "Subscription mapping needs review.");
  return { current, order, customer, existing };
}
function subscriptionWrite(env: BillingEnv, owned: OwnedSubscription, event: StripeEvent, overrides: { paidThrough?: string | null; access?: string; grace?: string | null; invoiceId?: string | null } = {}) {
  const { current, order, customer, existing } = owned;
  const paidThrough = overrides.paidThrough === undefined ? existing?.paid_through ?? null : overrides.paidThrough;
  const access = overrides.access ?? existing?.access_state ?? "pending";
  // Allowances keep the first verified anchor for this subscription. A later
  // billing-date edit must not silently create another monthly credit allowance.
  return stmt(env, `INSERT INTO agent_billing_subscriptions (tenant_id,stripe_subscription_id,plan_id,status,paid_through,cancel_at_period_end,updated_at,stripe_customer_id,price_id,billing_interval,catalog_version,activation_order_id,last_event_created,last_invoice_id,grace_expires_at,access_state,usage_anchor)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET
    stripe_subscription_id=excluded.stripe_subscription_id,plan_id=excluded.plan_id,status=excluded.status,paid_through=excluded.paid_through,cancel_at_period_end=excluded.cancel_at_period_end,updated_at=excluded.updated_at,stripe_customer_id=excluded.stripe_customer_id,price_id=excluded.price_id,billing_interval=excluded.billing_interval,catalog_version=excluded.catalog_version,activation_order_id=excluded.activation_order_id,last_event_created=MAX(agent_billing_subscriptions.last_event_created,excluded.last_event_created),last_invoice_id=COALESCE(excluded.last_invoice_id,agent_billing_subscriptions.last_invoice_id),grace_expires_at=excluded.grace_expires_at,access_state=excluded.access_state,usage_anchor=CASE WHEN agent_billing_subscriptions.stripe_subscription_id=excluded.stripe_subscription_id THEN COALESCE(agent_billing_subscriptions.usage_anchor,excluded.usage_anchor) ELSE excluded.usage_anchor END`,
  order.tenant_id, current.id, order.plan_id, current.status, paidThrough, current.cancel_at_period_end ? 1 : 0, new Date().toISOString(), customer, order.price_id, order.billing_interval, CATALOG_VERSION, order.id, event.created, overrides.invoiceId ?? null, overrides.grace === undefined ? existing?.grace_expires_at ?? null : overrides.grace, access, iso(current.billing_cycle_anchor));
}
function tenantEntitlement(env: BillingEnv, tenantId: string, planId: string, access: string) {
  const status = access === "active" ? "active" : access === "grace" ? "past-due" : "past-due";
  // Owner pause/offboarding/deletion always wins over payment recovery.
  return stmt(env, "UPDATE agent_tenants SET plan_id = ?,status = CASE WHEN status IN ('paused','offboarding','deleted') THEN status ELSE ? END,updated_at = ? WHERE id = ?", planId, status, new Date().toISOString(), tenantId);
}

async function checkoutEffects(env: BillingEnv, event: StripeEvent, client: StripeClient): Promise<D1PreparedStatement[]> {
  const object = event.data.object;
  if (!metadataIsOurs(object.metadata)) return [];
  assertNoLegacyMetadata(object.metadata);
  const order = await env.AGENT_DB.prepare("SELECT * FROM agent_billing_orders WHERE id = ? AND tenant_id = ?").bind(object.metadata.mehyar_agent_order_id ?? "", object.metadata.mehyar_agent_tenant_id ?? "").first<BillingOrder>();
  if (order && !order.stripe_session_id && order.status === "pending") throw new HttpError(503, "order_mapping_pending", "The checkout mapping is still being recorded. Retry this event.");
  if (!order || order.stripe_session_id !== object.id) return [];
  const customer = await knownCustomer(env, objectId(object.customer));
  if (customer?.tenant_id !== order.tenant_id || !allowedPriceIds(env).includes(order.price_id)) return [];
  const session = await client.request(`/v1/checkout/sessions/${object.id}?expand[]=line_items.data.price`);
  if (session.id !== order.stripe_session_id || objectId(session.customer) !== objectId(object.customer) || session.metadata?.mehyar_agent_order_id !== order.id || session.metadata?.mehyar_agent_tenant_id !== order.tenant_id || !metadataIsOurs(session.metadata)) return [];
  assertNoLegacyMetadata(session.metadata);
  const items: StripeObject[] = session.line_items?.data ?? [];
  if (items.length !== 1 || priceId(items[0]) !== order.price_id || (items[0].quantity ?? 1) !== 1 || session.currency !== "usd" || session.amount_subtotal !== order.amount_cents || session.mode !== (order.stage === "setup" ? "payment" : "subscription")) throw new HttpError(409, "checkout_contract_mismatch", "Billing event does not match its order.");
  if (event.type === "checkout.session.expired" && session.status === "expired") return [stmt(env, "UPDATE agent_billing_orders SET status = 'expired',updated_at = ? WHERE id = ? AND status IN ('pending','checkout_created')", new Date().toISOString(), order.id)];
  if (event.type === "checkout.session.async_payment_failed" && session.payment_status !== "paid") return [stmt(env, "UPDATE agent_billing_orders SET status = 'failed',updated_at = ? WHERE id = ? AND status IN ('pending','checkout_created')", new Date().toISOString(), order.id), notice(env, order.tenant_id, event, "setup_payment_failed")];
  if (session.payment_status !== "paid") return [];
  if (order.stage === "setup") return [
    stmt(env, "UPDATE agent_billing_orders SET status = 'paid',paid_at = COALESCE(paid_at,?),stripe_payment_intent_id = ?,updated_at = ? WHERE id = ? AND status IN ('pending','checkout_created','paid')", new Date().toISOString(), objectId(session.payment_intent) ?? null, new Date().toISOString(), order.id),
    notice(env, order.tenant_id, event, "setup_paid"),
  ];
  const subscriptionId = objectId(session.subscription); if (!subscriptionId) throw new HttpError(409, "subscription_missing", "The activation subscription is missing.");
  const owned = await ownedSubscription(env, client, subscriptionId, objectId(session.customer)); if (!owned) throw new HttpError(409, "subscription_unowned", "The activation subscription needs review.");
  // A paid success URL/session never grants recurring access: invoice.paid does that.
  return [subscriptionWrite(env, owned, event), stmt(env, "UPDATE agent_billing_orders SET status = 'completed',updated_at = ? WHERE id = ? AND status = 'checkout_created'", new Date().toISOString(), order.id)];
}

async function subscriptionEffects(env: BillingEnv, event: StripeEvent, client: StripeClient): Promise<D1PreparedStatement[]> {
  const object = event.data.object;
  if (!metadataIsOurs(object.metadata) || !await knownCustomer(env, objectId(object.customer))) return [];
  const owned = await ownedSubscription(env, client, object.id, objectId(object.customer)); if (!owned) return [];
  const { current, existing, order } = owned;
  let access = existing?.access_state ?? "pending";
  if (["unpaid", "paused", "incomplete_expired"].includes(current.status)) access = "paused";
  if (current.status === "canceled") access = existing?.paid_through && Date.parse(existing.paid_through) > Date.now() ? "paid_through" : "expired";
  const effects = [subscriptionWrite(env, owned, event, { access })];
  if (["paused", "expired"].includes(access)) effects.push(tenantEntitlement(env, order.tenant_id, order.plan_id, access));
  if (current.cancel_at_period_end) effects.push(notice(env, order.tenant_id, event, "cancellation_scheduled"));
  return effects;
}

async function invoiceEffects(env: BillingEnv, event: StripeEvent, client: StripeClient): Promise<D1PreparedStatement[]> {
  const object = event.data.object; const mapped = await knownCustomer(env, objectId(object.customer)); if (!mapped) return [];
  const invoice = event.type === "invoice.upcoming" ? object : await client.request(`/v1/invoices/${object.id}?expand[]=payments`);
  if (objectId(invoice.customer) !== objectId(object.customer)) return [];
  const subscriptionId = invoiceSubscription(invoice); if (!subscriptionId) return [];
  const owned = await ownedSubscription(env, client, subscriptionId, objectId(invoice.customer)); if (!owned || owned.order.tenant_id !== mapped.tenant_id) return [];
  if (event.type === "invoice.upcoming") return [notice(env, mapped.tenant_id, event, owned.order.billing_interval === "annual" ? "annual_renewal_upcoming" : "renewal_upcoming")];
  const lines: StripeObject[] = invoice.lines?.data ?? [];
  const matchingLines = lines.filter((line) => priceId(line) === owned.order.price_id);
  if (!matchingLines.length || invoice.currency !== "usd" || invoice.lines?.has_more === true) throw new HttpError(409, "invoice_contract_mismatch", "Invoice needs reconciliation.");
  const periodEnd = matchingLines.reduce<string | null>((latest, line) => { const end = iso(line.period?.end); return end && (!latest || end > latest) ? end : latest; }, null);
  const payments: StripeObject[] = invoice.payments?.data ?? [];
  const intent = objectId(payments.find((payment) => payment.payment?.type === "payment_intent")?.payment?.payment_intent) ?? objectId(invoice.payment_intent) ?? null;
  const now = new Date().toISOString();
  const paid = invoice.status === "paid" && (invoice.paid === true || invoice.amount_remaining === 0);
  const invoiceWrite = stmt(env, `INSERT INTO agent_billing_invoices (stripe_invoice_id,tenant_id,stripe_subscription_id,stripe_customer_id,amount_paid_cents,currency,status,period_end,stripe_payment_intent_id,last_event_created,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(stripe_invoice_id) DO UPDATE SET status=excluded.status,amount_paid_cents=excluded.amount_paid_cents,period_end=excluded.period_end,stripe_payment_intent_id=COALESCE(excluded.stripe_payment_intent_id,agent_billing_invoices.stripe_payment_intent_id),last_event_created=MAX(agent_billing_invoices.last_event_created,excluded.last_event_created),updated_at=excluded.updated_at`, invoice.id, mapped.tenant_id, subscriptionId, owned.customer, invoice.amount_paid ?? 0, "usd", invoice.status, periodEnd, intent, event.created, now, now);
  const effects = [invoiceWrite];
  if (paid && owned.current.status === "active" && periodEnd && !owned.existing?.dispute_state) {
    const paidThrough = owned.existing?.paid_through && owned.existing.paid_through > periodEnd ? owned.existing.paid_through : periodEnd;
    const access = Date.parse(paidThrough) > Date.now() ? "active" : "expired";
    effects.push(subscriptionWrite(env, owned, event, { paidThrough, access, grace: null, invoiceId: invoice.id }), tenantEntitlement(env, mapped.tenant_id, owned.order.plan_id, access), notice(env, mapped.tenant_id, event, "subscription_paid"));
  } else if (!paid && ["invoice.payment_failed", "invoice.payment_action_required"].includes(event.type) && ["past_due", "unpaid", "incomplete"].includes(owned.current.status) && objectId(owned.current.latest_invoice) === invoice.id) {
    // Never reopen or extend grace on repeated failures, and never grant a first unpaid subscription.
    const grace = owned.existing?.grace_expires_at ?? new Date(event.created * 1000 + 7 * 86400000).toISOString();
    const access = owned.existing?.paid_through && Date.parse(grace) > Date.now() ? "grace" : "paused";
    effects.push(subscriptionWrite(env, owned, event, { access, grace, invoiceId: invoice.id }), tenantEntitlement(env, mapped.tenant_id, owned.order.plan_id, access), notice(env, mapped.tenant_id, event, event.type === "invoice.payment_action_required" ? "payment_action_required" : "payment_failed"));
  }
  return effects;
}

async function adjustmentEffects(env: BillingEnv, event: StripeEvent, client: StripeClient, leasedTenantId: string): Promise<D1PreparedStatement[]> {
  const object = event.data.object; let intent = objectId(object.payment_intent);
  if (event.type.startsWith("charge.dispute") && !intent && objectId(object.charge)) intent = objectId((await client.request(`/v1/charges/${objectId(object.charge)}`)).payment_intent);
  let order: BillingOrder | null = null;
  let invoice: { stripe_invoice_id: string; tenant_id: string } | null = null;
  if (intent) {
    order = await env.AGENT_DB.prepare("SELECT * FROM agent_billing_orders WHERE stripe_payment_intent_id = ?").bind(intent).first<BillingOrder>();
    invoice = await env.AGENT_DB.prepare("SELECT stripe_invoice_id,tenant_id FROM agent_billing_invoices WHERE stripe_payment_intent_id = ?").bind(intent).first();
  }
  if (event.type.startsWith("credit_note.") && objectId(object.invoice)) invoice = await env.AGENT_DB.prepare("SELECT stripe_invoice_id,tenant_id FROM agent_billing_invoices WHERE stripe_invoice_id = ?").bind(objectId(object.invoice)).first();
  if (!order && !invoice) return [];
  const tenantId = order?.tenant_id ?? invoice!.tenant_id;
  if (tenantId !== leasedTenantId || (order && invoice && order.tenant_id !== invoice.tenant_id)) throw new HttpError(409, "adjustment_mapping_conflict", "The billing adjustment has inconsistent ownership and needs review.");
  const kind = event.type.startsWith("charge.dispute") ? "dispute" : event.type.startsWith("credit_note") ? "credit_note" : "refund";
  const amount = kind === "refund" ? object.amount_refunded ?? 0 : object.amount ?? 0;
  if (!Number.isSafeInteger(amount) || amount < 0) throw new HttpError(400, "invalid_adjustment", "Invalid billing adjustment.");
  const status = object.status ?? (object.refunded ? "refunded" : "partially_refunded");
  const effects = [stmt(env, `INSERT INTO agent_billing_adjustments (stripe_object_id,tenant_id,order_id,stripe_invoice_id,kind,status,amount_cents,event_created,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(stripe_object_id) DO UPDATE SET status=excluded.status,amount_cents=excluded.amount_cents,event_created=excluded.event_created,updated_at=excluded.updated_at WHERE excluded.event_created >= agent_billing_adjustments.event_created`, object.id, tenantId, order?.id ?? null, invoice?.stripe_invoice_id ?? null, kind, status, amount, event.created, new Date().toISOString()), notice(env, tenantId, event, `${kind}_review`)];
  if (order && kind === "refund") effects.push(stmt(env, "UPDATE agent_billing_orders SET refunded_cents = MAX(refunded_cents,?),status = CASE WHEN ? >= amount_cents THEN 'refunded' ELSE status END,updated_at = ? WHERE id = ?", amount, amount, new Date().toISOString(), order.id));
  if (kind === "dispute") {
    // Closing a dispute does not silently restore access; a reconciled paid invoice restores it after review.
    effects.push(stmt(env, "UPDATE agent_billing_subscriptions SET dispute_state = ?,access_state = 'paused',updated_at = ? WHERE tenant_id = ?", status, new Date().toISOString(), tenantId));
    effects.push(stmt(env, "UPDATE agent_tenants SET status = CASE WHEN status IN ('paused','offboarding','deleted') THEN status ELSE 'past-due' END,updated_at = ? WHERE id = ?", new Date().toISOString(), tenantId));
  }
  // Refunds/credits record the financial fact; no undocumented automatic clawback of paid-through downloads.
  return effects;
}

export async function processBillingEvent(env: BillingEnv, event: StripeEvent, injectedClient?: StripeClient): Promise<{ received: true; outcome: string }> {
  if (!(BILLING_EVENT_TYPES as readonly string[]).includes(event.type)) return { received: true, outcome: "unrelated_event" };
  if (event.account && event.account !== env.AGENT_STRIPE_ACCOUNT_ID) return { received: true, outcome: "unrelated_account" };
  if (event.livemode !== (env.ENVIRONMENT === "production")) throw new HttpError(400, "stripe_mode_mismatch", "Billing event environment mismatch.");
  const object = event.data.object;
  // Mixed/legacy metadata must not be allowed to bridge the two billing domains.
  try { assertNoLegacyMetadata(object.metadata); } catch { return { received: true, outcome: "unrelated_metadata" }; }
  const mapped = await knownCustomer(env, objectId(object.customer));
  const adjustment = /^(charge\.(refunded|dispute\.)|credit_note\.)/.test(event.type);
  // Tenant identity comes from server-created mappings, never solely provider metadata.
  let tenantId = mapped?.tenant_id;
  if (!tenantId && metadataIsOurs(object.metadata) && typeof object.metadata.mehyar_agent_order_id === "string") {
    const order = await env.AGENT_DB.prepare("SELECT tenant_id FROM agent_billing_orders WHERE id = ? AND tenant_id = ?").bind(object.metadata.mehyar_agent_order_id, object.metadata.mehyar_agent_tenant_id ?? "").first<{ tenant_id: string }>();
    tenantId = order?.tenant_id;
  }
  if (!tenantId && adjustment) {
    const intent = objectId(object.payment_intent);
    const source = intent ? await env.AGENT_DB.prepare("SELECT tenant_id FROM agent_billing_orders WHERE stripe_payment_intent_id = ? UNION SELECT tenant_id FROM agent_billing_invoices WHERE stripe_payment_intent_id = ? LIMIT 1").bind(intent, intent).first<{ tenant_id: string }>() : objectId(object.invoice) ? await env.AGENT_DB.prepare("SELECT tenant_id FROM agent_billing_invoices WHERE stripe_invoice_id = ?").bind(objectId(object.invoice)).first<{ tenant_id: string }>() : null;
    tenantId = source?.tenant_id;
  }
  if (!tenantId) return { received: true, outcome: "unrelated_customer" };
  if (event.api_version && event.api_version !== STRIPE_API_VERSION) throw new HttpError(400, "stripe_version_mismatch", "The new billing destination must use its pinned API version.");
  const hash = await digest(JSON.stringify(event)); const now = new Date(); const token = crypto.randomUUID();
  await env.AGENT_DB.prepare("INSERT INTO agent_inbox (provider,event_id,payload_json,status,received_at,payload_hash) VALUES (?,?,?,'pending',?,?) ON CONFLICT(provider,event_id) DO NOTHING").bind(PROVIDER, event.id, JSON.stringify({ id: event.id, type: event.type, object_id: object.id, created: event.created, livemode: event.livemode }), now.toISOString(), hash).run();
  const inbox = await env.AGENT_DB.prepare("SELECT status,payload_hash FROM agent_inbox WHERE provider = ? AND event_id = ?").bind(PROVIDER, event.id).first<{ status: string; payload_hash: string }>();
  if (inbox?.payload_hash !== hash) throw new HttpError(409, "event_id_conflict", "Billing event identifier conflict.");
  if (inbox.status === "processed") return { received: true, outcome: "duplicate" };
  const claim = await env.AGENT_DB.prepare("UPDATE agent_inbox SET status = 'processing',processing_token = ?,lease_expires_at = ?,attempts = attempts + 1 WHERE provider = ? AND event_id = ? AND (status IN ('pending','failed') OR (status = 'processing' AND lease_expires_at <= ?))").bind(token, new Date(now.getTime() + 120000).toISOString(), PROVIDER, event.id, now.toISOString()).run();
  if (!claim.meta.changes) throw new HttpError(503, "event_processing", "Billing event is already being processed. Retry later.");
  try {
    const tenantClaim = await env.AGENT_DB.prepare("INSERT INTO agent_billing_tenant_leases (tenant_id,processing_token,expires_at) VALUES (?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET processing_token=excluded.processing_token,expires_at=excluded.expires_at WHERE agent_billing_tenant_leases.expires_at <= ?").bind(tenantId, token, new Date(now.getTime() + 120000).toISOString(), now.toISOString()).run();
    if (!tenantClaim.meta.changes) throw new HttpError(503, "tenant_billing_busy", "Another billing event for this business is processing. Retry later.");
    const client = configuredClient(env, injectedClient);
    let effects: D1PreparedStatement[] = [];
    if (event.type.startsWith("checkout.session.")) effects = await checkoutEffects(env, event, client);
    else if (event.type.startsWith("customer.subscription.")) effects = await subscriptionEffects(env, event, client);
    else if (event.type.startsWith("invoice.")) effects = await invoiceEffects(env, event, client);
    else effects = await adjustmentEffects(env, event, client, tenantId);
    // All financial state and the inbox completion commit in one D1 transaction.
    const commitTime = new Date().toISOString();
    // A NOT NULL fence fails the entire transaction if this processor lost its lease.
    const fence = stmt(env, "INSERT INTO agent_billing_event_fences (event_id,processing_token) VALUES (?,(SELECT i.processing_token FROM agent_inbox i JOIN agent_billing_tenant_leases l ON l.tenant_id = ? WHERE i.provider = ? AND i.event_id = ? AND i.processing_token = ? AND i.lease_expires_at > ? AND l.processing_token = ? AND l.expires_at > ?)) ON CONFLICT(event_id) DO UPDATE SET processing_token = excluded.processing_token", event.id, tenantId, PROVIDER, event.id, token, commitTime, token, commitTime);
    await env.AGENT_DB.batch([fence, ...effects, stmt(env, "UPDATE agent_inbox SET status = 'processed',processed_at = ?,processing_token = NULL,lease_expires_at = NULL,last_error_code = NULL WHERE provider = ? AND event_id = ? AND processing_token = ?", commitTime, PROVIDER, event.id, token), stmt(env, "DELETE FROM agent_billing_tenant_leases WHERE tenant_id = ? AND processing_token = ?", tenantId, token)]);
    return { received: true, outcome: effects.length ? "processed" : "unrelated_or_unready" };
  } catch (error) {
    await env.AGENT_DB.prepare("DELETE FROM agent_billing_tenant_leases WHERE tenant_id = ? AND processing_token = ?").bind(tenantId, token).run();
    await env.AGENT_DB.prepare("UPDATE agent_inbox SET status = 'failed',last_error_code = ?,processing_token = NULL,lease_expires_at = NULL WHERE provider = ? AND event_id = ? AND processing_token = ?").bind(error instanceof HttpError ? error.code : "processing_failed", PROVIDER, event.id, token).run();
    throw error;
  }
}
