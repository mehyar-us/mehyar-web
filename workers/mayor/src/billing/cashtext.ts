import type {Actor} from '../env';
import {digest,HttpError} from '../http';
import {BILLING_ROLES,requireMembership} from '../permissions';
import {CASHTEXT_DOMAIN,CASHTEXT_PRICE_CENTS,CASHTEXT_PRICE_VERSION} from './plans';
import {acquireLease,commitLease,releaseLease} from './locking';
import {assertAccount,ensureCustomer} from './service';
import {assertMode,baseConfiguration,clientFor,mode,objectId,stripeUrl,type BillingEnv,type StripeClient,type StripeEvent,type StripeObject} from './stripe';
import {emitEngineEventOnce,recordEngineEventOnceStatement} from '../engine-events';
import {cashtextDraftHealth} from '../cashtext/health';

/* CashText module billing (integration spec §5.1): a SEPARATE subscription
 * on its own domain — never a second item on the Pro subscription, whose
 * fulfillment contract (subscriptionEffects) hard-rejects items.length!==1.
 * Phase 0 landed the configuration, the price assertion, and the events-
 * router claim seam; Phase 1 replaces the seam with the real fulfillment
 * branch: createModuleCheckout (cloned from createCheckout's discipline),
 * the mayor_cashtext_subscriptions write + commitment + engine-event refs,
 * and the entitlement read the module gate uses. subscriptionEffects and
 * the $99 funnel are untouched; module money never shares an object with
 * the Pro domain or with the tenant's Connect merchant money. */
export {CASHTEXT_DOMAIN};
export function cashtextConfiguration(env:BillingEnv){const base=baseConfiguration(env);if(!/^price_[A-Za-z0-9]+$/.test(env.MAYOR_STRIPE_CASHTEXT_PRICE_ID??''))throw new HttpError(503,'cashtext_not_ready','CashText is being prepared.');return {...base,priceId:env.MAYOR_STRIPE_CASHTEXT_PRICE_ID!};}
export function assertCashTextPrice(price:StripeObject,env:BillingEnv){const config=cashtextConfiguration(env);assertMode(price,config.mode);if(price.id!==config.priceId||price.active!==true||price.currency!=='usd'||price.unit_amount!==CASHTEXT_PRICE_CENTS||price.type!=='recurring'||price.recurring?.interval!=='month'||price.recurring?.interval_count!==1||price.billing_scheme!=='per_unit'||price.tax_behavior==='inclusive')throw new HttpError(409,'cashtext_price_mismatch','The CashText price could not be verified.');}
interface CashTextCheckout {id:string;tenant_id:string;mode:'test'|'live';request_id:string;status:string;stripe_session_id:string|null;checkout_url:string|null;expires_at:number|null;provider_started_at:number|null;created_at:string;}
interface CashTextSubscription {tenant_id:string;mode:'test'|'live';stripe_subscription_id:string;stripe_customer_id:string;checkout_id:string;status:string;cancel_at_period_end:number;last_event_created:number;updated_at:string;}
function cashtextMetadata(row:Pick<CashTextCheckout,'id'|'tenant_id'>){return {mayor_billing_domain:CASHTEXT_DOMAIN,mayor_tenant_id:row.tenant_id,mayor_module_checkout_id:row.id,mayor_price_version:CASHTEXT_PRICE_VERSION};}
function assertCashTextMetadata(object:StripeObject,row:Pick<CashTextCheckout,'id'|'tenant_id'>){const expected=cashtextMetadata(row);for(const [name,value] of Object.entries(expected))if(object.metadata?.[name]!==value)throw new HttpError(409,'cashtext_ownership_mismatch','CashText payment ownership could not be verified.');}
function assertSubscriptionMetadata(object:StripeObject,tenantId:string){if(object.metadata?.mayor_billing_domain!==CASHTEXT_DOMAIN||object.metadata?.mayor_tenant_id!==tenantId||!object.metadata?.mayor_module_checkout_id||object.metadata?.mayor_price_version!==CASHTEXT_PRICE_VERSION)throw new HttpError(409,'cashtext_ownership_mismatch','CashText payment ownership could not be verified.');}
/* Entitlement (spec §5.1): an active/trialing row entitles outright; a
 * past_due row entitles only inside its grace window — 7 days from the
 * last verified Stripe state change recorded on the row (the module
 * table carries no period-end column, so the grace keys to the row's
 * own verified update, the only honest clock it has). Everything else
 * (incomplete, unpaid, paused, canceled, incomplete_expired) does not
 * entitle, and neither does the absence of a row. */
export const CASHTEXT_PAST_DUE_GRACE_MS=7*24*3600*1000;
export function cashtextEntitled(subscription:Pick<CashTextSubscription,'status'|'updated_at'>|null|undefined,now=Date.now()):boolean{
 if(!subscription)return false;
 if(subscription.status==='active'||subscription.status==='trialing')return true;
 if(subscription.status==='past_due')return now-Date.parse(subscription.updated_at)<CASHTEXT_PAST_DUE_GRACE_MS;
 return false;
}
export async function cashtextEntitlement(env:BillingEnv,tenantId:string,now=Date.now()):Promise<boolean>{
 const selected=mode(env);if(!selected)return false;
 const row=await env.AGENT_DB.prepare('SELECT status,updated_at FROM mayor_cashtext_subscriptions WHERE tenant_id=? AND mode=?').bind(tenantId,selected).first<Pick<CashTextSubscription,'status'|'updated_at'>>().catch(()=>null);
 return cashtextEntitled(row,now);
}
/** The owner-facing module state for /billing's Modules section (§5.5):
 * honest by construction — not subscribed until a verified subscription
 * row says so; a pending checkout is named as pending, never as active.
 * The settings read degrades to not_connected until migration 0078 has
 * applied on the serving database (Connect itself lands in Phase 2). */
