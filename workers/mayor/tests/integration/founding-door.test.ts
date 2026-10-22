/**
 * founding-door.test.ts — Reinvention Slice 1 exit tests: the
 * founding door exercised END TO END through the real surfaces.
 *
 * One test money run, zero manual steps:
 *   stranger signs up through the real worker (POST /api/businesses)
 *     → engine.sign_up in the run ledger; the analytics copy rides
 *       the response ONLY when consent was asserted
 *   founding checkout through the real billing service
 *     → engine.begin_checkout in the ledger; analytics copy (value
 *       79.2, the founding item) only with consent
 *   a Stripe TEST-mode invoice.paid through the real webhook
 *   processor, delivered TWICE (replay)
 *     → engine.purchase_completed exactly once, the tenant's first
 *       Commitment record exactly once, the seat taken from the
 *       subscription row, the founding price read back locked, and
 *       the purchase's analytics copy derivable at value 79.2.
 *
 * Plus the door's refusal: with founding full, a founding checkout
 * can only ever land on the standard Pro price (foundingFallback) —
 * never a founding sale that cannot exist — and no Commitment is
 * written for a fallback.
 *
 * Fixtures mirror tests/integration/founding-checkout.test.ts and
 * tests/integration/slice0-truth.test.ts (same price objects, same
 * invoice/subscription shapes, same session-cookie construction).
 */
import {createHash} from 'node:crypto';
import {env as testEnv} from 'cloudflare:test';
import worker from '../../src/index';
import {beforeEach,describe,expect,it} from 'vitest';
import type {Actor,Env} from '../../src/env';
import {createAuth} from '../../src/auth';
import {billingStatus,createCheckout} from '../../src/billing/service';
import {processBillingEvent} from '../../src/billing/events';
import {foundingSeats} from '../../src/billing/founding';
import {pendingPurchaseDirectives} from '../../src/engine-events';
import {freePeriod} from '../../src/billing/plans';
import {metadata,StripeClient,type StripeObject,type StripeEvent} from '../../src/billing/stripe';

const dbEnv=testEnv as unknown as Env;
let E:Env;
const listPrice={id:'price_MayorPro',livemode:false,active:true,currency:'usd',unit_amount:9900,type:'recurring',recurring:{interval:'month',interval_count:1},billing_scheme:'per_unit',tax_behavior:'exclusive',metadata:{mayor_price_version:'2026-10-16.1'}};
const foundingPrice={id:'price_MayorFounding',livemode:false,active:true,currency:'usd',unit_amount:7920,type:'recurring',recurring:{interval:'month',interval_count:1},billing_scheme:'per_unit',tax_behavior:'exclusive',metadata:{mayor_price_version:'2026-10-16.1',mayor_cohort:'founding'}};

class FakeStripe extends StripeClient{
 objects=new Map<string,StripeObject>();calls:Array<{path:string;method:string;body?:Record<string,unknown>;key?:string}>=[];
 constructor(){super('sk_test_fixture');this.objects.set('/v1/prices/price_MayorPro',structuredClone(listPrice));this.objects.set('/v1/prices/price_MayorFounding',structuredClone(foundingPrice));this.objects.set('/v1/billing_portal/configurations/bpc_Mayor',{active:true,features:{subscription_update:{enabled:false},subscription_cancel:{enabled:true,mode:'at_period_end'}}});}
 async request(path:string,method:'GET'|'POST'|'DELETE'='GET',body?:Record<string,unknown>,key?:string){
  this.calls.push({path,method,body,key});const normalized=path.split('?')[0];
  if(method==='POST'&&path==='/v1/customers'){const object={id:`cus_${crypto.randomUUID().replaceAll('-','')}`,livemode:false,metadata:body?.metadata};this.objects.set(`/v1/customers/${object.id}`,object);return object;}
  if(method==='POST'&&path==='/v1/checkout/sessions'){const id=`cs_test_${crypto.randomUUID().replaceAll('-','')}`,object={id,livemode:false,metadata:body?.metadata,customer:body?.customer,mode:'subscription',status:'open',payment_status:'unpaid',expires_at:Math.floor(Date.now()/1000)+86400,url:`https://checkout.stripe.com/c/pay/${id}`};this.objects.set(`/v1/checkout/sessions/${id}`,object);return object;}
  const result=this.objects.get(normalized);if(!result)throw new Error(`Fixture missing: ${normalized}`);return structuredClone(result);
 }
}

