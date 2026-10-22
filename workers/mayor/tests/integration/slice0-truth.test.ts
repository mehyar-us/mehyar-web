import {env as testEnv} from 'cloudflare:workers';
import landingHtml from '../../web/index.html?raw';
import auditPageHtml from '../../web/business-audit.html?raw';
import {beforeEach,expect,it} from 'vitest';
import type {Actor,Env} from '../../src/env';
import worker from '../../src';
import {createAuth} from '../../src/auth';
import {digest} from '../../src/http';
import {createCheckout} from '../../src/billing/service';
import {processBillingEvent} from '../../src/billing/events';
import {freePeriod} from '../../src/billing/plans';
import {metadata,StripeClient,type StripeObject,type StripeEvent} from '../../src/billing/stripe';
import {pendingPurchaseDirectives} from '../../src/engine-events';
import {stampedDescriptorHash} from '../../src/product-descriptor';

const dbEnv=testEnv as unknown as Env;
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

let env:Env,provider:FakeStripe;
beforeEach(async()=>{
 env={...dbEnv,MAYOR_STRIPE_MODE:'test',MAYOR_STRIPE_SECRET_KEY:'sk_test_fixture',MAYOR_STRIPE_WEBHOOK_SECRET:'whsec_fixture',MAYOR_STRIPE_PRICE_ID:'price_MayorPro',MAYOR_STRIPE_FOUNDING_PRICE_ID:'price_MayorFounding',MAYOR_STRIPE_PORTAL_CONFIGURATION:'bpc_Mayor'} as Env;
 provider=new FakeStripe();
 await env.AGENT_DB.prepare('DELETE FROM mayor_billing_subscriptions').run();
 await env.AGENT_DB.prepare('DELETE FROM mayor_billing_checkouts').run();
 await env.AGENT_DB.prepare("DELETE FROM mayor_audit WHERE event LIKE 'engine.%'").run();
});

async function makeTenant():Promise<Actor>{
 const tenant={tenantId:crypto.randomUUID().replaceAll('-',''),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(tenant.tenantId,'Slice 0 fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(tenant.tenantId,tenant.userId).run();
 return tenant;
}
async function engineRows(tenantId:string,event:string){
 const rows=await env.AGENT_DB.prepare('SELECT id,resource_id FROM mayor_audit WHERE tenant_id=? AND event=?').bind(tenantId,event).all<{id:string;resource_id:string}>();
 return rows.results;
}
function event(type:string,object:StripeObject,created=Math.floor(Date.now()/1000)):StripeEvent{return {id:`evt_${crypto.randomUUID().replaceAll('-','')}`,type,created,livemode:false,data:{object}};}

it('descriptor: /api/product hash matches the hash stamped on / and /business-audit',async()=>{
 const landing=landingHtml;
 const auditPage=auditPageHtml;
 const assets={fetch:async(request:Request)=>{const path=new URL(request.url).pathname;return new Response(path==='/business-audit'?auditPage:landing,{headers:{'content-type':'text/html; charset=utf-8'}});}};
 const surfaceEnv={...env,ASSETS:assets} as unknown as Env;
 const api=await worker.fetch(new Request('https://mayor.example.test/api/product'),surfaceEnv,{} as ExecutionContext);
 expect(api.status).toBe(200);
 const body=await api.json() as {descriptor:{slogan:string;name:string};descriptorHash:string};
 expect(body.descriptor.name).toBe('The Mayor');
 expect(body.descriptor.slogan).toBe('Mayor. Talk to your business.');
 expect(body.descriptorHash).toMatch(/^[a-f0-9]{64}$/);

 const home=await worker.fetch(new Request('https://mayor.example.test/'),surfaceEnv,{} as ExecutionContext);
 expect(home.status).toBe(200);
 expect(stampedDescriptorHash(await home.text())).toBe(body.descriptorHash);

 const audit=await worker.fetch(new Request('https://mayor.example.test/business-audit'),surfaceEnv,{} as ExecutionContext);
 expect(audit.status).toBe(200);
 expect(stampedDescriptorHash(await audit.text())).toBe(body.descriptorHash);
});

it('§8.2: the audit OG carries no delivery deadline and keeps the final-sale line',async()=>{
 const auditPage=auditPageHtml;
 const og=auditPage.match(/<meta property="og:description" content="([^"]*)">/)?.[1]??'';
 expect(og).not.toContain('3 business days');
 expect(og).toContain('All sales final.');
 const offer=await worker.fetch(new Request('https://mayor.example.test/api/business-audit/offer'),env,{} as ExecutionContext);
 const offerBody=await offer.json() as {offer:{delivery:string}};
 expect(offerBody.offer.delivery).not.toMatch(/business days/);
});

it('sign_up: first business creation writes the ledger event; consent decides the analytics copy',async()=>{
 const ctx=await createAuth(env).$context;
 const user=await ctx.internalAdapter.createUser({email:`${crypto.randomUUID()}@example.test`,name:'Slice 0 owner',emailVerified:true});
 const session=await ctx.internalAdapter.createSession(user.id);
 const row=await env.AGENT_DB.prepare('SELECT token FROM auth_session WHERE id=?').bind(session.id).first<{token:string}>();
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.BETTER_AUTH_SECRET!),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(row!.token));
 const cookie='__Secure-mehyar-agent.session_token='+encodeURIComponent(row!.token+'.'+btoa(String.fromCharCode(...new Uint8Array(signature))));
 const tenantId=(await digest(`mayor-first-business:${user.id}`)).slice(0,32);
 const post=(consent:boolean)=>worker.fetch(new Request('https://mayor.example.test/api/businesses',{method:'POST',headers:{cookie,origin:'https://mayor.example.test','content-type':'application/json',...(consent?{'x-mayor-analytics-consent':'granted'}:{})},body:JSON.stringify({name:'Slice 0 Biz'})}),env,{} as ExecutionContext);

 const first=await post(true);
 expect(first.status).toBe(201);
 const firstBody=await first.json() as {id:string;analyticsEvents?:Array<{name:string;params:Record<string,unknown>}>};
 expect(firstBody.id).toBe(tenantId);
 expect(firstBody.analyticsEvents).toHaveLength(1);
 expect(firstBody.analyticsEvents?.[0].name).toBe('sign_up');
 expect(await engineRows(tenantId,'engine.sign_up')).toHaveLength(1);

 // Repeat start click: tenant already exists — no second event, no copy.
 const second=await post(true);
 expect(second.status).toBe(201);
 expect((await second.json() as {analyticsEvents?:unknown}).analyticsEvents).toBeUndefined();
 expect(await engineRows(tenantId,'engine.sign_up')).toHaveLength(1);
});

