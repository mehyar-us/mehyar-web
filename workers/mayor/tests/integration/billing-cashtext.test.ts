import {env as testEnv} from 'cloudflare:workers';
import {beforeEach,expect,it} from 'vitest';
import type {Actor,Env} from '../../src/env';
import {handleBillingRequest} from '../../src/billing';
import {billingStatus} from '../../src/billing/service';
import {processBillingEvent} from '../../src/billing/events';
import {cashtextEntitlement,createModuleCheckout,setCashTextCancelAtPeriodEnd} from '../../src/billing/cashtext';
import {CASHTEXT_PRICE_CENTS,CASHTEXT_PRICE_VERSION} from '../../src/billing/plans';
import {StripeClient,type StripeObject,type StripeEvent} from '../../src/billing/stripe';

/* The configured price id below is the REAL Stripe test-mode price
 * minted in Phase 0 (report §2, read-back verified); the transport is
 * the injected FakeStripe serving that price's verified shape — the
 * decline case models Stripe's documented insufficient-funds test-card
 * outcome at the transport seam (session left open/unpaid).
 * Phase 1 proof battery (integration spec §6 item 1, Miniflare/D1):
 * CashText module checkout → webhook checkout.session.completed →
 * exactly one mayor_cashtext_subscriptions row + one commitment;
 * decline → no entitlement; replay → duplicate, still one row;
 * double-submit → same request-id returns the open session, a second
 * request-id while one is open → 409 checkout_pending. The Pro domain
 * is asserted untouched throughout. All test mode, injected transport. */