function event(type:string,object:StripeObject,created=Math.floor(Date.now()/1000)):StripeEvent{return {id:`evt_${crypto.randomUUID().replaceAll('-','')}`,type,created,livemode:false,data:{object}};}

async function engineRows(tenantId:string,eventName:string){
 const rows=await E.AGENT_DB.prepare('SELECT id,resource_id FROM mayor_audit WHERE tenant_id=? AND event=?').bind(tenantId,eventName).all<{id:string;resource_id:string}>();
 return rows.results;
}

async function makeActor():Promise<Actor>{
 const tenant={tenantId:crypto.randomUUID().replaceAll('-',''),userId:crypto.randomUUID()};
 await E.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(tenant.tenantId,'Door fixture',new Date().toISOString()).run();
 await E.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(tenant.tenantId,tenant.userId).run();
 return tenant;
}

async function seedSubscription(tenantId:string,priceId:string|null,status='active'){
 const now=new Date().toISOString(),checkoutId=crypto.randomUUID();
 await E.AGENT_DB.prepare("INSERT INTO mayor_billing_checkouts(id,tenant_id,mode,request_id,status,created_at,updated_at,cohort) VALUES(?,?,?,?,'completed',?,?,?)").bind(checkoutId,tenantId,'test',crypto.randomUUID(),now,now,priceId?'founding':null).run();
 await E.AGENT_DB.prepare('INSERT INTO mayor_billing_subscriptions(tenant_id,mode,stripe_subscription_id,stripe_customer_id,checkout_id,status,cancel_at_period_end,last_event_created,updated_at,price_id) VALUES(?,?,?,?,?,?,?,?,?,?)')
 .bind(tenantId,'test',`sub_${tenantId.slice(0,12)}`,`cus_${tenantId.slice(0,12)}`,checkoutId,status,0,Math.floor(Date.now()/1000),now,priceId).run();
}

/** Drives the tenant's founding checkout to paid through the real
 * webhook processor — invoice.paid delivered TWICE (Stripe retries). */
async function payFoundingCheckout(provider:FakeStripe,actor:Actor):Promise<{checkoutId:string;invoiceId:string}>{
 const checkout=await E.AGENT_DB.prepare('SELECT * FROM mayor_billing_checkouts WHERE tenant_id=?').bind(actor.tenantId).first<any>();
 const session=provider.objects.get(`/v1/checkout/sessions/${checkout.stripe_session_id}`)!,subscriptionId=`sub_${crypto.randomUUID().replaceAll('-','')}`,invoiceId=`in_${crypto.randomUUID().replaceAll('-','')}`,intentId=`pi_${crypto.randomUUID().replaceAll('-','')}`;
 Object.assign(session,{status:'complete',payment_status:'paid',subscription:subscriptionId});
 const {periodStart:start,periodEnd:end}=freePeriod();
 const subscription={id:subscriptionId,livemode:false,metadata:metadata(actor.tenantId,checkout.id,'founding'),customer:session.customer,status:'active',cancel_at_period_end:false,latest_invoice:invoiceId,items:{has_more:false,data:[{quantity:1,price:structuredClone(foundingPrice)}]}};
 const invoice={id:invoiceId,livemode:false,customer:session.customer,parent:{subscription_details:{subscription:subscriptionId}},status:'paid',currency:'usd',subtotal:7920,total:7920,amount_paid:7920,amount_remaining:0,billing_reason:'subscription_create',lines:{has_more:false,data:[{amount:7920,currency:'usd',quantity:1,pricing:{price_details:{price:'price_MayorFounding'}},period:{start,end},parent:{subscription_item_details:{proration:false}}}]},payments:{has_more:false,data:[{status:'paid',livemode:false,currency:'usd',invoice:invoiceId,amount_paid:7920,payment:{type:'payment_intent',payment_intent:intentId}}]}};
 provider.objects.set(`/v1/subscriptions/${subscriptionId}`,subscription);provider.objects.set(`/v1/invoices/${invoiceId}`,invoice);provider.objects.set(`/v1/payment_intents/${intentId}`,{id:intentId,livemode:false,status:'succeeded',currency:'usd',amount_received:7920,customer:session.customer});
 await processBillingEvent(E,event('invoice.paid',invoice),provider);
 await processBillingEvent(E,event('invoice.paid',invoice),provider);
 return {checkoutId:checkout.id,invoiceId};
}

