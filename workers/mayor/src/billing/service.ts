import type {Actor} from '../env';
import {HttpError} from '../http';
import {BILLING_ROLES,requireMembership} from '../permissions';
import {BILLING_DOMAIN,BILLING_VERSION,FOUNDING_PRICE_CENTS,PRO_PRICE_CENTS,PRO_PRICE_VERSION,freePeriod,PLANS} from './plans';
import {foundingGateOpen,foundingSeats} from './founding';
import {usageBalance} from './state';
import {creditStatus,syncCreditEffects} from './credits';
import {cashtextStatus} from './cashtext';
import {leadproofStatus} from './leadproof';
import {acquireLease,commitLease,releaseLease} from './locking';
import {assertFoundingPrice,assertMode,assertPrice,baseConfiguration,clientFor,configuration,foundingConfiguration,metadata,mode,objectId,stripeUrl,type BillingEnv,type StripeClient,type StripeObject} from './stripe';
import {emitEngineEventOnce,recordEngineEventOnceStatement,type AnalyticsDirective} from '../engine-events';

interface Checkout {id:string;tenant_id:string;mode:'test'|'live';request_id:string;status:string;stripe_session_id:string|null;checkout_url:string|null;expires_at:number|null;provider_started_at:number|null;created_at:string;cohort?:string|null;}
interface Subscription {stripe_subscription_id:string;stripe_customer_id:string;checkout_id:string;status:string;cancel_at_period_end:number;}
function assertMetadata(object:StripeObject,tenantId:string){if(object.metadata?.mayor_billing_domain!==BILLING_DOMAIN||object.metadata?.mayor_tenant_id!==tenantId||object.metadata?.mayor_catalog_version!==BILLING_VERSION||object.metadata?.mayor_checkout_id&&object.metadata.mayor_price_version!==PRO_PRICE_VERSION)throw new HttpError(409,'billing_ownership_mismatch','Billing ownership could not be verified.');}
export async function assertAccount(env:BillingEnv,client:StripeClient){if(env.MAYOR_STRIPE_ACCOUNT_ID){const account=await client.request('/v1/account');if(account.id!==env.MAYOR_STRIPE_ACCOUNT_ID)throw new HttpError(409,'billing_account_mismatch','The billing account could not be verified.');}}
export async function billingStatus(env:BillingEnv,actor:Actor,now=Date.now()){
 const membership=await requireMembership(env,actor),balance=await usageBalance(env,actor,now),selected=mode(env);
 const subscription=selected?await env.AGENT_DB.prepare('SELECT status,cancel_at_period_end FROM mayor_billing_subscriptions WHERE tenant_id=? AND mode=?').bind(actor.tenantId,selected).first<{status:string;cancel_at_period_end:number}>():null;
 const customer=selected?await env.AGENT_DB.prepare('SELECT tenant_id FROM mayor_billing_customers WHERE tenant_id=? AND mode=?').bind(actor.tenantId,selected).first():null;
 const pending=selected?await env.AGENT_DB.prepare("SELECT request_id,checkout_url FROM mayor_billing_checkouts WHERE tenant_id=? AND mode=? AND status IN ('pending','open') AND (expires_at IS NULL OR expires_at>?)").bind(actor.tenantId,selected,Math.floor(now/1000)).first<{request_id:string;checkout_url:string|null}>():null;
 // Commitments (migration 0076): the tenant's fulfilled purchase intent
 // rides the billing status so the Desk can show the intent completed.
 // Read failure degrades to no commitments — never a fabricated record.
 const commitments=await env.AGENT_DB.prepare("SELECT id,kind,plan_ref,amount_cents,status,created_at FROM mayor_commitments WHERE tenant_id=? ORDER BY created_at DESC LIMIT 5").bind(actor.tenantId).all<{id:string;kind:string;plan_ref:string|null;amount_cents:number|null;status:string;created_at:string}>().then(rows=>rows.results).catch(()=>[]);
 let ready=false;try{configuration(env);ready=true;}catch{}
 const credit=await creditStatus(env,actor,BILLING_ROLES.includes(membership.role),now);
 // Modules (spec §5.5): the billing view's Modules section reads the
 // module domains' own state — CashText in Phase 1; LeadProof joins in
 // Phase 5. A module read failure degrades to the not-subscribed state
 // cashtextStatus itself reports, never a fabricated subscription.
 const cashtext=await cashtextStatus(env,actor,BILLING_ROLES.includes(membership.role),now);
 const leadproof=await leadproofStatus(env,actor,BILLING_ROLES.includes(membership.role)).catch(()=>null);
 const plan=PLANS[balance.context.planId==='pro'?1:0];
 return {founding:await foundingSeats(env),foundingPriceCents:FOUNDING_PRICE_CENTS,creditPacks:credit.creditPacks,credits:credit.credits,modules:{cashtext,...(leadproof?{leadproof}:{})},plans:PLANS,plan:{id:plan.id,name:plan.name,status:balance.context.planId==='pro'?(subscription?.cancel_at_period_end?'canceling':subscription?.status??'active'):subscription&&['past_due','unpaid','incomplete'].includes(subscription.status)?'payment_required':'active',periodStart:balance.usage.periodStart,periodEnd:balance.usage.resetAt,cancelAtPeriodEnd:Boolean(subscription?.cancel_at_period_end)},usage:balance.usage,permissions:{canManage:BILLING_ROLES.includes(membership.role)},readiness:{creditPacks:credit.ready,checkout:ready&&plan.id==='free'&&!subscription?.status?.match(/^(active|past_due|unpaid|paused|incomplete|trialing)$/),portal:ready&&Boolean(customer&&/^bpc_[A-Za-z0-9]+$/.test(env.MAYOR_STRIPE_PORTAL_CONFIGURATION??'')),mode:selected,message:ready?(selected==='test'?'Stripe test mode. No real charges.':null):'Payments are being prepared. You can keep using Free.'},checkout:{pending:Boolean(pending),...(pending&&BILLING_ROLES.includes(membership.role)?{requestId:pending.request_id,...(pending.checkout_url?{url:stripeUrl(pending.checkout_url,'checkout.stripe.com')}:{})}:{})},usageNote:'Allowances are shared by this business. Failed or interrupted reply attempts may count. App microphone time includes startup and silence; reserved minutes are not refunded. Basic business records remain available when an allowance ends. Phone-provider charges are separate.',commitments};
}
export async function ensureCustomer(env:BillingEnv,actor:Actor,client:StripeClient){
 const selected=baseConfiguration(env).mode,row=await env.AGENT_DB.prepare('SELECT stripe_customer_id FROM mayor_billing_customers WHERE tenant_id=? AND mode=?').bind(actor.tenantId,selected).first<{stripe_customer_id:string}>();if(row)return row.stripe_customer_id;
 const customer=await client.request('/v1/customers','POST',{metadata:metadata(actor.tenantId)},`mayor-pwa:customer:${selected}:${actor.tenantId}`);assertMode(customer,selected);assertMetadata(customer,actor.tenantId);if(!/^cus_[A-Za-z0-9]+$/.test(customer.id??''))throw new HttpError(502,'customer_invalid','The billing customer could not be verified.');
 await env.AGENT_DB.prepare('INSERT INTO mayor_billing_customers(tenant_id,mode,stripe_customer_id,created_at) VALUES(?,?,?,?) ON CONFLICT(tenant_id,mode) DO NOTHING').bind(actor.tenantId,selected,customer.id,new Date().toISOString()).run();
 const mapped=await env.AGENT_DB.prepare('SELECT stripe_customer_id FROM mayor_billing_customers WHERE tenant_id=? AND mode=?').bind(actor.tenantId,selected).first<{stripe_customer_id:string}>();if(mapped?.stripe_customer_id!==customer.id)throw new HttpError(409,'customer_conflict','Billing setup needs review.');return customer.id as string;
}
export async function createCheckout(env:BillingEnv,actor:Actor,requestId:string,injected?:StripeClient,cohort?:'founding',consentGranted=false){
 await requireMembership(env,actor,BILLING_ROLES);
 // A founding request requires the founding configuration to exist at
 // all; whether it lands on the founding Price is decided at row
 // creation by the seat gate below.
 if(cohort)foundingConfiguration(env);
 const listConfig=configuration(env),client=clientFor(env,injected);await assertAccount(env,client);
 const status=await billingStatus(env,actor);if(!status.readiness.checkout)throw new HttpError(409,'subscription_exists','Use Manage billing to update your current subscription.');
 let checkout=await env.AGENT_DB.prepare('SELECT * FROM mayor_billing_checkouts WHERE tenant_id=? AND mode=? AND request_id=?').bind(actor.tenantId,listConfig.mode,requestId).first<Checkout>();
 if(checkout){
  const stored=checkout.cohort??null;
  const compatible=cohort?stored==='founding'||stored==='founding-fallback':stored===null;
  if(!compatible)throw new HttpError(409,'checkout_request_changed','Retry the original upgrade request.');
 }
 if(checkout?.checkout_url&&checkout.status==='open'&&(checkout.expires_at??0)>Date.now()/1000){
  // Engine events (§1.7): a begin_checkout belongs to this checkout row;
  // on a replay return it is already recorded (emit-once), so this is a
  // no-op unless the first response was lost before recording.
  const replayDirectives=await emitEngineEventOnce(env,{tenantId:actor.tenantId,actorId:actor.userId,type:'begin_checkout',resourceId:checkout.id,consentGranted,valueCents:checkout.cohort==='founding'?FOUNDING_PRICE_CENTS:PRO_PRICE_CENTS,itemRef:checkout.cohort==='founding'?'founding':'pro',itemName:checkout.cohort==='founding'?'Mayor Pro — Founding':'Mayor Pro'});
  return {url:stripeUrl(checkout.checkout_url,'checkout.stripe.com'),requestId,replay:true,...(checkout.cohort==='founding-fallback'?{foundingFallback:true}:{}),...(replayDirectives.length?{analyticsEvents:replayDirectives}:{})};
 }
 if(checkout&&!['pending','open'].includes(checkout.status))throw new HttpError(409,'checkout_resolved','This checkout has ended. Start a new upgrade request.');
 if(!checkout){
  const pending=await env.AGENT_DB.prepare("SELECT * FROM mayor_billing_checkouts WHERE tenant_id=? AND mode=? AND status IN ('pending','open')").bind(actor.tenantId,listConfig.mode).first<Checkout>();
  if(pending?.stripe_session_id){const remote=await client.request(`/v1/checkout/sessions/${pending.stripe_session_id}`);assertMode(remote,listConfig.mode);assertMetadata(remote,actor.tenantId);if(remote.status==='expired')await env.AGENT_DB.prepare("UPDATE mayor_billing_checkouts SET status='expired',updated_at=? WHERE id=? AND status='open'").bind(new Date().toISOString(),pending.id).run();else throw new HttpError(409,'checkout_pending','An upgrade checkout is already open. Return to it or check billing status.');}
  else if(pending)throw new HttpError(409,'checkout_pending','An upgrade request is already being prepared. Retry its original request.');
  // Seat gate, read at creation: seats held by current founding
  // subscribers plus in-flight founding checkouts. The loser of a race
  // for the last seat is created on the $99 list Price instead and told
  // plainly (response flag + the Stripe page text) before payment.
  const rowCohort=cohort?(await foundingGateOpen(env)?'founding':'founding-fallback'):null;
  const id=crypto.randomUUID(),created=new Date().toISOString();try{await env.AGENT_DB.prepare("INSERT INTO mayor_billing_checkouts(id,tenant_id,mode,request_id,status,created_at,updated_at,cohort) VALUES(?,?,?,?,'pending',?,?,?)").bind(id,actor.tenantId,listConfig.mode,requestId,created,created,rowCohort).run();}catch{const same=await env.AGENT_DB.prepare('SELECT * FROM mayor_billing_checkouts WHERE tenant_id=? AND mode=? AND request_id=?').bind(actor.tenantId,listConfig.mode,requestId).first<Checkout>();if(!same)throw new HttpError(409,'checkout_pending','An upgrade request is already being prepared. Retry the same request.');}
  checkout=await env.AGENT_DB.prepare('SELECT * FROM mayor_billing_checkouts WHERE tenant_id=? AND mode=? AND request_id=?').bind(actor.tenantId,listConfig.mode,requestId).first<Checkout>();
 }
 if(!checkout)throw new HttpError(503,'checkout_unavailable','Checkout is temporarily unavailable.');
 if(checkout.provider_started_at&&Date.now()-checkout.provider_started_at>23*3600000)throw new HttpError(409,'checkout_needs_review','This checkout needs a billing status check before it can be retried.');
 // The row's cohort is authoritative from here: it decides the Price,
 // the metadata, and the buyer-facing text.
 const isFounding=checkout.cohort==='founding',fallback=checkout.cohort==='founding-fallback',config=isFounding?foundingConfiguration(env):listConfig;
 if(isFounding)assertFoundingPrice(await client.request(`/v1/prices/${config.priceId}`),env);else assertPrice(await client.request(`/v1/prices/${config.priceId}`),env);const customer=await ensureCustomer(env,actor,client),origin=new URL(env.APP_ORIGIN).origin;
 await env.AGENT_DB.prepare('UPDATE mayor_billing_checkouts SET provider_started_at=COALESCE(provider_started_at,?),updated_at=? WHERE id=?').bind(Date.now(),new Date().toISOString(),checkout.id).run();
 const submitText=isFounding?'Founding Pro is $79.20 per month, locked at that rate for as long as the subscription stays active. Includes 1,000 reply attempts and 120 reserved app microphone minutes per paid period, shared by your business. Cancel renewal in Manage billing. Phone-provider charges are separate.':fallback?`The founding cohort just filled, so this checkout is Pro at $${PRO_PRICE_CENTS/100} per month. Includes 1,000 reply attempts and 120 reserved app microphone minutes per paid period, shared by your business. Cancel renewal in Manage billing. Phone-provider charges are separate.`:`Pro is $${PRO_PRICE_CENTS/100} per month. Includes 1,000 reply attempts and 120 reserved app microphone minutes per paid period, shared by your business. Cancel renewal in Manage billing. Phone-provider charges are separate.`;
 const session=await client.request('/v1/checkout/sessions','POST',{mode:'subscription',customer,line_items:[{price:config.priceId,quantity:1}],allowed_payment_method_types:['card'],metadata:metadata(actor.tenantId,checkout.id,isFounding?'founding':undefined),subscription_data:{metadata:metadata(actor.tenantId,checkout.id,isFounding?'founding':undefined)},success_url:`${origin}/?billing=success&business=${encodeURIComponent(actor.tenantId)}`,cancel_url:`${origin}/?billing=canceled&business=${encodeURIComponent(actor.tenantId)}`,client_reference_id:checkout.id,custom_text:{submit:{message:submitText}}},`mayor-pwa:checkout:${config.mode}:${checkout.id}`);
 assertMode(session,config.mode);assertMetadata(session,actor.tenantId);if(!/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(session.id??'')||objectId(session.customer)!==customer||session.metadata.mayor_checkout_id!==checkout.id||!Number.isSafeInteger(session.expires_at))throw new HttpError(502,'checkout_invalid','Checkout could not be verified.');const url=stripeUrl(session.url,'checkout.stripe.com');
 await env.AGENT_DB.prepare("UPDATE mayor_billing_checkouts SET stripe_session_id=?,checkout_url=?,expires_at=?,status='open',updated_at=? WHERE id=? AND status='pending'").bind(session.id,url,session.expires_at,new Date().toISOString(),checkout.id).run();
 // Engine events (§1.7): begin_checkout fires engine-side the moment
 // the checkout session exists — operational copy to the tenant ledger
 // always; the analytics copy rides this response only with a current
 // granted consent record. A failure here fails the run loudly rather
 // than letting a money run proceed unmeasured.
 const directives:AnalyticsDirective[]=await emitEngineEventOnce(env,{tenantId:actor.tenantId,actorId:actor.userId,type:'begin_checkout',resourceId:checkout.id,consentGranted,valueCents:isFounding?FOUNDING_PRICE_CENTS:PRO_PRICE_CENTS,itemRef:isFounding?'founding':'pro',itemName:isFounding?'Mayor Pro — Founding':'Mayor Pro'});
 return {url,requestId,replay:false,...(fallback?{foundingFallback:true}:{}),...(directives.length?{analyticsEvents:directives}:{})};
}
export async function portalSession(env:BillingEnv,actor:Actor,requestId:string,injected?:StripeClient){
 await requireMembership(env,actor,BILLING_ROLES);const config=configuration(env),client=clientFor(env,injected);if(!/^bpc_[A-Za-z0-9]+$/.test(env.MAYOR_STRIPE_PORTAL_CONFIGURATION??''))throw new HttpError(503,'portal_not_ready','Billing management is being prepared.');await assertAccount(env,client);
 const row=await env.AGENT_DB.prepare('SELECT stripe_customer_id FROM mayor_billing_customers WHERE tenant_id=? AND mode=?').bind(actor.tenantId,config.mode).first<{stripe_customer_id:string}>();if(!row)throw new HttpError(404,'billing_customer_missing','This business has no billing account yet.');
 const customer=await client.request(`/v1/customers/${row.stripe_customer_id}`);assertMode(customer,config.mode);assertMetadata(customer,actor.tenantId);
 const portal=await client.request(`/v1/billing_portal/configurations/${env.MAYOR_STRIPE_PORTAL_CONFIGURATION}`);if(!portal.active||portal.features?.subscription_update?.enabled||portal.features?.subscription_cancel?.enabled!==true||portal.features?.subscription_cancel?.mode!=='at_period_end')throw new HttpError(409,'portal_contract_mismatch','Billing management configuration needs review.');
 const session=await client.request('/v1/billing_portal/sessions','POST',{customer:row.stripe_customer_id,configuration:env.MAYOR_STRIPE_PORTAL_CONFIGURATION,return_url:`${new URL(env.APP_ORIGIN).origin}/?billing=return&business=${encodeURIComponent(actor.tenantId)}`},`mayor-pwa:portal:${config.mode}:${actor.tenantId}:${requestId}`);return {url:stripeUrl(session.url,'billing.stripe.com'),requestId};
}
function invoiceSubscription(invoice:StripeObject){return objectId(invoice.parent?.subscription_details?.subscription)??objectId(invoice.subscription);}
function linePrice(line:StripeObject){return objectId(line.pricing?.price_details?.price)??objectId(line.price);}
export async function subscriptionEffects(env:BillingEnv,tenantId:string,subscriptionId:string,eventCreated:number,injected?:StripeClient,invoiceId?:string):Promise<D1PreparedStatement[]>{
 const config=configuration(env),client=clientFor(env,injected);await assertAccount(env,client);
 const subscription=await client.request(`/v1/subscriptions/${subscriptionId}?expand[]=items.data.price`);assertMode(subscription,config.mode);assertMetadata(subscription,tenantId);
 const customerId=objectId(subscription.customer),customer=await env.AGENT_DB.prepare('SELECT stripe_customer_id FROM mayor_billing_customers WHERE tenant_id=? AND mode=?').bind(tenantId,config.mode).first<{stripe_customer_id:string}>();if(!customerId||customer?.stripe_customer_id!==customerId)throw new HttpError(409,'billing_customer_mismatch','Billing ownership could not be verified.');
 const remoteCustomer=await client.request(`/v1/customers/${customerId}`);assertMode(remoteCustomer,config.mode);assertMetadata(remoteCustomer,tenantId);
 const items:StripeObject[]=subscription.items?.data??[];if(subscription.items?.has_more||items.length!==1||items[0].quantity!==1)throw new HttpError(409,'subscription_price_mismatch','The subscription does not match Mayor Pro.');
 // The subscription's dedicated Price decides its contract: the $99 list
 // Price, or the founding Price while the cohort configuration exists.
 // Anything else is not a Mayor Pro subscription this worker recognizes.
 const subPriceId=objectId(items[0].price);let expectedCents=PRO_PRICE_CENTS,expectedPriceId=config.priceId;
 if(subPriceId===config.priceId){assertPrice(typeof items[0].price==='object'?items[0].price:await client.request(`/v1/prices/${config.priceId}`),env);}
 else if(env.MAYOR_STRIPE_FOUNDING_PRICE_ID&&subPriceId===env.MAYOR_STRIPE_FOUNDING_PRICE_ID){expectedCents=FOUNDING_PRICE_CENTS;expectedPriceId=env.MAYOR_STRIPE_FOUNDING_PRICE_ID;assertFoundingPrice(typeof items[0].price==='object'?items[0].price:await client.request(`/v1/prices/${expectedPriceId}`),env);}
 else throw new HttpError(409,'subscription_price_mismatch','The subscription does not match Mayor Pro.');
 const checkout=await env.AGENT_DB.prepare('SELECT * FROM mayor_billing_checkouts WHERE id=? AND tenant_id=? AND mode=?').bind(subscription.metadata.mayor_checkout_id??'',tenantId,config.mode).first<Checkout>();if(!checkout?.stripe_session_id)throw new HttpError(409,'billing_checkout_unmapped','This payment is waiting for its checkout record.');
 const session=await client.request(`/v1/checkout/sessions/${checkout.stripe_session_id}`);assertMode(session,config.mode);assertMetadata(session,tenantId);if(session.status!=='complete'||session.mode!=='subscription'||session.metadata.mayor_checkout_id!==checkout.id||objectId(session.customer)!==customerId||objectId(session.subscription)!==subscriptionId)throw new HttpError(409,'billing_checkout_unconfirmed','The subscription checkout has not been confirmed yet.');
 const existing=await env.AGENT_DB.prepare('SELECT * FROM mayor_billing_subscriptions WHERE tenant_id=? AND mode=?').bind(tenantId,config.mode).first<Subscription>();
 if(existing&&existing.stripe_subscription_id!==subscriptionId){const prior=await env.AGENT_DB.prepare('SELECT created_at FROM mayor_billing_checkouts WHERE id=?').bind(existing.checkout_id).first<{created_at:string}>();if((prior?.created_at??'')>=checkout.created_at)return [];if(!['canceled','incomplete_expired'].includes(existing.status))throw new HttpError(409,'subscription_conflict','Another subscription needs review.');}
 const now=new Date().toISOString(),effects=[env.AGENT_DB.prepare(`INSERT INTO mayor_billing_subscriptions(tenant_id,mode,stripe_subscription_id,stripe_customer_id,checkout_id,status,cancel_at_period_end,last_event_created,updated_at,price_id) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,mode) DO UPDATE SET stripe_subscription_id=excluded.stripe_subscription_id,stripe_customer_id=excluded.stripe_customer_id,checkout_id=excluded.checkout_id,status=excluded.status,cancel_at_period_end=excluded.cancel_at_period_end,last_event_created=MAX(last_event_created,excluded.last_event_created),updated_at=excluded.updated_at,price_id=excluded.price_id`).bind(tenantId,config.mode,subscriptionId,customerId,checkout.id,subscription.status,subscription.cancel_at_period_end?1:0,eventCreated,now,expectedPriceId),env.AGENT_DB.prepare("UPDATE mayor_billing_checkouts SET status='completed',updated_at=? WHERE id=?").bind(now,checkout.id)];
 const latest=invoiceId??objectId(subscription.latest_invoice);if(!latest)return effects;
 const invoice=await client.request(`/v1/invoices/${latest}?expand[]=payments`);assertMode(invoice,config.mode);if(invoice.id!==latest||objectId(invoice.customer)!==customerId||invoiceSubscription(invoice)!==subscriptionId)throw new HttpError(409,'billing_invoice_mismatch','The paid invoice could not be matched to this business.');
 if(invoice.status!=='paid')return effects;
 const lines:StripeObject[]=invoice.lines?.data??[],line=lines[0],start=line?.period?.start,end=line?.period?.end;
 if(invoice.currency!=='usd'||invoice.subtotal!==expectedCents||invoice.total<expectedCents||invoice.amount_paid<invoice.total||invoice.amount_remaining!==0||invoice.paid_out_of_band===true||!['subscription_create','subscription_cycle'].includes(invoice.billing_reason)||invoice.lines?.has_more||lines.length!==1||linePrice(line)!==expectedPriceId||line.quantity!==1||line.amount!==expectedCents||line.currency!=='usd'||line.parent?.subscription_item_details?.proration===true||line.proration===true||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<=start||end-start>32*86400)throw new HttpError(409,'paid_invoice_contract_mismatch','The paid invoice does not match a full Mayor Pro period.');
 const payments:StripeObject[]=invoice.payments?.data??[],payment=payments.find(row=>row.status==='paid'&&row.payment?.type==='payment_intent'&&row.currency===invoice.currency&&objectId(row.invoice)===invoice.id&&row.amount_paid>=invoice.total),intentId=objectId(payment?.payment?.payment_intent);if(!intentId||invoice.payments?.has_more)throw new HttpError(409,'payment_unverified','The invoice payment has not been verified.');assertMode(payment!,config.mode);
 const intent=await client.request(`/v1/payment_intents/${intentId}`);assertMode(intent,config.mode);if(intent.id!==intentId||intent.status!=='succeeded'||intent.currency!=='usd'||intent.amount_received<invoice.total||objectId(intent.customer)!==customerId)throw new HttpError(409,'payment_unverified','The invoice payment has not been verified.');
 const periodKey=`pro:${config.mode}:${subscriptionId}:${start}`,calendar=freePeriod(start*1000).periodKey;
 effects.push(env.AGENT_DB.prepare(`INSERT INTO mayor_billing_paid_periods(tenant_id,mode,period_key,stripe_subscription_id,stripe_invoice_id,stripe_payment_intent_id,period_start,period_end,verified_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,period_key) DO NOTHING`).bind(tenantId,config.mode,periodKey,subscriptionId,invoice.id,intentId,start,end,now));
 // Engine events (§1.7): the purchase itself is an engine event. It
 // rides the same atomic batch as the paid-period write, recorded once
 // per invoice (the statement no-ops if this purchase was already
 // recorded by the webhook or a sync). Its analytics copy is offered
 // later via billing status — a webhook has no browser to fire it.
 effects.push(recordEngineEventOnceStatement(env,{tenantId,actorId:'system',type:'purchase_completed',resourceId:invoice.id}));
 // Reinvention Slice 1 (blueprint §5, Demand 8 tail): a fulfilled
 // founding purchase converts the carried intent into the tenant's
 // first Commitment record — post-claim, exactly once per checkout
 // (deterministic id + INSERT OR IGNORE: webhook replays, syncs, and
 // renewals all re-run this path and can never duplicate the record).
 if(checkout.cohort==='founding')effects.push(env.AGENT_DB.prepare("INSERT OR IGNORE INTO mayor_commitments(id,tenant_id,kind,plan_ref,amount_cents,resource_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?, 'fulfilled',?,?)").bind(`purchase-intent:${checkout.id}`,tenantId,'purchase_intent','founding',FOUNDING_PRICE_CENTS,checkout.id,now,now));
 // A switch consumes the old period's opportunity permanently: Free credits cannot resurrect on downgrade.
  if(start<=Date.now()/1000&&end>Date.now()/1000){
  const active="EXISTS(SELECT 1 FROM mayor_billing_paid_periods p JOIN mayor_billing_subscriptions s ON s.tenant_id=p.tenant_id AND s.mode=p.mode AND s.stripe_subscription_id=p.stripe_subscription_id WHERE p.tenant_id=? AND p.mode=? AND p.period_key=? AND p.invalidated=0 AND p.period_start<=? AND p.period_end>?)",current=Math.floor(Date.now()/1000),fence=[tenantId,config.mode,periodKey,current,current];
  effects.push(env.AGENT_DB.prepare(`UPDATE mayor_billing_credit_grants SET invalidated=1 WHERE tenant_id=? AND mode=? AND period_key!=? AND ${active}`).bind(tenantId,config.mode,periodKey,...fence),env.AGENT_DB.prepare(`UPDATE mayor_billing_credit_checkouts SET status=CASE WHEN status='paid' THEN 'paid_expired' ELSE 'expired' END,updated_at=? WHERE tenant_id=? AND mode=? AND period_key!=? AND status IN ('pending','open','paid') AND ${active}`).bind(now,tenantId,config.mode,periodKey,...fence));
 }
 for(const kind of ['turn','minute'])effects.push(env.AGENT_DB.prepare(`INSERT INTO mayor_billing_usage_periods(tenant_id,period_key,kind,count) SELECT ?,?,?,CASE WHEN NOT EXISTS(SELECT 1 FROM mayor_billing_paid_periods WHERE tenant_id=? AND mode=? AND period_key!=?) THEN COALESCE((SELECT count FROM mayor_billing_usage_periods WHERE tenant_id=? AND period_key=? AND kind=?),0) ELSE 0 END ON CONFLICT(tenant_id,period_key,kind) DO NOTHING`).bind(tenantId,periodKey,kind,tenantId,config.mode,periodKey,tenantId,calendar,kind));
 return effects;
}
export async function syncBilling(env:BillingEnv,actor:Actor,injected?:StripeClient){
 await requireMembership(env,actor,BILLING_ROLES);const config=configuration(env),client=clientFor(env,injected),token=await acquireLease(env,actor.tenantId,config.mode);
 try{
  const subscription=await env.AGENT_DB.prepare('SELECT stripe_subscription_id FROM mayor_billing_subscriptions WHERE tenant_id=? AND mode=?').bind(actor.tenantId,config.mode).first<{stripe_subscription_id:string}>();
  let id=subscription?.stripe_subscription_id;
  if(!id){const pending=await env.AGENT_DB.prepare("SELECT * FROM mayor_billing_checkouts WHERE tenant_id=? AND mode=? AND status IN ('pending','open') ORDER BY created_at DESC LIMIT 1").bind(actor.tenantId,config.mode).first<Checkout>();if(pending?.stripe_session_id){const session=await client.request(`/v1/checkout/sessions/${pending.stripe_session_id}`);assertMode(session,config.mode);assertMetadata(session,actor.tenantId);if(session.status==='expired'){await commitLease(env,actor.tenantId,config.mode,token,[env.AGENT_DB.prepare("UPDATE mayor_billing_checkouts SET status='expired',updated_at=? WHERE id=?").bind(new Date().toISOString(),pending.id)]);return {synced:true,...await billingStatus(env,actor)};}id=objectId(session.subscription);}}
  const effects=[...(id?await subscriptionEffects(env,actor.tenantId,id,Math.floor(Date.now()/1000),client):[]),...await syncCreditEffects(env,actor,client)];await commitLease(env,actor.tenantId,config.mode,token,effects);return {synced:true,...await billingStatus(env,actor)};
 }catch(error){await releaseLease(env,actor.tenantId,config.mode,token);throw error;}
}