export async function cashtextStatus(env:BillingEnv,actor:Actor,canManage:boolean,now=Date.now(),injected?:StripeClient){
 const selected=mode(env);
 const subscription=selected?await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_subscriptions WHERE tenant_id=? AND mode=?').bind(actor.tenantId,selected).first<CashTextSubscription>().catch(()=>null):null;
 const pending=selected?await env.AGENT_DB.prepare("SELECT request_id,checkout_url FROM mayor_cashtext_checkouts WHERE tenant_id=? AND mode=? AND status IN ('pending','open') AND (expires_at IS NULL OR expires_at>?)").bind(actor.tenantId,selected,Math.floor(now/1000)).first<{request_id:string;checkout_url:string|null}>().catch(()=>null):null;
 let settings=await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_settings WHERE tenant_id=?').bind(actor.tenantId).first<CashTextSettings>().catch(()=>null);
 // Read-on-view refresh (spec §3.5): a linked account's stored state is
 // re-read from Stripe when the owner views billing — this is what makes
 // the return from Stripe onboarding show the fresh state. account.updated
 // events keep it current between views. A failed refresh keeps the
 // stored state; the status read itself never fails over it.
 if(settings?.stripe_account_id){const refreshed=await syncConnectAccount(env,actor.tenantId,injected).catch(()=>null);if(refreshed)settings=refreshed;}
 let ready=false;try{cashtextConfiguration(env);ready=true;}catch{}
 const draftHealth=await cashtextDraftHealth(env.AGENT_DB,actor.tenantId).catch(()=>null);
 return {id:'cashtext',name:'CashText',draftHealth,priceCents:CASHTEXT_PRICE_CENTS,currency:'USD',interval:'month',ready,subscribed:cashtextEntitled(subscription,now),status:subscription?.status??'not_subscribed',cancelAtPeriodEnd:Boolean(subscription?.cancel_at_period_end),connect:{status:settings?.account_status??'not_connected',chargesEnabled:Boolean(settings?.charges_enabled),payoutsEnabled:Boolean(settings?.payouts_enabled),accountLinked:Boolean(settings?.stripe_account_id),onboardingOpen:CASHTEXT_CONNECT_TERMS_GATE_OPEN},checkout:{pending:Boolean(pending),...(pending&&canManage?{requestId:pending.request_id,...(pending.checkout_url?{url:stripeUrl(pending.checkout_url,'checkout.stripe.com')}:{})}:{})}};
}
export async function createModuleCheckout(env:BillingEnv,actor:Actor,requestId:string,injected?:StripeClient,consentGranted=false){
 await requireMembership(env,actor,BILLING_ROLES);
 const config=cashtextConfiguration(env),client=clientFor(env,injected);await assertAccount(env,client);
 // An existing live module subscription is managed, not re-bought — the
 // Pro domain's subscription_exists discipline, on the module's own row.
 const existing=await env.AGENT_DB.prepare('SELECT status FROM mayor_cashtext_subscriptions WHERE tenant_id=? AND mode=?').bind(actor.tenantId,config.mode).first<{status:string}>();
 if(existing&&/^(active|past_due|unpaid|paused|incomplete|trialing)$/.test(existing.status))throw new HttpError(409,'cashtext_subscription_exists','CashText is already on for this business. Manage it in Plan & usage.');
 let row=await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_checkouts WHERE tenant_id=? AND mode=? AND request_id=?').bind(actor.tenantId,config.mode,requestId).first<CashTextCheckout>();
 if(row?.checkout_url&&row.status==='open'&&(row.expires_at??0)>Date.now()/1000){
  const replayDirectives=await emitEngineEventOnce(env,{tenantId:actor.tenantId,actorId:actor.userId,type:'begin_checkout',resourceId:row.id,consentGranted,valueCents:CASHTEXT_PRICE_CENTS,itemRef:'cashtext_module',itemName:'CashText module'});
  return {url:stripeUrl(row.checkout_url,'checkout.stripe.com'),requestId,replay:true,...(replayDirectives.length?{analyticsEvents:replayDirectives}:{})};
 }
 if(row&&!['pending','open'].includes(row.status))throw new HttpError(409,'cashtext_checkout_resolved','This CashText checkout has ended. Start a new request.');
 if(!row){
  const pending=await env.AGENT_DB.prepare("SELECT * FROM mayor_cashtext_checkouts WHERE tenant_id=? AND mode=? AND status IN ('pending','open')").bind(actor.tenantId,config.mode).first<CashTextCheckout>();
  if(pending?.stripe_session_id){const remote=await client.request(`/v1/checkout/sessions/${pending.stripe_session_id}`);assertMode(remote,config.mode);assertCashTextMetadata(remote,pending);if(remote.status==='expired')await env.AGENT_DB.prepare("UPDATE mayor_cashtext_checkouts SET status='expired',updated_at=? WHERE id=? AND status='open'").bind(new Date().toISOString(),pending.id).run();else throw new HttpError(409,'checkout_pending','A CashText checkout is already open. Return to it or check billing status.');}
  else if(pending)throw new HttpError(409,'checkout_pending','A CashText checkout request is already being prepared. Retry its original request.');
  const id=crypto.randomUUID(),created=new Date().toISOString();try{await env.AGENT_DB.prepare("INSERT INTO mayor_cashtext_checkouts(id,tenant_id,mode,request_id,status,created_at,updated_at) VALUES(?,?,?,?,'pending',?,?)").bind(id,actor.tenantId,config.mode,requestId,created,created).run();}catch{const same=await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_checkouts WHERE tenant_id=? AND mode=? AND request_id=?').bind(actor.tenantId,config.mode,requestId).first<CashTextCheckout>();if(!same)throw new HttpError(409,'checkout_pending','A CashText checkout is already open. Return to it or check billing status.');}
  row=await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_checkouts WHERE tenant_id=? AND mode=? AND request_id=?').bind(actor.tenantId,config.mode,requestId).first<CashTextCheckout>();
 }
 if(!row)throw new HttpError(503,'cashtext_checkout_unavailable','CashText checkout is temporarily unavailable.');
 if(row.provider_started_at&&Date.now()-row.provider_started_at>23*3600000)throw new HttpError(409,'cashtext_checkout_needs_review','This CashText checkout needs a billing status check before it can be retried.');
 assertCashTextPrice(await client.request(`/v1/prices/${config.priceId}`),env);const customer=await ensureCustomer(env,actor,client),origin=new URL(env.APP_ORIGIN).origin;
 await env.AGENT_DB.prepare('UPDATE mayor_cashtext_checkouts SET provider_started_at=COALESCE(provider_started_at,?),updated_at=? WHERE id=?').bind(Date.now(),new Date().toISOString(),row.id).run();
 const metadata=cashtextMetadata(row);
 const session=await client.request('/v1/checkout/sessions','POST',{mode:'subscription',customer,line_items:[{price:config.priceId,quantity:1}],allowed_payment_method_types:['card'],metadata,subscription_data:{metadata},success_url:`${origin}/?billing=module-success&business=${encodeURIComponent(actor.tenantId)}`,cancel_url:`${origin}/?billing=module-canceled&business=${encodeURIComponent(actor.tenantId)}`,client_reference_id:row.id,custom_text:{submit:{message:`CashText is $${CASHTEXT_PRICE_CENTS/100} per month, billed as its own subscription, separate from your Mayor plan. It ends at the period end when you cancel. Your customers pay your own Stripe account.`}}},`mayor-pwa:cashtext:${config.mode}:${row.id}`);
 assertMode(session,config.mode);assertCashTextMetadata(session,row);if(!/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(session.id??'')||objectId(session.customer)!==customer||session.mode!=='subscription'||session.client_reference_id!==row.id||!Number.isSafeInteger(session.expires_at))throw new HttpError(502,'cashtext_checkout_invalid','CashText checkout could not be verified.');const url=stripeUrl(session.url,'checkout.stripe.com');
 await env.AGENT_DB.prepare("UPDATE mayor_cashtext_checkouts SET stripe_session_id=?,checkout_url=?,expires_at=?,status='open',updated_at=? WHERE id=? AND status='pending'").bind(session.id,url,session.expires_at,new Date().toISOString(),row.id).run();
 const directives=await emitEngineEventOnce(env,{tenantId:actor.tenantId,actorId:actor.userId,type:'begin_checkout',resourceId:row.id,consentGranted,valueCents:CASHTEXT_PRICE_CENTS,itemRef:'cashtext_module',itemName:'CashText module'});
 return {url,requestId,replay:false,...(directives.length?{analyticsEvents:directives}:{})};
}
/** Module cancel toggle (§5.1): cancel lands at period end — the verified
 * Stripe response is written back to the module row; access ends when
 * Stripe ends the subscription and the deleted event syncs the row. */
export async function setCashTextCancelAtPeriodEnd(env:BillingEnv,actor:Actor,requestId:string,cancel:boolean,injected?:StripeClient){
 await requireMembership(env,actor,BILLING_ROLES);const config=cashtextConfiguration(env),client=clientFor(env,injected);await assertAccount(env,client);
 const row=await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_subscriptions WHERE tenant_id=? AND mode=?').bind(actor.tenantId,config.mode).first<CashTextSubscription>();if(!row)throw new HttpError(404,'cashtext_subscription_missing','This business has no CashText subscription.');
 const updated=await client.request(`/v1/subscriptions/${row.stripe_subscription_id}`,'POST',{cancel_at_period_end:cancel},`mayor-pwa:cashtext-cancel:${config.mode}:${actor.tenantId}:${requestId}`);
 assertMode(updated,config.mode);assertSubscriptionMetadata(updated,actor.tenantId);if(updated.id!==row.stripe_subscription_id||typeof updated.cancel_at_period_end!=='boolean')throw new HttpError(502,'cashtext_cancel_invalid','The CashText change could not be verified.');
 await env.AGENT_DB.prepare('UPDATE mayor_cashtext_subscriptions SET status=?,cancel_at_period_end=?,updated_at=? WHERE tenant_id=? AND mode=? AND stripe_subscription_id=?').bind(updated.status,updated.cancel_at_period_end?1:0,new Date().toISOString(),actor.tenantId,config.mode,row.stripe_subscription_id).run();
 return cashtextStatus(env,actor,true);
}
function invoiceSubscription(invoice:StripeObject){return objectId(invoice.parent?.subscription_details?.subscription)??objectId(invoice.subscription);}
function linePrice(line:StripeObject){return objectId(line.pricing?.price_details?.price)??objectId(line.price);}
/* The fulfillment core, cloned from subscriptionEffects' contract
 * discipline and pointed at the module's own tables: exactly one line at
 * exactly the module price, the paid-invoice contract verified whole, the
 * commitment + purchase event recorded once per checkout. An unpaid
 * invoice never completes the checkout and never writes a commitment —
 * the subscription row still syncs its real (non-entitling) status. */
export async function cashtextSubscriptionEffects(env:BillingEnv,tenantId:string,subscriptionId:string,eventCreated:number,injected?:StripeClient,invoiceId?:string):Promise<D1PreparedStatement[]>{
 const config=cashtextConfiguration(env),client=clientFor(env,injected);await assertAccount(env,client);
 const subscription=await client.request(`/v1/subscriptions/${subscriptionId}?expand[]=items.data.price`);assertMode(subscription,config.mode);assertSubscriptionMetadata(subscription,tenantId);
 const customerId=objectId(subscription.customer),customer=await env.AGENT_DB.prepare('SELECT stripe_customer_id FROM mayor_billing_customers WHERE tenant_id=? AND mode=?').bind(tenantId,config.mode).first<{stripe_customer_id:string}>();if(!customerId||customer?.stripe_customer_id!==customerId)throw new HttpError(409,'cashtext_customer_mismatch','CashText ownership could not be verified.');
 const remoteCustomer=await client.request(`/v1/customers/${customerId}`);assertMode(remoteCustomer,config.mode);if(remoteCustomer.metadata?.mayor_tenant_id!==tenantId)throw new HttpError(409,'cashtext_ownership_mismatch','CashText payment ownership could not be verified.');
 const items:StripeObject[]=subscription.items?.data??[];if(subscription.items?.has_more||items.length!==1||items[0].quantity!==1)throw new HttpError(409,'cashtext_price_mismatch','The subscription does not match the CashText module.');
 const subPriceId=objectId(items[0].price);if(subPriceId!==config.priceId)throw new HttpError(409,'cashtext_price_mismatch','The subscription does not match the CashText module.');
 assertCashTextPrice(typeof items[0].price==='object'?items[0].price:await client.request(`/v1/prices/${config.priceId}`),env);
 const checkout=await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_checkouts WHERE id=? AND tenant_id=? AND mode=?').bind(subscription.metadata.mayor_module_checkout_id,tenantId,config.mode).first<CashTextCheckout>();if(!checkout?.stripe_session_id)throw new HttpError(409,'cashtext_checkout_unmapped','This CashText payment is waiting for its checkout record.');
 const session=await client.request(`/v1/checkout/sessions/${checkout.stripe_session_id}`);assertMode(session,config.mode);assertCashTextMetadata(session,checkout);if(session.status!=='complete'||session.mode!=='subscription'||session.client_reference_id!==checkout.id||objectId(session.customer)!==customerId||objectId(session.subscription)!==subscriptionId)throw new HttpError(409,'cashtext_checkout_unconfirmed','The CashText checkout has not been confirmed yet.');
 const existing=await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_subscriptions WHERE tenant_id=? AND mode=?').bind(tenantId,config.mode).first<CashTextSubscription>();
 if(existing&&existing.stripe_subscription_id===subscriptionId&&eventCreated<existing.last_event_created)return [];
 if(existing&&existing.stripe_subscription_id!==subscriptionId){const prior=await env.AGENT_DB.prepare('SELECT created_at FROM mayor_cashtext_checkouts WHERE id=?').bind(existing.checkout_id).first<{created_at:string}>();if((prior?.created_at??'')>=checkout.created_at)return [];if(!['canceled','incomplete_expired'].includes(existing.status))throw new HttpError(409,'cashtext_subscription_conflict','Another CashText subscription needs review.');}
 const now=new Date().toISOString(),effects=[env.AGENT_DB.prepare(`INSERT INTO mayor_cashtext_subscriptions(tenant_id,mode,stripe_subscription_id,stripe_customer_id,checkout_id,status,cancel_at_period_end,last_event_created,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,mode) DO UPDATE SET stripe_subscription_id=excluded.stripe_subscription_id,stripe_customer_id=excluded.stripe_customer_id,checkout_id=excluded.checkout_id,status=excluded.status,cancel_at_period_end=excluded.cancel_at_period_end,last_event_created=MAX(last_event_created,excluded.last_event_created),updated_at=excluded.updated_at`).bind(tenantId,config.mode,subscriptionId,customerId,checkout.id,subscription.status,subscription.cancel_at_period_end?1:0,eventCreated,now)];
 const latest=invoiceId??objectId(subscription.latest_invoice);if(!latest)return effects;
 const invoice=await client.request(`/v1/invoices/${latest}?expand[]=payments`);assertMode(invoice,config.mode);if(invoice.id!==latest||objectId(invoice.customer)!==customerId||invoiceSubscription(invoice)!==subscriptionId)throw new HttpError(409,'cashtext_invoice_mismatch','The CashText invoice could not be matched to this business.');
 if(invoice.status!=='paid')return effects;
 const lines:StripeObject[]=invoice.lines?.data??[],line=lines[0],start=line?.period?.start,end=line?.period?.end;
 if(invoice.currency!=='usd'||invoice.subtotal!==CASHTEXT_PRICE_CENTS||invoice.total<CASHTEXT_PRICE_CENTS||invoice.amount_paid<invoice.total||invoice.amount_remaining!==0||invoice.paid_out_of_band===true||!['subscription_create','subscription_cycle'].includes(invoice.billing_reason)||invoice.lines?.has_more||lines.length!==1||linePrice(line)!==config.priceId||line.quantity!==1||line.amount!==CASHTEXT_PRICE_CENTS||line.currency!=='usd'||line.parent?.subscription_item_details?.proration===true||line.proration===true||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<=start||end-start>32*86400)throw new HttpError(409,'cashtext_paid_invoice_contract_mismatch','The paid CashText invoice does not match a full module period.');
 const payments:StripeObject[]=invoice.payments?.data??[],payment=payments.find(row=>row.status==='paid'&&row.payment?.type==='payment_intent'&&row.currency===invoice.currency&&objectId(row.invoice)===invoice.id&&row.amount_paid>=invoice.total),intentId=objectId(payment?.payment?.payment_intent);if(!intentId||invoice.payments?.has_more)throw new HttpError(409,'cashtext_payment_unverified','The CashText invoice payment has not been verified.');assertMode(payment!,config.mode);
 const intent=await client.request(`/v1/payment_intents/${intentId}`);assertMode(intent,config.mode);if(intent.id!==intentId||intent.status!=='succeeded'||intent.currency!=='usd'||intent.amount_received<invoice.total||objectId(intent.customer)!==customerId)throw new HttpError(409,'cashtext_payment_unverified','The CashText invoice payment has not been verified.');
 effects.push(env.AGENT_DB.prepare("UPDATE mayor_cashtext_checkouts SET status='completed',updated_at=? WHERE id=?").bind(now,checkout.id));
 // Commitments (§5.4, migration 0076 pattern): one row per fulfilled
 // module checkout, deterministic id + INSERT OR IGNORE — replays,
 // syncs, and renewals re-run this path and can never duplicate it.
 effects.push(env.AGENT_DB.prepare("INSERT OR IGNORE INTO mayor_commitments(id,tenant_id,kind,plan_ref,amount_cents,resource_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?, 'fulfilled',?,?)").bind(`purchase-intent:${checkout.id}`,tenantId,'module_subscription','cashtext',CASHTEXT_PRICE_CENTS,checkout.id,now,now));
 // Engine events (§5.4): the purchase itself, recorded once per module
 // checkout in the same atomic batch (item ref cashtext_module is
 // re-derived by pendingPurchaseDirectives from this row's resource).
 effects.push(recordEngineEventOnceStatement(env,{tenantId,actorId:'system',type:'purchase_completed',resourceId:checkout.id,at:now}));
 return effects;
}
export async function cashtextSessionEffects(env:BillingEnv,row:CashTextCheckout,client:StripeClient,eventCreated:number):Promise<D1PreparedStatement[]>{
 const config=cashtextConfiguration(env);await assertAccount(env,client);
 const session=await client.request(`/v1/checkout/sessions/${row.stripe_session_id}`);assertMode(session,config.mode);assertCashTextMetadata(session,row);
 const customer=await env.AGENT_DB.prepare('SELECT stripe_customer_id FROM mayor_billing_customers WHERE tenant_id=? AND mode=?').bind(row.tenant_id,row.mode).first<{stripe_customer_id:string}>();
 if(session.id!==row.stripe_session_id||session.mode!=='subscription'||objectId(session.customer)!==customer?.stripe_customer_id||session.client_reference_id!==row.id)throw new HttpError(409,'cashtext_ownership_mismatch','CashText payment ownership could not be verified.');
 const updated=new Date().toISOString();if(session.status==='expired')return [env.AGENT_DB.prepare("UPDATE mayor_cashtext_checkouts SET status='expired',updated_at=? WHERE id=? AND status IN ('pending','open')").bind(updated,row.id)];
 // An open session (a declined or abandoned card entry) fulfills
 // nothing: no subscription row is written, no commitment exists, and
 // the checkout stays resumable — the honest owner-facing state.
 if(session.status!=='complete')return [];
 const subscriptionId=objectId(session.subscription);if(!subscriptionId)throw new HttpError(409,'cashtext_checkout_unconfirmed','The CashText checkout has not been confirmed yet.');
 return cashtextSubscriptionEffects(env,row.tenant_id,subscriptionId,eventCreated,client);
}
/* The events-router branch (spec §5.1): claims CashText sessions,
 * subscriptions, and invoices — a claimed event with no checkout row
 * fails loud (409) instead of falling through to the Pro domain; every
 * foreign event returns null. Dedupe + tenant lease mirror the credits
 * branch exactly (mayor_billing_events payload-hash ledger). */
export async function processCashTextEvent(env:BillingEnv,event:StripeEvent,injected?:StripeClient){
 const config=baseConfiguration(env),object=event.data.object;let row:CashTextCheckout|null=null,subscriptionRow:CashTextSubscription|null=null,tenantId:string|undefined,subscriptionId:string|undefined,invoiceId:string|undefined;
 if(event.type.startsWith('checkout.session.')){
  row=await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_checkouts WHERE stripe_session_id=? AND mode=?').bind(object.id,config.mode).first<CashTextCheckout>();
  if(!row){if(object.metadata?.mayor_billing_domain===CASHTEXT_DOMAIN)throw new HttpError(409,'cashtext_checkout_unmapped','This CashText payment is waiting for its checkout record.');return null;}
  tenantId=row.tenant_id;
 }else if(event.type.startsWith('customer.subscription.')){
  subscriptionRow=await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_subscriptions WHERE stripe_subscription_id=? AND mode=?').bind(object.id,config.mode).first<CashTextSubscription>();
  if(!subscriptionRow&&object.metadata?.mayor_billing_domain!==CASHTEXT_DOMAIN)return null;
  tenantId=subscriptionRow?.tenant_id??object.metadata?.mayor_tenant_id;subscriptionId=object.id;
  if(!tenantId||!/^[a-f0-9]{32}$/.test(tenantId))throw new HttpError(409,'cashtext_checkout_unmapped','This CashText payment is waiting for its checkout record.');
 }else if(event.type.startsWith('invoice.')){
  subscriptionId=invoiceSubscription(object);if(!subscriptionId)return null;
  subscriptionRow=await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_subscriptions WHERE stripe_subscription_id=? AND mode=?').bind(subscriptionId,config.mode).first<CashTextSubscription>();
  if(!subscriptionRow)return null;
  tenantId=subscriptionRow.tenant_id;invoiceId=object.id;
 }else return null;
 const client=clientFor(env,injected),hash=await digest(JSON.stringify(event)),updated=new Date().toISOString(),token=crypto.randomUUID();
 await env.AGENT_DB.prepare("INSERT INTO mayor_billing_events(mode,event_id,payload_hash,status,event_type,received_at) VALUES(?,?,?,'pending',?,?) ON CONFLICT(mode,event_id) DO NOTHING").bind(config.mode,event.id,hash,event.type,updated).run();const stored=await env.AGENT_DB.prepare('SELECT payload_hash,status FROM mayor_billing_events WHERE mode=? AND event_id=?').bind(config.mode,event.id).first<{payload_hash:string;status:string}>();if(stored?.payload_hash!==hash)throw new HttpError(409,'billing_event_conflict','This CashText event needs review.');if(stored.status==='processed')return {received:true,outcome:'duplicate'};
 const claimed=await env.AGENT_DB.prepare("UPDATE mayor_billing_events SET status='processing',processing_token=?,lease_expires_at=?,error_code=NULL WHERE mode=? AND event_id=? AND (status IN ('pending','failed') OR (status='processing' AND lease_expires_at<=?))").bind(token,Date.now()+120000,config.mode,event.id,Date.now()).run();if(!claimed.meta.changes)throw new HttpError(503,'billing_event_busy','The CashText payment is being processed.');let lease:string|undefined;
 try{lease=await acquireLease(env,tenantId,config.mode);let effects:D1PreparedStatement[];
  if(row)effects=await cashtextSessionEffects(env,row,client,event.created);
  else effects=await cashtextSubscriptionEffects(env,tenantId,subscriptionId!,event.created,client,invoiceId);
  const fence=`${token}:cashtext-event`;effects.unshift(env.AGENT_DB.prepare('INSERT INTO mayor_billing_fences(token,verified_token) VALUES(?,(SELECT processing_token FROM mayor_billing_events WHERE mode=? AND event_id=? AND processing_token=? AND lease_expires_at>?))').bind(fence,config.mode,event.id,token,Date.now()));effects.push(env.AGENT_DB.prepare("UPDATE mayor_billing_events SET status='processed',processing_token=NULL,lease_expires_at=NULL WHERE mode=? AND event_id=? AND processing_token=?").bind(config.mode,event.id,token),env.AGENT_DB.prepare('DELETE FROM mayor_billing_fences WHERE token=?').bind(fence));await commitLease(env,tenantId,config.mode,lease,effects);return {received:true,outcome:'processed'};
 }catch(error){if(lease)await releaseLease(env,tenantId,config.mode,lease);await env.AGENT_DB.prepare("UPDATE mayor_billing_events SET status='failed',processing_token=NULL,lease_expires_at=NULL,error_code=? WHERE mode=? AND event_id=? AND processing_token=?").bind(error instanceof HttpError?error.code:'cashtext_processing_failed',config.mode,event.id,token).run();throw error;}
}

/* ── Stripe Connect (integration spec §3.5, Phase 2) ─────────────────────
 * The tenant is the merchant of record for their own invoices: their
 * customers pay the tenant's connected Express account, never the
 * platform. All Connect calls ride the platform key plus the Phase 0
 * {stripeAccount} header extension — the only transport change — and
 * the platform-account assertion (assertAccount) stays platform-only:
 * it is called without the header, exactly as in the module billing
 * paths above. No application fee is taken (decision D3), and no code
 * here refunds, disputes, or otherwise touches a tenant's money.
 *
 * THE GATE ON OPENING: onboarding opens to real tenants ONLY when the
 * R4 Terms sentence (tenant = merchant of record) is served on the
 * shared mehyar.us Terms page. Probed 2026-10-23 during this phase:
 * the served https://mehyar.us/terms/ bytes contain no merchant-of-
 * record sentence and no CashText mention — the gate is CLOSED. The
 * onboarding function refuses (503 cashtext_connect_not_ready) and
 * the Modules card says so plainly until a later phase flips this
 * constant on served-bytes evidence. The webhook handler and status
 * sync are not gated: they only ever mirror state for accounts that
 * exist, and no account can be created while the gate is closed. */
export const CASHTEXT_CONNECT_TERMS_GATE_OPEN=false;
export const CASHTEXT_CONNECT_RETURN_PATH='/billing?module=cashtext';
export interface CashTextSettings {tenant_id:string;stripe_account_id:string|null;account_status:string;charges_enabled:number;payouts_enabled:number;summary_enabled:number;created_at:string;updated_at:string;}
/** The account-status derivation, shared by read-on-view sync and the
 * account.updated webhook: charges live + details in ⇒ active; Stripe
 * has disabled requirements ⇒ restricted; anything else with an
 * account on file ⇒ pending (onboarding incomplete). */
export function deriveConnectAccountStatus(account:StripeObject):'active'|'restricted'|'pending'{
 if(account.requirements?.disabled_reason)return 'restricted';
 if(account.charges_enabled&&account.details_submitted)return 'active';
 return 'pending';
}
function connectAccountEffects(env:BillingEnv,tenantId:string,account:StripeObject):D1PreparedStatement{
 return env.AGENT_DB.prepare('UPDATE mayor_cashtext_settings SET account_status=?,charges_enabled=?,payouts_enabled=?,updated_at=? WHERE tenant_id=? AND stripe_account_id=?')
  .bind(deriveConnectAccountStatus(account),account.charges_enabled?1:0,account.payouts_enabled?1:0,new Date().toISOString(),tenantId,account.id);
}
/** Read one connected account back from Stripe and mirror its state
 * into mayor_cashtext_settings. Platform-level read (no Stripe-Account
 * header — /v1/accounts/:id is a platform call). Returns the fresh row,
 * or null when the tenant has no linked account. */
export async function syncConnectAccount(env:BillingEnv,tenantId:string,injected?:StripeClient):Promise<CashTextSettings|null>{
 const row=await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_settings WHERE tenant_id=?').bind(tenantId).first<CashTextSettings>();if(!row?.stripe_account_id)return row;
 const config=baseConfiguration(env),client=clientFor(env,injected);
 const account=await client.request(`/v1/accounts/${row.stripe_account_id}`);assertMode(account,config.mode);
 if(account.id!==row.stripe_account_id)throw new HttpError(409,'connect_account_mismatch','The Stripe connection could not be verified.');
 await connectAccountEffects(env,tenantId,account).run();
 return env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_settings WHERE tenant_id=?').bind(tenantId).first<CashTextSettings>();
}
/** Onboarding (spec §3.5): create the tenant's Express account (or
 * reuse the linked one), persist it in mayor_cashtext_settings, then
 * mint an account_onboarding link whose return/refresh URLs land back
 * on /billing?module=cashtext. The R6 consent line and the R5 fees
 * line are carried by the Modules Connect card + its review dialog in
 * the web layer, before this endpoint is ever called. */
export async function startConnectOnboarding(env:BillingEnv,actor:Actor,requestId:string,injected?:StripeClient,termsGateOpen=CASHTEXT_CONNECT_TERMS_GATE_OPEN){
 if(!termsGateOpen)throw new HttpError(503,'cashtext_connect_not_ready','Stripe connection opens once our Terms name your business as the merchant of record for your invoices. That update is in flight — connecting is not open yet.');
 await requireMembership(env,actor,BILLING_ROLES);
 const config=baseConfiguration(env),client=clientFor(env,injected);await assertAccount(env,client);
 let settings=await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_settings WHERE tenant_id=?').bind(actor.tenantId).first<CashTextSettings>();
 if(!settings?.stripe_account_id){
  const account=await client.request('/v1/accounts','POST',{type:'express',country:'US',capabilities:{card_payments:{requested:true},transfers:{requested:true}},metadata:{mayor_billing_domain:CASHTEXT_DOMAIN,mayor_tenant_id:actor.tenantId}},`mayor-pwa:cashtext-connect:${config.mode}:${actor.tenantId}`);
  assertMode(account,config.mode);if(!/^acct_[A-Za-z0-9]+$/.test(account.id??'')||account.metadata?.mayor_billing_domain!==CASHTEXT_DOMAIN||account.metadata?.mayor_tenant_id!==actor.tenantId)throw new HttpError(502,'connect_account_invalid','The Stripe account could not be verified.');
  const now=new Date().toISOString();
  await env.AGENT_DB.prepare("INSERT INTO mayor_cashtext_settings(tenant_id,stripe_account_id,account_status,charges_enabled,payouts_enabled,created_at,updated_at) VALUES(?,?,?,0,0,?,?) ON CONFLICT(tenant_id) DO UPDATE SET stripe_account_id=COALESCE(mayor_cashtext_settings.stripe_account_id,excluded.stripe_account_id),updated_at=excluded.updated_at").bind(actor.tenantId,account.id,deriveConnectAccountStatus(account),now,now).run();
  settings=await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_settings WHERE tenant_id=?').bind(actor.tenantId).first<CashTextSettings>();
  if(settings?.stripe_account_id!==account.id)throw new HttpError(409,'connect_account_conflict','A different Stripe account is already linked to this business.');
 }
 const accountId=settings!.stripe_account_id!,origin=new URL(env.APP_ORIGIN).origin;
 const link=await client.request('/v1/account_links','POST',{account:accountId,refresh_url:`${origin}${CASHTEXT_CONNECT_RETURN_PATH}`,return_url:`${origin}${CASHTEXT_CONNECT_RETURN_PATH}`,type:'account_onboarding'},`mayor-pwa:cashtext-link:${config.mode}:${actor.tenantId}:${requestId}`);
 if(link.object!=='account_link'||!link.url)throw new HttpError(502,'connect_link_invalid','Stripe did not return a valid setup destination.');
 return {url:stripeUrl(link.url,'connect.stripe.com'),accountStatus:settings!.account_status};
}
/** Explicit status refresh for the Modules section (the read-on-view
 * sync in cashtextStatus covers ordinary views; this is the owner's
 * deliberate re-check after returning from Stripe). */
export async function refreshConnectStatus(env:BillingEnv,actor:Actor,injected?:StripeClient){
 const membership=await requireMembership(env,actor,BILLING_ROLES);
 await syncConnectAccount(env,actor.tenantId,injected).catch(()=>null);
 return cashtextStatus(env,actor,BILLING_ROLES.includes(membership.role),Date.now(),injected);
}
/* ── Connect webhook (spec §3.5) ─────────────────────────────────────────
 * POST /api/billing/connect-webhook verifies against its OWN secret
 * (MAYOR_STRIPE_CONNECT_WEBHOOK_SECRET, checked at the route): Connect
 * events cannot ride the platform endpoint — its secret differs and
 * processBillingEvent's unrelated_account drop would eat them anyway.
 * The tenant is resolved ONLY via mayor_cashtext_settings.
 * stripe_account_id = event.account (never event metadata alone).
 * Dedupe/lease discipline reuses the mayor_billing_events ledger
 * (mode-tagged) exactly as the module billing branch does. Refund and
 * dispute events on connected accounts are recorded as notes in the
 * ledger and never acted on: MehyarSoft is not the merchant of record
 * and never touches the tenant's refunds. */
export const CONNECT_WEBHOOK_EVENTS=['invoice.paid','invoice.payment_failed','invoice.sent','account.updated','charge.refunded','charge.dispute.created','charge.dispute.updated','charge.dispute.closed','refund.created','refund.updated'] as const;
const CONNECT_NOTE_EVENTS=['charge.refunded','charge.dispute.created','charge.dispute.updated','charge.dispute.closed','refund.created','refund.updated'];
export async function processConnectEvent(env:BillingEnv,event:StripeEvent,injected?:StripeClient){
 const selected=mode(env),key=env.MAYOR_STRIPE_SECRET_KEY;
 if(!selected||!key||!new RegExp(`^(sk|rk)_${selected==='test'?'test':'live'}_`).test(key))throw new HttpError(503,'billing_not_ready','Payments are being prepared.');
 if(event.livemode!==(selected==='live'))throw new HttpError(400,'stripe_mode_mismatch','Billing event environment mismatch.');
 if(!(CONNECT_WEBHOOK_EVENTS as readonly string[]).includes(event.type))return {received:true,outcome:'unrelated_event'};
 if(!event.account||!/^acct_[A-Za-z0-9]+$/.test(event.account))return {received:true,outcome:'unrelated_account'};
 const settings=await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_settings WHERE stripe_account_id=?').bind(event.account).first<CashTextSettings>();
 if(!settings)return {received:true,outcome:'unrelated_account'};
 const tenantId=settings.tenant_id,object=event.data.object,hash=await digest(JSON.stringify(event)),updated=new Date().toISOString(),token=crypto.randomUUID();
 await env.AGENT_DB.prepare("INSERT INTO mayor_billing_events(mode,event_id,payload_hash,status,event_type,received_at) VALUES(?,?,?,'pending',?,?) ON CONFLICT(mode,event_id) DO NOTHING").bind(selected,event.id,hash,event.type,updated).run();
 const stored=await env.AGENT_DB.prepare('SELECT payload_hash,status FROM mayor_billing_events WHERE mode=? AND event_id=?').bind(selected,event.id).first<{payload_hash:string;status:string}>();if(stored?.payload_hash!==hash)throw new HttpError(409,'billing_event_conflict','This Connect event needs review.');if(stored.status==='processed')return {received:true,outcome:'duplicate'};
 const claimed=await env.AGENT_DB.prepare("UPDATE mayor_billing_events SET status='processing',processing_token=?,lease_expires_at=?,error_code=NULL WHERE mode=? AND event_id=? AND (status IN ('pending','failed') OR (status='processing' AND lease_expires_at<=?))").bind(token,Date.now()+120000,selected,event.id,Date.now()).run();if(!claimed.meta.changes)throw new HttpError(503,'billing_event_busy','The Connect event is being processed.');
 let lease:string|undefined;
 try{
  lease=await acquireLease(env,tenantId,selected);const effects:D1PreparedStatement[]=[];let outcome='processed';
  if(event.type==='account.updated'){
   if(object.id!==event.account)throw new HttpError(409,'connect_account_mismatch','The Connect event account could not be verified.');
   effects.push(connectAccountEffects(env,tenantId,object));
  }else if(CONNECT_NOTE_EVENTS.includes(event.type)){
   // Recorded as a note in the events ledger, never acted on — the
   // tenant is the merchant of record; their refunds and disputes
   // are theirs (spec §3.5/§8 R4). No invoice state changes here.
   outcome='noted';
  }else{
   // invoice.paid / invoice.payment_failed / invoice.sent on the
   // tenant's own connected account, resolved by the invoice id on
   // OUR row for THIS tenant — an invoice id from another tenant's
   // book can never advance under this account.
   const invoice=await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_invoices WHERE tenant_id=? AND stripe_invoice_id=?').bind(tenantId,object.id).first<{status:string}>();
   if(!invoice)outcome='unrelated_invoice';
   else if(event.type==='invoice.paid'&&invoice.status!=='paid')effects.push(env.AGENT_DB.prepare("UPDATE mayor_cashtext_invoices SET status='paid',paid_at=COALESCE(paid_at,?),hosted_invoice_url=COALESCE(?,hosted_invoice_url),updated_at=? WHERE tenant_id=? AND stripe_invoice_id=? AND status!='paid'").bind(new Date(event.created*1000).toISOString(),typeof object.hosted_invoice_url==='string'?object.hosted_invoice_url:null,updated,tenantId,object.id));
   else if(event.type==='invoice.sent'&&invoice.status==='approved')effects.push(env.AGENT_DB.prepare("UPDATE mayor_cashtext_invoices SET status='sent',sent_at=COALESCE(sent_at,?),hosted_invoice_url=COALESCE(?,hosted_invoice_url),updated_at=? WHERE tenant_id=? AND stripe_invoice_id=? AND status='approved'").bind(new Date(event.created*1000).toISOString(),typeof object.hosted_invoice_url==='string'?object.hosted_invoice_url:null,updated,tenantId,object.id));
   // invoice.payment_failed changes no state: the invoice stays open
   // and chase-eligible (spec §3.3); the ledger row is the record.
  }
  const fence=`${token}:connect-event`;effects.unshift(env.AGENT_DB.prepare('INSERT INTO mayor_billing_fences(token,verified_token) VALUES(?,(SELECT processing_token FROM mayor_billing_events WHERE mode=? AND event_id=? AND processing_token=? AND lease_expires_at>?))').bind(fence,selected,event.id,token,Date.now()));effects.push(env.AGENT_DB.prepare("UPDATE mayor_billing_events SET status='processed',processing_token=NULL,lease_expires_at=NULL WHERE mode=? AND event_id=? AND processing_token=?").bind(selected,event.id,token),env.AGENT_DB.prepare('DELETE FROM mayor_billing_fences WHERE token=?').bind(fence));
  await commitLease(env,tenantId,selected,lease,effects);return {received:true,outcome};
 }catch(error){if(lease)await releaseLease(env,tenantId,selected,lease);await env.AGENT_DB.prepare("UPDATE mayor_billing_events SET status='failed',processing_token=NULL,lease_expires_at=NULL,error_code=? WHERE mode=? AND event_id=? AND processing_token=?").bind(error instanceof HttpError?error.code:'connect_processing_failed',selected,event.id,token).run();throw error;}
}
