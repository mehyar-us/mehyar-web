import {env as testEnv} from 'cloudflare:workers';
import {beforeEach,expect,it} from 'vitest';
import type {Actor,Env} from '../../src/env';
import {billingStatus} from '../../src/billing/service';
import {processBillingEvent} from '../../src/billing/events';
import {createLeadProofCheckout,leadproofSessionEffects} from '../../src/billing/leadproof';
import {requestLeadProofPack} from '../../src/leadproof/packs';
import {LEADPROOF_PACK_PRICE_CENTS,LEADPROOF_PRICE_VERSION} from '../../src/billing/plans';
import {StripeClient,type StripeObject,type StripeEvent} from '../../src/billing/stripe';

/* Phase 5 proof battery (integration spec §6 item 4, billing half;
 * Miniflare/D1, injected transport): pack checkout → verified webhook
 * → exactly ONE pack credit + one commitment; replay → still one;
 * decline → none and the checkout stays resolvable; double-submit
 * discipline; consume spends exactly one credit on a queued pack;
 * a refund landing first makes the credit unspendable; cross-tenant
 * isolation throughout. The configured price id is the REAL Stripe
 * test-mode price minted in Phase 0 (price_1UTi8Q…, read-back
 * verified); the transport serves its verified shape. Test mode only. */
