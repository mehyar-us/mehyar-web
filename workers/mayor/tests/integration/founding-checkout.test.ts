import {env as testEnv} from 'cloudflare:workers';
import {beforeEach,expect,it} from 'vitest';
import type {Actor,Env} from '../../src/env';
import {billingStatus,createCheckout} from '../../src/billing/service';
import {processBillingEvent} from '../../src/billing/events';
import {freePeriod} from '../../src/billing/plans';
import {metadata,StripeClient,type StripeObject,type StripeEvent} from '../../src/billing/stripe';
const dbEnv=testEnv as unknown as Env;
let env:Env,actor:Actor,provider:FakeStripe;
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
async function makeTenant():Promise<Actor>{
 const tenant={tenantId:crypto.randomUUID().replaceAll('-',''),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(tenant.tenantId,'Founding fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(tenant.tenantId,tenant.userId).run();
 return tenant;
}
async function seedSubscription(tenantId:string,priceId:string|null,status='active'){
 const now=new Date().toISOString(),checkoutId=crypto.randomUUID();
 await env.AGENT_DB.prepare("INSERT INTO mayor_billing_checkouts(id,tenant_id,mode,request_id,status,created_at,updated_at,cohort) VALUES(?,?,?,?,'completed',?,?,?)").bind(checkoutId,tenantId,'test',crypto.randomUUID(),now,now,priceId?'founding':null).run();
 await env.AGENT_DB.prepare('INSERT INTO mayor_billing_subscriptions(tenant_id,mode,stripe_subscription_id,stripe_customer_id,checkout_id,status,cancel_at_period_end,last_event_created,updated_at,price_id) VALUES(?,?,?,?,?,?,?,?,?,?)')
 .bind(tenantId,'test',`sub_${tenantId.slice(0,12)}`,`cus_${tenantId.slice(0,12)}`,checkoutId,status,0,Math.floor(Date.now()/1000),now,priceId).run();
}
async function seedFoundingSeats(count:number){
 for(let i=0;i<count;i++){const t=await makeTenant();await seedSubscription(t.tenantId,'price_MayorFounding');}
}
beforeEach(async()=>{
 env={...dbEnv,MAYOR_STRIPE_MODE:'test',MAYOR_STRIPE_SECRET_KEY:'sk_test_fixture',MAYOR_STRIPE_WEBHOOK_SECRET:'whsec_fixture',MAYOR_STRIPE_PRICE_ID:'price_MayorPro',MAYOR_STRIPE_FOUNDING_PRICE_ID:'price_MayorFounding',MAYOR_STRIPE_PORTAL_CONFIGURATION:'bpc_Mayor'};provider=new FakeStripe();actor=await makeTenant();
 await env.AGENT_DB.prepare("DELETE FROM mayor_rate_limits WHERE subject LIKE 'mayor:%:platform'").run();
 // The founding seat counter is fleet-global by design: reset it per test.
 await env.AGENT_DB.prepare('DELETE FROM mayor_billing_subscriptions').run();
 await env.AGENT_DB.prepare('DELETE FROM mayor_billing_checkouts').run();
});
function event(type:string,object:StripeObject,created=Math.floor(Date.now()/1000)):StripeEvent{return {id:`evt_${crypto.randomUUID().replaceAll('-','')}`,type,created,livemode:false,data:{object}};}
function sessionCalls(){return provider.calls.filter(call=>call.path==='/v1/checkout/sessions'&&call.method==='POST');}

it('creates a founding checkout on the founding Price with cohort metadata',async()=>{
 const result=await createCheckout(env,actor,crypto.randomUUID(),provider,'founding') as {foundingFallback?:boolean};
 expect(result.foundingFallback).toBeUndefined();const calls=sessionCalls();expect(calls).toHaveLength(1);
 expect(calls[0].body?.line_items).toEqual([{price:'price_MayorFounding',quantity:1}]);
 expect((calls[0].body?.metadata as Record<string,string>)?.mayor_cohort).toBe('founding');
 const row=await env.AGENT_DB.prepare('SELECT cohort FROM mayor_billing_checkouts WHERE tenant_id=?').bind(actor.tenantId).first<{cohort:string}>();expect(row?.cohort).toBe('founding');
 const status=await billingStatus(env,actor);expect(status.founding).toEqual({available:true,seats_total:25,seats_taken:0,seats_remaining:25});
});

it('race for the last seat: one founding wins, the loser is created on the $99 list Price and told plainly',async()=>{
 await seedFoundingSeats(24);
 const winner=await makeTenant(),loser=await makeTenant();
 const won=await createCheckout(env,winner,crypto.randomUUID(),provider,'founding') as {foundingFallback?:boolean};
 expect(won.foundingFallback).toBeUndefined();
 const lost=await createCheckout(env,loser,crypto.randomUUID(),provider,'founding') as {foundingFallback?:boolean};
 expect(lost.foundingFallback).toBe(true);
 const calls=sessionCalls();expect(calls).toHaveLength(2);
 expect(calls[0].body?.line_items).toEqual([{price:'price_MayorFounding',quantity:1}]);
 expect(calls[1].body?.line_items).toEqual([{price:'price_MayorPro',quantity:1}]);
 expect((calls[1].body?.metadata as Record<string,string>)?.mayor_cohort).toBeUndefined();
 expect(JSON.stringify(calls[1].body?.custom_text)).toContain('just filled');
 const loserRow=await env.AGENT_DB.prepare('SELECT cohort FROM mayor_billing_checkouts WHERE tenant_id=?').bind(loser.tenantId).first<{cohort:string}>();expect(loserRow?.cohort).toBe('founding-fallback');
});

it('a canceled founding subscription releases its seat',async()=>{
 await seedFoundingSeats(24);
 const gone=await makeTenant();await seedSubscription(gone.tenantId,'price_MayorFounding','canceled');
 const result=await createCheckout(env,actor,crypto.randomUUID(),provider,'founding') as {foundingFallback?:boolean};
 expect(result.foundingFallback).toBeUndefined();
 expect(sessionCalls()[0].body?.line_items).toEqual([{price:'price_MayorFounding',quantity:1}]);
});

it('a legacy subscription row without a price never counts as a founding seat',async()=>{
 const legacy=await makeTenant();await seedSubscription(legacy.tenantId,null);
 const status=await billingStatus(env,actor);expect(status.founding.seats_taken).toBe(0);expect(status.founding.available).toBe(true);
});

it('a paid founding subscription is recorded at the founding Price and holds its seat',async()=>{
 const requestId=crypto.randomUUID();await createCheckout(env,actor,requestId,provider,'founding');
 const checkout=await env.AGENT_DB.prepare('SELECT * FROM mayor_billing_checkouts WHERE tenant_id=?').bind(actor.tenantId).first<any>();
 const session=provider.objects.get(`/v1/checkout/sessions/${checkout.stripe_session_id}`)!,subscriptionId=`sub_${crypto.randomUUID().replaceAll('-','')}`,invoiceId=`in_${crypto.randomUUID().replaceAll('-','')}`,intentId=`pi_${crypto.randomUUID().replaceAll('-','')}`;
 Object.assign(session,{status:'complete',payment_status:'paid',subscription:subscriptionId});
 const start=freePeriod().periodStart,end=freePeriod().periodEnd;
 const subscription={id:subscriptionId,livemode:false,metadata:metadata(actor.tenantId,checkout.id,'founding'),customer:session.customer,status:'active',cancel_at_period_end:false,latest_invoice:invoiceId,items:{has_more:false,data:[{quantity:1,price:structuredClone(foundingPrice)}]}};
 const invoice={id:invoiceId,livemode:false,customer:session.customer,parent:{subscription_details:{subscription:subscriptionId}},status:'paid',currency:'usd',subtotal:7920,total:7920,amount_paid:7920,amount_remaining:0,billing_reason:'subscription_create',lines:{has_more:false,data:[{amount:7920,currency:'usd',quantity:1,pricing:{price_details:{price:'price_MayorFounding'}},period:{start,end},parent:{subscription_item_details:{proration:false}}}]},payments:{has_more:false,data:[{status:'paid',livemode:false,currency:'usd',invoice:invoiceId,amount_paid:7920,payment:{type:'payment_intent',payment_intent:intentId}}]}};
 provider.objects.set(`/v1/subscriptions/${subscriptionId}`,subscription);provider.objects.set(`/v1/invoices/${invoiceId}`,invoice);provider.objects.set(`/v1/payment_intents/${intentId}`,{id:intentId,livemode:false,status:'succeeded',currency:'usd',amount_received:7920,customer:session.customer});
 await processBillingEvent(env,event('invoice.paid',invoice),provider);
 const status=await billingStatus(env,actor);expect(status.plan.id).toBe('pro');
 const row=await env.AGENT_DB.prepare('SELECT price_id FROM mayor_billing_subscriptions WHERE tenant_id=?').bind(actor.tenantId).first<{price_id:string}>();expect(row?.price_id).toBe('price_MayorFounding');
 expect(status.founding.seats_taken).toBe(1);expect(status.founding.seats_remaining).toBe(24);
});