beforeEach(async()=>{
 E={...dbEnv,MAYOR_STRIPE_MODE:'test',MAYOR_STRIPE_SECRET_KEY:'sk_test_fixture',MAYOR_STRIPE_WEBHOOK_SECRET:'whsec_fixture',MAYOR_STRIPE_PRICE_ID:'price_MayorPro',MAYOR_STRIPE_FOUNDING_PRICE_ID:'price_MayorFounding',MAYOR_STRIPE_PORTAL_CONFIGURATION:'bpc_Mayor'};
 await E.AGENT_DB.prepare("DELETE FROM mayor_rate_limits WHERE subject LIKE 'mayor:%:platform'").run();
 await E.AGENT_DB.prepare('DELETE FROM mayor_billing_subscriptions').run();
 await E.AGENT_DB.prepare('DELETE FROM mayor_billing_checkouts').run();
 await E.AGENT_DB.prepare('DELETE FROM mayor_commitments').run();
});

describe('Slice 1 — the founding door, end to end',()=>{
 it('a stranger goes door → paid (test mode) → provisioned with zero manual steps; sign_up + begin_checkout in the run',async()=>{
  // ── 1. Signup through the REAL worker surface ────────────────────
  const ctx=await createAuth(E).$context;
  const user=await ctx.internalAdapter.createUser({email:'door-founder@example.test',name:'Door Founder',emailVerified:true});
  const session=await ctx.internalAdapter.createSession(user.id);
  const row=await E.AGENT_DB.prepare('SELECT token FROM auth_session WHERE id=?').bind(session.id).first<{token:string}>();
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(E.BETTER_AUTH_SECRET!),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(row!.token));
  const cookie='__Secure-mehyar-agent.session_token='+encodeURIComponent(row!.token+'.'+btoa(String.fromCharCode(...new Uint8Array(signature))));
  const tenantId=createHash('sha256').update(`mayor-first-business:${user.id}`).digest('hex').slice(0,32);
  const post=(consent:boolean)=>worker.fetch(new Request('https://mayor.example.test/api/businesses',{method:'POST',headers:{cookie,origin:'https://mayor.example.test','content-type':'application/json',...(consent?{'x-mayor-analytics-consent':'granted'}:{})},body:JSON.stringify({name:'Door Beauty Co'})}),E,{} as ExecutionContext);

  const first=await post(true);
  expect(first.status).toBe(201);
  const firstBody=await first.json() as {id:string;analyticsEvents?:Array<{name:string;params:Record<string,unknown>}>};
  expect(firstBody.id).toBe(tenantId);
  // sign_up: ledger row + analytics copy (consent was asserted).
  expect(firstBody.analyticsEvents).toHaveLength(1);
  expect(firstBody.analyticsEvents?.[0].name).toBe('sign_up');
  expect(await engineRows(tenantId,'engine.sign_up')).toHaveLength(1);
  // A repeat creation emits nothing twice.
  const second=await post(true);
  expect(second.status).toBe(201);
  expect((await second.json() as {analyticsEvents?:unknown}).analyticsEvents).toBeUndefined();
  expect(await engineRows(tenantId,'engine.sign_up')).toHaveLength(1);

  // ── 2. The founding checkout (the door's preselected plan) ───────
  // The signup already provisioned the tenant row; complete the
  // fixture membership idempotently (the actor is what matters here).
  await E.AGENT_DB.prepare('INSERT OR IGNORE INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(tenantId,'Door Beauty Co',new Date().toISOString()).run();
  await E.AGENT_DB.prepare("INSERT OR IGNORE INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(tenantId,user.id).run();
  const actor:Actor={tenantId,userId:user.id};
  const provider=new FakeStripe();
  const checkout=await createCheckout(E,actor,'door-checkout-1',provider,'founding',true) as {foundingFallback?:boolean;url:string;analyticsEvents?:Array<{name:string;params:{value:number;items:string}}>};
  expect(checkout.foundingFallback).toBeUndefined();
  expect(checkout.url).toContain('checkout.stripe.com');
  // begin_checkout: ledger row + analytics copy at the founding value.
  expect(await engineRows(tenantId,'engine.begin_checkout')).toHaveLength(1);
  expect(checkout.analyticsEvents).toHaveLength(1);
  expect(checkout.analyticsEvents?.[0]).toMatchObject({name:'begin_checkout'});
  expect(checkout.analyticsEvents?.[0].params.value).toBe(79.2);
  expect(checkout.analyticsEvents?.[0].params.items).toContain('founding');

  // ── 3. Payment, delivered twice ──────────────────────────────────
  const {checkoutId,invoiceId}=await payFoundingCheckout(provider,actor);
  const purchases=await engineRows(tenantId,'engine.purchase_completed');
  expect(purchases).toHaveLength(1); // exactly once across the replay
  expect(purchases[0].resource_id).toBe(invoiceId);
  // The purchase's analytics copy is derivable at the charged value.
  const pending=await pendingPurchaseDirectives(E,tenantId);
  expect(pending).toHaveLength(1);
  expect(pending[0].name).toBe('purchase');
  expect(pending[0].params.value).toBe(79.2);

  // The consumed intent became the tenant's FIRST Commitment —
  // exactly once, derived from the claim, keyed to the checkout.
  const commitments=await E.AGENT_DB.prepare('SELECT id,kind,plan_ref,amount_cents,status FROM mayor_commitments WHERE tenant_id=?').bind(tenantId).all<{id:string;kind:string;plan_ref:string;amount_cents:number;status:string}>();
  expect(commitments.results).toHaveLength(1);
  expect(commitments.results[0]).toMatchObject({id:`purchase-intent:${checkoutId}`,kind:'purchase_intent',plan_ref:'founding',amount_cents:7920,status:'fulfilled'});

  // Provisioned: Pro plan on the founding (locked) price, the seat
  // taken from the subscription row, and billing status carries the
  // fulfilled commitment for the Desk Receipt.
  const status=await billingStatus(E,actor);
  expect(status.plan.id).toBe('pro');
  expect(status.founding).toMatchObject({available:true,seats_taken:1,seats_remaining:24});
  expect(status.commitments).toHaveLength(1);
  expect(status.commitments[0]).toMatchObject({kind:'purchase_intent',plan_ref:'founding',amount_cents:7920,status:'fulfilled'});
  const subRow=await E.AGENT_DB.prepare('SELECT price_id FROM mayor_billing_subscriptions WHERE tenant_id=?').bind(tenantId).first<{price_id:string}>();
  expect(subRow?.price_id).toBe('price_MayorFounding');
  expect((await foundingSeats(E)).seats_taken).toBe(1);
 });

 it('without consent the same money run writes the ledger but NO analytics copies',async()=>{
  const actor=await makeActor();
  const provider=new FakeStripe();
  const checkout=await createCheckout(E,actor,'door-silent-1',provider,'founding',false) as {foundingFallback?:boolean;analyticsEvents?:unknown};
  expect(checkout.foundingFallback).toBeUndefined();
  expect(checkout.analyticsEvents).toBeUndefined();
  expect(await engineRows(actor.tenantId,'engine.begin_checkout')).toHaveLength(1);
  await payFoundingCheckout(provider,actor);
  expect(await engineRows(actor.tenantId,'engine.purchase_completed')).toHaveLength(1);
  const commitments=await E.AGENT_DB.prepare('SELECT COUNT(*) AS n FROM mayor_commitments WHERE tenant_id=?').bind(actor.tenantId).first<{n:number}>();
  expect(commitments?.n).toBe(1); // operational record, not an analytics copy
 });

 it('the door refuses a founding sale that cannot exist: sold out ⇒ the standard Pro price, flagged, no Commitment',async()=>{
  for(let i=0;i<25;i++){
   const t=crypto.randomUUID().replaceAll('-','');
   await E.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(t,`Full ${i}`,new Date().toISOString()).run();
   await seedSubscription(t,'price_MayorFounding');
  }
  const actor=await makeActor();
  const provider=new FakeStripe();
  const checkout=await createCheckout(E,actor,'door-late-1',provider,'founding',false) as {foundingFallback?:boolean};
  expect(checkout.foundingFallback).toBe(true);
  const row=await E.AGENT_DB.prepare('SELECT cohort FROM mayor_billing_checkouts WHERE tenant_id=?').bind(actor.tenantId).first<{cohort:string}>();
  expect(row?.cohort).toBe('founding-fallback');
  const sessions=provider.calls.filter(call=>call.path==='/v1/checkout/sessions'&&call.method==='POST');
  expect(sessions).toHaveLength(1);
  expect(sessions[0].body?.line_items).toEqual([{price:'price_MayorPro',quantity:1}]);
  const commitments=await E.AGENT_DB.prepare('SELECT COUNT(*) AS n FROM mayor_commitments WHERE tenant_id=?').bind(actor.tenantId).first<{n:number}>();
  expect(commitments?.n).toBe(0);
 });
});