it('money path: begin_checkout fires engine-side with the charged value; purchase records once across webhook replays',async()=>{
 const actor=await makeTenant();
 const created=await createCheckout(env,actor,crypto.randomUUID(),provider,undefined,true) as {analyticsEvents?:Array<{name:string;params:{value:number}}>};
 expect(created.analyticsEvents).toHaveLength(1);
 expect(created.analyticsEvents?.[0]).toMatchObject({name:'begin_checkout'});
 expect(created.analyticsEvents?.[0].params.value).toBe(99);
 expect(await engineRows(actor.tenantId,'engine.begin_checkout')).toHaveLength(1);

 // No consent: the operational event still records; no analytics copy exists.
 const silent=await makeTenant();
 const silentResult=await createCheckout(env,silent,crypto.randomUUID(),provider) as {analyticsEvents?:unknown};
 expect(silentResult.analyticsEvents).toBeUndefined();
 expect(await engineRows(silent.tenantId,'engine.begin_checkout')).toHaveLength(1);

 // Complete the paid flow (test mode) and deliver invoice.paid twice.
 const checkout=await env.AGENT_DB.prepare('SELECT * FROM mayor_billing_checkouts WHERE tenant_id=?').bind(actor.tenantId).first<any>();
 const session=provider.objects.get(`/v1/checkout/sessions/${checkout.stripe_session_id}`)!,subscriptionId=`sub_${crypto.randomUUID().replaceAll('-','')}`,invoiceId=`in_${crypto.randomUUID().replaceAll('-','')}`,intentId=`pi_${crypto.randomUUID().replaceAll('-','')}`;
 Object.assign(session,{status:'complete',payment_status:'paid',subscription:subscriptionId});
 const {periodStart:start,periodEnd:end}=freePeriod();
 const subscription={id:subscriptionId,livemode:false,metadata:metadata(actor.tenantId,checkout.id),customer:session.customer,status:'active',cancel_at_period_end:false,latest_invoice:invoiceId,items:{has_more:false,data:[{quantity:1,price:structuredClone(listPrice)}]}};
 const invoice={id:invoiceId,livemode:false,customer:session.customer,parent:{subscription_details:{subscription:subscriptionId}},status:'paid',currency:'usd',subtotal:9900,total:9900,amount_paid:9900,amount_remaining:0,billing_reason:'subscription_create',lines:{has_more:false,data:[{amount:9900,currency:'usd',quantity:1,pricing:{price_details:{price:'price_MayorPro'}},period:{start,end},parent:{subscription_item_details:{proration:false}}}]},payments:{has_more:false,data:[{status:'paid',livemode:false,currency:'usd',invoice:invoiceId,amount_paid:9900,payment:{type:'payment_intent',payment_intent:intentId}}]}};
 provider.objects.set(`/v1/subscriptions/${subscriptionId}`,subscription);provider.objects.set(`/v1/invoices/${invoiceId}`,invoice);provider.objects.set(`/v1/payment_intents/${intentId}`,{id:intentId,livemode:false,status:'succeeded',currency:'usd',amount_received:9900,customer:session.customer});
 await processBillingEvent(env,event('invoice.paid',invoice),provider);
 await processBillingEvent(env,event('invoice.paid',invoice),provider);
 const purchases=await engineRows(actor.tenantId,'engine.purchase_completed');
 expect(purchases).toHaveLength(1);
 expect(purchases[0].resource_id).toBe(invoiceId);

 // The purchase's analytics copy is derivable for the next consented
 // browser surface, with the value actually charged.
 const pending=await pendingPurchaseDirectives(env,actor.tenantId);
 expect(pending).toHaveLength(1);
 expect(pending[0].name).toBe('purchase');
 expect(pending[0].params.value).toBe(99);
 expect(pending[0].params.transaction_id).toBe(invoiceId);
});