const dbEnv=testEnv as unknown as Env;
let env:Env,actor:Actor,provider:FakeStripe;
const TEST_PRICE_ID='price_1UTi8Q8y1yiOc3KfHyWzKUCt';
const price={id:TEST_PRICE_ID,livemode:false,active:true,currency:'usd',unit_amount:LEADPROOF_PACK_PRICE_CENTS,type:'one_time',recurring:null,billing_scheme:'per_unit',tax_behavior:'unspecified',metadata:{mayor_billing_domain:'mayor_leadproof_pack',mayor_leadproof_version:LEADPROOF_PRICE_VERSION}};
class FakeStripe extends StripeClient{
 objects=new Map<string,StripeObject>();calls:Array<{path:string;method:string;body?:Record<string,unknown>;key?:string}>=[];
 lines=new Map<string,StripeObject[]>();
 constructor(){super('sk_test_fixture');this.objects.set(`/v1/prices/${TEST_PRICE_ID}`,structuredClone(price));this.objects.set('/v1/account',{id:'acct_platformfixture',livemode:false});}
 async request(path:string,method:'GET'|'POST'|'DELETE'='GET',body?:Record<string,unknown>,key?:string){
  this.calls.push({path,method,body,key});const normalized=path.split('?')[0];
  if(method==='POST'&&path==='/v1/customers'){const object={id:`cus_${crypto.randomUUID().replaceAll('-','')}`,livemode:false,metadata:body?.metadata};this.objects.set(`/v1/customers/${object.id}`,object);return object;}
  if(method==='POST'&&path==='/v1/checkout/sessions'){
   const id=`cs_test_${crypto.randomUUID().replaceAll('-','')}`,intentId=`pi_${crypto.randomUUID().replaceAll('-','')}`,chargeId=`ch_${crypto.randomUUID().replaceAll('-','')}`;
   const meta=(body?.payment_intent_data as any)?.metadata??body?.metadata;
   const object={id,livemode:false,metadata:body?.metadata,customer:body?.customer,mode:'payment',status:'open',payment_status:'unpaid',client_reference_id:body?.client_reference_id,expires_at:body?.expires_at,url:`https://checkout.stripe.com/c/pay/${id}`,currency:'usd',amount_subtotal:LEADPROOF_PACK_PRICE_CENTS,amount_total:LEADPROOF_PACK_PRICE_CENTS,total_details:{amount_discount:0,amount_tax:0},payment_intent:intentId};
   this.objects.set(`/v1/checkout/sessions/${id}`,object);
   this.objects.set(`/v1/payment_intents/${intentId}`,{id:intentId,livemode:false,metadata:meta,status:'succeeded',currency:'usd',amount:LEADPROOF_PACK_PRICE_CENTS,amount_received:LEADPROOF_PACK_PRICE_CENTS,customer:body?.customer,latest_charge:chargeId});
   this.objects.set(`/v1/charges/${chargeId}`,{id:chargeId,livemode:false,paid:true,captured:true,amount:LEADPROOF_PACK_PRICE_CENTS,currency:'usd',payment_intent:intentId,customer:body?.customer,refunded:false,amount_refunded:0,disputed:false});
   this.lines.set(id,[{price:TEST_PRICE_ID,quantity:1,currency:'usd',amount_subtotal:LEADPROOF_PACK_PRICE_CENTS,amount_total:LEADPROOF_PACK_PRICE_CENTS}]);
   return object;
  }
  if(method==='GET'&&normalized.endsWith('/line_items')){const sessionId=normalized.split('/')[4];return {data:structuredClone(this.lines.get(sessionId)??[]),has_more:false};}
  const result=this.objects.get(normalized);if(!result)throw new Error(`Fixture missing: ${method} ${normalized}`);return structuredClone(result);
 }
}
beforeEach(async()=>{
 env={...dbEnv,MAYOR_STRIPE_MODE:'test',MAYOR_STRIPE_SECRET_KEY:'sk_test_fixture',MAYOR_STRIPE_WEBHOOK_SECRET:'whsec_fixture',MAYOR_STRIPE_PRICE_ID:'price_MayorPro',MAYOR_STRIPE_ACCOUNT_ID:'acct_platformfixture',MAYOR_STRIPE_LEADPROOF_PRICE_ID:TEST_PRICE_ID} as Env;
 provider=new FakeStripe();actor={tenantId:crypto.randomUUID().replaceAll('-',''),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'LeadProof fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
});
function event(type:string,object:StripeObject,created=Math.floor(Date.now()/1000)):StripeEvent{return {id:`evt_${crypto.randomUUID().replaceAll('-','')}`,type,created,livemode:false,data:{object}};}
async function preparePaid(){
 const requestId=crypto.randomUUID(),created=await createLeadProofCheckout(env,actor,requestId,provider);
 const checkout=await env.AGENT_DB.prepare('SELECT * FROM mayor_leadproof_checkouts WHERE tenant_id=?').bind(actor.tenantId).first<any>();
 const session=provider.objects.get(`/v1/checkout/sessions/${checkout.stripe_session_id}`)!;
 Object.assign(session,{status:'complete',payment_status:'paid'});
 return {requestId,created,checkout,session};
}
const credits=async(t=actor.tenantId)=>(await env.AGENT_DB.prepare('SELECT * FROM mayor_leadproof_pack_credits WHERE tenant_id=?').bind(t).all()).results;
const commitments=async()=>(await env.AGENT_DB.prepare("SELECT * FROM mayor_commitments WHERE tenant_id=? AND kind='lead_pack'").bind(actor.tenantId).all()).results;

it('checkout: row-first, payment mode, domain metadata, request-id replay returns the open session, second request while open → 409 checkout_pending',async()=>{
 const key=crypto.randomUUID(),first=await createLeadProofCheckout(env,actor,key,provider);
 const row=await env.AGENT_DB.prepare('SELECT * FROM mayor_leadproof_checkouts WHERE tenant_id=?').bind(actor.tenantId).first<any>();
 expect(row.status).toBe('open');expect(row.request_id).toBe(key);expect(row.price_id).toBe(TEST_PRICE_ID);expect(row.catalog_version).toBe(LEADPROOF_PRICE_VERSION);
 const posts=provider.calls.filter(c=>c.path==='/v1/checkout/sessions'&&c.method==='POST');expect(posts).toHaveLength(1);
 expect(posts[0].body?.mode).toBe('payment');expect(posts[0].body?.line_items).toEqual([{price:TEST_PRICE_ID,quantity:1}]);
 expect((posts[0].body?.metadata as any)?.mayor_billing_domain).toBe('mayor_leadproof_pack');
 expect((posts[0].body?.payment_intent_data as any)?.metadata?.mayor_leadproof_checkout_id).toBe(row.id);
 expect(posts[0].key).toBe(`mayor-pwa:leadproof:test:${row.id}`);
 const second=await createLeadProofCheckout(env,actor,key,provider);expect(second.url).toBe(first.url);expect(second.replay).toBe(true);
 expect(provider.calls.filter(c=>c.path==='/v1/checkout/sessions'&&c.method==='POST')).toHaveLength(1);
 await expect(createLeadProofCheckout(env,actor,crypto.randomUUID(),provider)).rejects.toMatchObject({code:'checkout_pending'});
});

it('fulfillment (§6.4 billing half): paid session → exactly one credit + one commitment; replay and re-run grant nothing twice; Pro untouched',async()=>{
 const data=await preparePaid(),completed=event('checkout.session.completed',data.session);
 expect(await processBillingEvent(env,completed,provider)).toMatchObject({outcome:'processed'});
 expect((await env.AGENT_DB.prepare('SELECT status FROM mayor_leadproof_checkouts WHERE id=?').bind(data.checkout.id).first<any>()).status).toBe('paid');
 expect(await credits()).toHaveLength(1);
 const rows=await commitments();expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({id:`purchase-intent:${data.checkout.id}`,kind:'lead_pack',plan_ref:'leadproof',amount_cents:LEADPROOF_PACK_PRICE_CENTS,status:'fulfilled'});
 const status=await billingStatus(env,actor);expect(status.modules.leadproof?.creditsHeld).toBe(1);expect(status.plan.id).toBe('free');
 expect((await env.AGENT_DB.prepare('SELECT * FROM mayor_billing_subscriptions WHERE tenant_id=?').bind(actor.tenantId).all()).results).toHaveLength(0);
 expect((await env.AGENT_DB.prepare("SELECT * FROM mayor_audit WHERE tenant_id=? AND event='engine.purchase_completed' AND resource_id=?").bind(actor.tenantId,data.checkout.id).all()).results).toHaveLength(1);
 // Replay of the same event: duplicate outcome, still one credit.
 expect(await processBillingEvent(env,completed,provider)).toMatchObject({outcome:'duplicate'});
 // A fresh event for the same session re-runs fulfillment idempotently.
 await processBillingEvent(env,event('checkout.session.completed',data.session),provider);
 expect(await credits()).toHaveLength(1);expect(await commitments()).toHaveLength(1);
});

it('decline: an unpaid session fulfills nothing — no credit, no commitment — and the checkout stays resolvable',async()=>{
 const requestId=crypto.randomUUID();await createLeadProofCheckout(env,actor,requestId,provider);
 const checkout=await env.AGENT_DB.prepare('SELECT * FROM mayor_leadproof_checkouts WHERE tenant_id=?').bind(actor.tenantId).first<any>();
 // The session never completes (the insufficient-funds outcome at the
 // transport seam): fulfillment effects are empty, the row stays open.
 expect(await leadproofSessionEffects(env,checkout,provider)).toHaveLength(0);
 expect(await credits()).toHaveLength(0);expect(await commitments()).toHaveLength(0);
 const status=await billingStatus(env,actor);expect(status.modules.leadproof?.creditsHeld).toBe(0);expect(status.modules.leadproof?.checkout.pending).toBe(true);
});

it('consume: a confirmed request spends exactly one credit on a queued pack; a second request without a credit refuses; consumer scope refuses in the open',async()=>{
 const data=await preparePaid();
 await processBillingEvent(env,event('checkout.session.completed',data.session),provider);
 const pack=await requestLeadProofPack(env,actor,{icpText:'Property managers in Brooklyn who look busy',icpParams:{category:'property managers',geography:'Brooklyn, NY',qualifiers:['busy'],scope:'businesses'}});
 expect(pack.status).toBe('queued');expect(pack.icpText).toContain('Property managers');
 const creditRows=await credits();expect(creditRows).toHaveLength(1);expect((creditRows[0] as any).consumed_by_pack_id).toBe(pack.id);
 const status=await billingStatus(env,actor);expect(status.modules.leadproof?.creditsHeld).toBe(0);expect(status.modules.leadproof?.packs[0]?.id).toBe(pack.id);
 await expect(requestLeadProofPack(env,actor,{icpText:'Dentists in Queens',icpParams:{category:'dentists',geography:'Queens, NY'}})).rejects.toMatchObject({code:'leadproof_credit_required'});
 await expect(requestLeadProofPack(env,actor,{icpText:'Homeowners in Brooklyn',icpParams:{category:'homeowners',geography:'Brooklyn, NY',scope:'consumers' as never}})).rejects.toMatchObject({code:'leadproof_businesses_only'});
});

it('refund before spend: charge.refunded flips the checkout and the granted credit becomes unspendable',async()=>{
 const data=await preparePaid();
 await processBillingEvent(env,event('checkout.session.completed',data.session),provider);
 expect(await credits()).toHaveLength(1);
 const intent=provider.objects.get(`/v1/payment_intents/${data.session.payment_intent as string}`)!;
 const charge=provider.objects.get(`/v1/charges/${intent.latest_charge as string}`)!;
 Object.assign(charge,{refunded:true,amount_refunded:LEADPROOF_PACK_PRICE_CENTS});
 expect(await processBillingEvent(env,event('charge.refunded',charge),provider)).toMatchObject({outcome:'processed'});
 expect((await env.AGENT_DB.prepare('SELECT status FROM mayor_leadproof_checkouts WHERE id=?').bind(data.checkout.id).first<any>()).status).toBe('refunded');
 const status=await billingStatus(env,actor);expect(status.modules.leadproof?.creditsHeld).toBe(0);
 await expect(requestLeadProofPack(env,actor,{icpText:'Dentists in Queens',icpParams:{category:'dentists',geography:'Queens, NY'}})).rejects.toMatchObject({code:'leadproof_credit_required'});
});

it('cross-tenant: tenant B sees no credits, cannot spend A\'s credit, and A\'s pack is invisible to B',async()=>{
 const data=await preparePaid();
 await processBillingEvent(env,event('checkout.session.completed',data.session),provider);
 const pack=await requestLeadProofPack(env,actor,{icpText:'Plumbers in Brooklyn',icpParams:{category:'plumbers',geography:'Brooklyn, NY'}});
 const other:Actor={tenantId:crypto.randomUUID().replaceAll('-',''),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(other.tenantId,'Other fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(other.tenantId,other.userId).run();
 const statusB=await billingStatus(env,other);expect(statusB.modules.leadproof?.creditsHeld).toBe(0);expect(statusB.modules.leadproof?.packs).toHaveLength(0);
 await expect(requestLeadProofPack(env,other,{icpText:'Plumbers in Brooklyn',icpParams:{category:'plumbers',geography:'Brooklyn, NY'}})).rejects.toMatchObject({code:'leadproof_credit_required'});
 expect(pack.tenantId).toBe(actor.tenantId);
});