const dbEnv=testEnv as unknown as Env;
let env:Env,actor:Actor,provider:FakeStripe;
const TEST_PRICE_ID='price_1UTi8B8y1yiOc3KfC6DbiX5f';
const price={id:TEST_PRICE_ID,livemode:false,active:true,currency:'usd',unit_amount:CASHTEXT_PRICE_CENTS,type:'recurring',recurring:{interval:'month',interval_count:1},billing_scheme:'per_unit',tax_behavior:'exclusive',metadata:{mayor_billing_domain:'mayor_cashtext'}};
class FakeStripe extends StripeClient{
 objects=new Map<string,StripeObject>();calls:Array<{path:string;method:string;body?:Record<string,unknown>;key?:string}>=[];
 constructor(){super('sk_test_fixture');this.objects.set(`/v1/prices/${TEST_PRICE_ID}`,structuredClone(price));}
 async request(path:string,method:'GET'|'POST'|'DELETE'='GET',body?:Record<string,unknown>,key?:string){
  this.calls.push({path,method,body,key});const normalized=path.split('?')[0];
  if(method==='POST'&&path==='/v1/customers'){const object={id:`cus_${crypto.randomUUID().replaceAll('-','')}`,livemode:false,metadata:body?.metadata};this.objects.set(`/v1/customers/${object.id}`,object);return object;}
  if(method==='POST'&&path==='/v1/checkout/sessions'){const id=`cs_test_${crypto.randomUUID().replaceAll('-','')}`,object={id,livemode:false,metadata:body?.metadata,customer:body?.customer,mode:'subscription',status:'open',payment_status:'unpaid',client_reference_id:body?.client_reference_id,expires_at:Math.floor(Date.now()/1000)+86400,url:`https://checkout.stripe.com/c/pay/${id}`};this.objects.set(`/v1/checkout/sessions/${id}`,object);return object;}
  if(method==='POST'&&normalized.startsWith('/v1/subscriptions/')){const object=this.objects.get(normalized);if(!object)throw new Error(`Fixture missing: ${normalized}`);Object.assign(object,{cancel_at_period_end:body?.cancel_at_period_end});return structuredClone(object);}
  const result=this.objects.get(normalized);if(!result)throw new Error(`Fixture missing: ${normalized}`);return structuredClone(result);
 }
}
beforeEach(async()=>{
 env={...dbEnv,MAYOR_STRIPE_MODE:'test',MAYOR_STRIPE_SECRET_KEY:'sk_test_fixture',MAYOR_STRIPE_WEBHOOK_SECRET:'whsec_fixture',MAYOR_STRIPE_PRICE_ID:'price_MayorPro',MAYOR_STRIPE_CASHTEXT_PRICE_ID:TEST_PRICE_ID};provider=new FakeStripe();actor={tenantId:crypto.randomUUID().replaceAll('-',''),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'CashText fixture',new Date().toISOString()).run();await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
});
function event(type:string,object:StripeObject,created=Math.floor(Date.now()/1000)):StripeEvent{return {id:`evt_${crypto.randomUUID().replaceAll('-','')}`,type,created,livemode:false,data:{object}};}
function moduleMetadata(checkoutId:string){return {mayor_billing_domain:'mayor_cashtext',mayor_tenant_id:actor.tenantId,mayor_module_checkout_id:checkoutId,mayor_price_version:CASHTEXT_PRICE_VERSION};}
async function preparePaid(){
 const requestId=crypto.randomUUID(),created=await createModuleCheckout(env,actor,requestId,provider);
 const checkout=await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_checkouts WHERE tenant_id=?').bind(actor.tenantId).first<any>();
 const session=provider.objects.get(`/v1/checkout/sessions/${checkout.stripe_session_id}`)!,subscriptionId=`sub_${crypto.randomUUID().replaceAll('-','')}`,invoiceId=`in_${crypto.randomUUID().replaceAll('-','')}`,intentId=`pi_${crypto.randomUUID().replaceAll('-','')}`;
 Object.assign(session,{status:'complete',payment_status:'paid',subscription:subscriptionId});
 const start=Math.floor(Date.now()/1000)-60,end=start+30*86400;
 const subscription={id:subscriptionId,livemode:false,metadata:moduleMetadata(checkout.id),customer:session.customer,status:'active',cancel_at_period_end:false,latest_invoice:invoiceId,items:{has_more:false,data:[{quantity:1,price:structuredClone(price)}]}};
 const invoice={id:invoiceId,livemode:false,customer:session.customer,parent:{subscription_details:{subscription:subscriptionId}},status:'paid',currency:'usd',subtotal:CASHTEXT_PRICE_CENTS,total:CASHTEXT_PRICE_CENTS,amount_paid:CASHTEXT_PRICE_CENTS,amount_remaining:0,billing_reason:'subscription_create',lines:{has_more:false,data:[{amount:CASHTEXT_PRICE_CENTS,currency:'usd',quantity:1,pricing:{price_details:{price:TEST_PRICE_ID}},period:{start,end},parent:{subscription_item_details:{proration:false}}}]},payments:{has_more:false,data:[{status:'paid',livemode:false,currency:'usd',invoice:invoiceId,amount_paid:CASHTEXT_PRICE_CENTS,payment:{type:'payment_intent',payment_intent:intentId}}]}};
 provider.objects.set(`/v1/subscriptions/${subscriptionId}`,subscription);provider.objects.set(`/v1/invoices/${invoiceId}`,invoice);provider.objects.set(`/v1/payment_intents/${intentId}`,{id:intentId,livemode:false,status:'succeeded',currency:'usd',amount_received:CASHTEXT_PRICE_CENTS,customer:session.customer});
 return {requestId,created,checkout,session,subscription,invoice,intentId};
}
async function moduleRows(){return (await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_subscriptions WHERE tenant_id=?').bind(actor.tenantId).all()).results;}
async function commitments(){return (await env.AGENT_DB.prepare("SELECT * FROM mayor_commitments WHERE tenant_id=? AND kind='module_subscription'").bind(actor.tenantId).all()).results;}

it('checkout: row-first, domain metadata, request-id replay returns the open session, second request while open → 409 checkout_pending',async()=>{
 const key=crypto.randomUUID(),first=await createModuleCheckout(env,actor,key,provider);
 const row=await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_checkouts WHERE tenant_id=?').bind(actor.tenantId).first<any>();
 expect(row.status).toBe('open');expect(row.request_id).toBe(key);expect(row.stripe_session_id).toContain('cs_test_');
 const posts=provider.calls.filter(call=>call.path==='/v1/checkout/sessions'&&call.method==='POST');expect(posts).toHaveLength(1);
 expect(posts[0].body?.line_items).toEqual([{price:TEST_PRICE_ID,quantity:1}]);expect(posts[0].body?.mode).toBe('subscription');
 expect((posts[0].body?.metadata as any)?.mayor_billing_domain).toBe('mayor_cashtext');expect((posts[0].body?.subscription_data as any)?.metadata?.mayor_module_checkout_id).toBe(row.id);
 expect(posts[0].key).toBe(`mayor-pwa:cashtext:test:${row.id}`);
 const second=await createModuleCheckout(env,actor,key,provider);expect(second.url).toBe(first.url);expect(second.replay).toBe(true);
 expect(provider.calls.filter(call=>call.path==='/v1/checkout/sessions'&&call.method==='POST')).toHaveLength(1);
 await expect(createModuleCheckout(env,actor,crypto.randomUUID(),provider)).rejects.toMatchObject({code:'checkout_pending'});
 // Honest pre-payment state: not subscribed, checkout named pending.
 const status=await billingStatus(env,actor);expect(status.modules.cashtext.subscribed).toBe(false);expect(status.modules.cashtext.status).toBe('not_subscribed');expect(status.modules.cashtext.checkout.pending).toBe(true);expect(status.plan.id).toBe('free');
});

it('fulfillment: session → webhook → exactly one subscription row + one commitment; replay duplicates nothing; Pro untouched',async()=>{
 const data=await preparePaid(),completed=event('checkout.session.completed',data.session);
 expect(await processBillingEvent(env,completed,provider)).toMatchObject({outcome:'processed'});
 expect(await moduleRows()).toHaveLength(1);expect((await moduleRows())[0]).toMatchObject({status:'active',stripe_subscription_id:data.subscription.id,checkout_id:data.checkout.id});
 const rows=await commitments();expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({id:`purchase-intent:${data.checkout.id}`,kind:'module_subscription',plan_ref:'cashtext',amount_cents:CASHTEXT_PRICE_CENTS,status:'fulfilled'});
 expect((await env.AGENT_DB.prepare('SELECT status FROM mayor_cashtext_checkouts WHERE id=?').bind(data.checkout.id).first<any>()).status).toBe('completed');
 const status=await billingStatus(env,actor);expect(status.modules.cashtext.subscribed).toBe(true);expect(status.modules.cashtext.status).toBe('active');
 expect(await cashtextEntitlement(env,actor.tenantId)).toBe(true);
 // The $99 funnel never saw any of it.
 expect(status.plan.id).toBe('free');expect((await env.AGENT_DB.prepare('SELECT * FROM mayor_billing_subscriptions WHERE tenant_id=?').bind(actor.tenantId).all()).results).toHaveLength(0);
 // Replay of the same event: duplicate outcome, still one row + one commitment.
 expect(await processBillingEvent(env,completed,provider)).toMatchObject({outcome:'duplicate'});
 // A fresh event for the same session/invoice re-runs fulfillment idempotently.
 await processBillingEvent(env,event('invoice.paid',data.invoice),provider);
 await processBillingEvent(env,event('checkout.session.completed',data.session),provider);
 expect(await moduleRows()).toHaveLength(1);expect(await commitments()).toHaveLength(1);
 // The purchase engine event exists exactly once for the module checkout.
 expect((await env.AGENT_DB.prepare("SELECT * FROM mayor_audit WHERE tenant_id=? AND event='engine.purchase_completed' AND resource_id=?").bind(actor.tenantId,data.checkout.id).all()).results).toHaveLength(1);
 // A subscribed tenant cannot buy the module twice.
 await expect(createModuleCheckout(env,actor,crypto.randomUUID(),provider)).rejects.toMatchObject({code:'cashtext_subscription_exists'});
});

it('decline: an unpaid/open session fulfills nothing — no entitlement row, no commitment, honest owner-facing state',async()=>{
 // Test-card decline shape (4000000000000095 class): the session never
 // completes; Stripe leaves it open for a retry with another card.
 await createModuleCheckout(env,actor,crypto.randomUUID(),provider);
 const checkout=await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_checkouts WHERE tenant_id=?').bind(actor.tenantId).first<any>();
 const session=provider.objects.get(`/v1/checkout/sessions/${checkout.stripe_session_id}`)!;
 expect(session.status).toBe('open');expect(session.payment_status).toBe('unpaid');
 expect(await processBillingEvent(env,event('checkout.session.completed',session),provider)).toMatchObject({outcome:'processed'});
 expect(await moduleRows()).toHaveLength(0);expect(await commitments()).toHaveLength(0);
 expect(await cashtextEntitlement(env,actor.tenantId)).toBe(false);
 const status=await billingStatus(env,actor);expect(status.modules.cashtext.subscribed).toBe(false);expect(status.modules.cashtext.status).toBe('not_subscribed');expect(status.modules.cashtext.checkout.pending).toBe(true);
});

it('route: POST module-checkout through the billing route returns the Stripe url; staff cannot',async()=>{
 const request=(role:string)=>new Request(`${env.APP_ORIGIN}/api/businesses/${actor.tenantId}/billing/module-checkout`,{method:'POST',headers:{origin:env.APP_ORIGIN,'content-type':'application/json','idempotency-key':crypto.randomUUID()},body:JSON.stringify({module:'cashtext'})});
 const response=await handleBillingRequest(request('owner'),env,actor,provider);expect(response?.status).toBe(200);expect((await response!.json() as any).url).toContain('checkout.stripe.com');
 await env.AGENT_DB.prepare("UPDATE agent_memberships SET role='staff' WHERE tenant_id=?").bind(actor.tenantId).run();
 await expect(handleBillingRequest(request('staff'),env,actor,provider)).rejects.toMatchObject({code:'permission_denied'});
});

it('cancel toggle: verified Stripe update sets cancel_at_period_end; the deleted event ends entitlement',async()=>{
 const data=await preparePaid();await processBillingEvent(env,event('checkout.session.completed',data.session),provider);
 const toggled=await setCashTextCancelAtPeriodEnd(env,actor,crypto.randomUUID(),true,provider);
 expect(toggled.cancelAtPeriodEnd).toBe(true);expect(toggled.subscribed).toBe(true); // access runs to period end
 const post=provider.calls.find(call=>call.method==='POST'&&call.path===`/v1/subscriptions/${data.subscription.id}`);expect(post?.body).toMatchObject({cancel_at_period_end:true});expect(post?.key).toContain('mayor-pwa:cashtext-cancel:test:');
 data.subscription.status='canceled';await processBillingEvent(env,event('customer.subscription.deleted',data.subscription),provider);
 expect(await cashtextEntitlement(env,actor.tenantId)).toBe(false);
 expect((await billingStatus(env,actor)).modules.cashtext.status).toBe('canceled');
});

it('past_due grace: a fresh past_due row still entitles; a stale one does not',async()=>{
 const data=await preparePaid();await processBillingEvent(env,event('checkout.session.completed',data.session),provider);
 await env.AGENT_DB.prepare("UPDATE mayor_cashtext_subscriptions SET status='past_due' WHERE tenant_id=?").bind(actor.tenantId).run();
 expect(await cashtextEntitlement(env,actor.tenantId)).toBe(true);
 await env.AGENT_DB.prepare("UPDATE mayor_cashtext_subscriptions SET updated_at=? WHERE tenant_id=?").bind(new Date(Date.now()-8*24*3600*1000).toISOString(),actor.tenantId).run();
 expect(await cashtextEntitlement(env,actor.tenantId)).toBe(false);
});

it('cross-tenant bleed: tenant B cannot read or fulfill against tenant A module rows',async()=>{
 const data=await preparePaid();await processBillingEvent(env,event('checkout.session.completed',data.session),provider);
 const other:Actor={tenantId:crypto.randomUUID().replaceAll('-',''),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(other.tenantId,'Other',new Date().toISOString()).run();await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(other.tenantId,other.userId).run();
 expect(await cashtextEntitlement(env,other.tenantId)).toBe(false);
 expect((await billingStatus(env,other)).modules.cashtext.subscribed).toBe(false);
 await expect(handleBillingRequest(new Request(`${env.APP_ORIGIN}/api/businesses/${actor.tenantId}/billing`,{method:'GET'}),env,other,provider)).rejects.toMatchObject({code:'billing_tenant_mismatch'});
});
