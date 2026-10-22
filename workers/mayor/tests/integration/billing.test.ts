import {env as testEnv} from 'cloudflare:workers';
import {beforeEach,expect,it} from 'vitest';
import type {Actor,Env} from '../../src/env';
import {handleBillingRequest,handleBillingPublic} from '../../src/billing';
import {billingStatus,createCheckout,portalSession,syncBilling} from '../../src/billing/service';
import {processBillingEvent} from '../../src/billing/events';
import {billingUsageContext,usageBalance,reserveMonthlyUsage} from '../../src/billing/state';
import {freePeriod} from '../../src/billing/plans';
import {metadata,StripeClient,type StripeObject,type StripeEvent} from '../../src/billing/stripe';
import {claimUsage,usagePolicy} from '../../src/usage';
import {readMemory,confirmProfile} from '../../src/memory';
const dbEnv=testEnv as unknown as Env;
let env:Env,actor:Actor,provider:FakeStripe;
const price={id:'price_MayorPro',livemode:false,active:true,currency:'usd',unit_amount:1400,type:'recurring',recurring:{interval:'month',interval_count:1},billing_scheme:'per_unit',tax_behavior:'exclusive'};
class FakeStripe extends StripeClient{
 objects=new Map<string,StripeObject>();calls:Array<{path:string;method:string;body?:Record<string,unknown>;key?:string}>=[];
 constructor(){super('sk_test_fixture');this.objects.set('/v1/prices/price_MayorPro',structuredClone(price));this.objects.set('/v1/billing_portal/configurations/bpc_Mayor',{active:true,features:{subscription_update:{enabled:false},subscription_cancel:{enabled:true,mode:'at_period_end'}}});}
 async request(path:string,method:'GET'|'POST'|'DELETE'='GET',body?:Record<string,unknown>,key?:string){
  this.calls.push({path,method,body,key});const normalized=path.split('?')[0];
  if(method==='POST'&&path==='/v1/customers'){const object={id:`cus_${crypto.randomUUID().replaceAll('-','')}`,livemode:false,metadata:body?.metadata};this.objects.set(`/v1/customers/${object.id}`,object);return object;}
  if(method==='POST'&&path==='/v1/checkout/sessions'){const id=`cs_test_${crypto.randomUUID().replaceAll('-','')}`,object={id,livemode:false,metadata:body?.metadata,customer:body?.customer,mode:'subscription',status:'open',payment_status:'unpaid',expires_at:Math.floor(Date.now()/1000)+86400,url:`https://checkout.stripe.com/c/pay/${id}`};this.objects.set(`/v1/checkout/sessions/${id}`,object);return object;}
  if(method==='POST'&&path==='/v1/billing_portal/sessions')return {url:'https://billing.stripe.com/p/session/testfixture'};
  const result=this.objects.get(normalized);if(!result)throw new Error(`Fixture missing: ${normalized}`);return structuredClone(result);
 }
}
beforeEach(async()=>{
 env={...dbEnv,MAYOR_STRIPE_MODE:'test',MAYOR_STRIPE_SECRET_KEY:'sk_test_fixture',MAYOR_STRIPE_WEBHOOK_SECRET:'whsec_fixture',MAYOR_STRIPE_PRICE_ID:'price_MayorPro',MAYOR_STRIPE_PORTAL_CONFIGURATION:'bpc_Mayor'};provider=new FakeStripe();actor={tenantId:crypto.randomUUID().replaceAll('-',''),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Billing fixture',new Date().toISOString()).run();await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();await env.AGENT_DB.prepare("DELETE FROM mayor_rate_limits WHERE subject LIKE 'mayor:%:platform'").run();
});
function event(type:string,object:StripeObject,created=Math.floor(Date.now()/1000)):StripeEvent{return {id:`evt_${crypto.randomUUID().replaceAll('-','')}`,type,created,livemode:false,data:{object}};}
async function preparePaid(start=freePeriod().periodStart,end=freePeriod().periodEnd){
 const requestId=crypto.randomUUID();await createCheckout(env,actor,requestId,provider);const checkout=await env.AGENT_DB.prepare('SELECT * FROM mayor_billing_checkouts WHERE tenant_id=?').bind(actor.tenantId).first<any>();
 const session=provider.objects.get(`/v1/checkout/sessions/${checkout.stripe_session_id}`)!,subscriptionId=`sub_${crypto.randomUUID().replaceAll('-','')}`,invoiceId=`in_${crypto.randomUUID().replaceAll('-','')}`,intentId=`pi_${crypto.randomUUID().replaceAll('-','')}`;
 Object.assign(session,{status:'complete',payment_status:'paid',subscription:subscriptionId});
 const subscription={id:subscriptionId,livemode:false,metadata:metadata(actor.tenantId,checkout.id),customer:session.customer,status:'active',cancel_at_period_end:false,latest_invoice:invoiceId,items:{has_more:false,data:[{quantity:1,price:structuredClone(price)}]}};
 const invoice={id:invoiceId,livemode:false,customer:session.customer,parent:{subscription_details:{subscription:subscriptionId}},status:'paid',currency:'usd',subtotal:1400,total:1400,amount_paid:1400,amount_remaining:0,billing_reason:'subscription_create',lines:{has_more:false,data:[{amount:1400,currency:'usd',quantity:1,pricing:{price_details:{price:'price_MayorPro'}},period:{start,end},parent:{subscription_item_details:{proration:false}}}]},payments:{has_more:false,data:[{status:'paid',livemode:false,currency:'usd',invoice:invoiceId,amount_paid:1400,payment:{type:'payment_intent',payment_intent:intentId}}]}};
 provider.objects.set(`/v1/subscriptions/${subscriptionId}`,subscription);provider.objects.set(`/v1/invoices/${invoiceId}`,invoice);provider.objects.set(`/v1/payment_intents/${intentId}`,{id:intentId,livemode:false,status:'succeeded',currency:'usd',amount_received:1400,customer:session.customer});return {requestId,checkout,session,subscription,invoice,intentId};
}
async function seed(kind:'turn'|'minute',count:number,periodKey=freePeriod().periodKey){await env.AGENT_DB.prepare('INSERT INTO mayor_billing_usage_periods(tenant_id,period_key,kind,count) VALUES(?,?,?,?) ON CONFLICT(tenant_id,period_key,kind) DO UPDATE SET count=excluded.count').bind(actor.tenantId,periodKey,kind,count).run();}
it('gives Free a shared calendar-month allowance and ignores operator/profile paid claims',async()=>{
 await env.AGENT_DB.prepare("INSERT INTO mayor_usage_allowances VALUES(?,'extended',?,'fixture')").bind(actor.tenantId,new Date().toISOString()).run();expect(await usagePolicy(env,actor)).toEqual({turns:100,businessTurns:100,minutes:10,businessMinutes:10});
 const status=await billingStatus(env,actor);expect(status.plan.id).toBe('free');expect(status.usage.replies).toEqual({used:0,limit:100,remaining:100});expect(status.usage.voiceMinutes.limit).toBe(10);expect(status.usage.resetAt).toBe(new Date(freePeriod().periodEnd*1000).toISOString());
});
it('atomically shares the last reply across members and preserves separate business counters',async()=>{
 const staff={...actor,userId:crypto.randomUUID()};await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'staff')").bind(actor.tenantId,staff.userId).run();await seed('turn',99);
 const results=await Promise.all([claimUsage(env,actor,'turn'),claimUsage(env,staff,'turn'),claimUsage(env,actor,'turn')]);expect(results.filter(result=>result.allowed)).toHaveLength(1);expect((await usageBalance(env,actor)).usage.replies).toEqual({used:100,limit:100,remaining:0});
});
it('keeps usage shared across tabs but resets at UTC calendar-month boundaries',async()=>{
 const last=Date.UTC(2026,9,31,23,59),context=await billingUsageContext(env,actor,last);await seed('minute',10,context.periodKey);expect((await claimUsage(env,actor,'minute',last)).allowed).toBe(false);expect((await claimUsage(env,actor,'minute',Date.UTC(2026,10,1))).allowed).toBe(true);
});
it('fails closed without complete explicitly matched test/live configuration before provider requests',async()=>{
 await expect(createCheckout({...env,MAYOR_STRIPE_MODE:'live'},actor,crypto.randomUUID(),provider)).rejects.toMatchObject({code:'billing_not_ready'});expect(provider.calls).toHaveLength(0);expect((await billingStatus({...env,MAYOR_STRIPE_WEBHOOK_SECRET:undefined},actor)).readiness.checkout).toBe(false);
});
it('uses only the server Pro price and replays the same checkout request',async()=>{
 const key=crypto.randomUUID(),first=await createCheckout(env,actor,key,provider),second=await createCheckout(env,actor,key,provider);expect(second.url).toBe(first.url);expect(second.replay).toBe(true);const calls=provider.calls.filter(call=>call.path==='/v1/checkout/sessions'&&call.method==='POST');expect(calls).toHaveLength(1);expect(calls[0].body?.line_items).toEqual([{price:'price_MayorPro',quantity:1}]);expect(calls[0].key?.startsWith('mayor-pwa:')).toBe(true);expect((await billingStatus(env,actor)).plan.id).toBe('free');
});
it('requires the current $14 price and does not accept the superseded $29 amount',async()=>{
 expect((await billingStatus(env,actor)).plans.find(plan=>plan.id==='pro')?.priceCents).toBe(1400);
 const configured=provider.objects.get('/v1/prices/price_MayorPro')!;configured.unit_amount=2900;
 await expect(createCheckout(env,actor,crypto.randomUUID(),provider)).rejects.toMatchObject({code:'price_mismatch'});expect(provider.calls.some(call=>call.path==='/v1/checkout/sessions'&&call.method==='POST')).toBe(false);
});
it('rejects a superseded $29 paid invoice without resetting existing calendar consumption',async()=>{
 await seed('turn',19);await seed('minute',2);const data=await preparePaid();Object.assign(data.invoice,{subtotal:2900,total:2900,amount_paid:2900});data.invoice.lines.data[0].amount=2900;data.invoice.payments.data[0].amount_paid=2900;provider.objects.get(`/v1/payment_intents/${data.intentId}`)!.amount_received=2900;
 await expect(processBillingEvent(env,event('invoice.paid',data.invoice),provider)).rejects.toMatchObject({code:'paid_invoice_contract_mismatch'});const balance=await billingStatus(env,actor);expect(balance.plan.id).toBe('free');expect(balance.usage.replies.used).toBe(19);expect(balance.usage.voiceMinutes.used).toBe(2);
});
it('rejects a canonical subscription from a different pricing revision',async()=>{
 const data=await preparePaid();(data.subscription.metadata as Record<string,string>).mayor_price_version='superseded';
 await expect(processBillingEvent(env,event('invoice.paid',data.invoice),provider)).rejects.toMatchObject({code:'billing_ownership_mismatch'});expect((await billingStatus(env,actor)).plan.id).toBe('free');
});
it('recovers an interrupted checkout with the original server receipt key and hides that key from staff',async()=>{
 const key=crypto.randomUUID(),original=provider.objects.get('/v1/prices/price_MayorPro')!;provider.objects.delete('/v1/prices/price_MayorPro');await expect(createCheckout(env,actor,key,provider)).rejects.toThrow();const status=await billingStatus(env,actor);expect(status.checkout).toMatchObject({pending:true,requestId:key});provider.objects.set('/v1/prices/price_MayorPro',original);const recovered=await createCheckout(env,actor,status.checkout.requestId!,provider);expect(recovered.url).toContain('checkout.stripe.com');expect(provider.calls.filter(call=>call.path==='/v1/checkout/sessions'&&call.method==='POST')).toHaveLength(1);await env.AGENT_DB.prepare("UPDATE agent_memberships SET role='staff' WHERE tenant_id=?").bind(actor.tenantId).run();expect((await billingStatus(env,actor)).checkout).toEqual({pending:true});
});
it('requires review before retrying a provider request older than Stripe idempotency retention',async()=>{
 const key=crypto.randomUUID();provider.objects.delete('/v1/prices/price_MayorPro');await expect(createCheckout(env,actor,key,provider)).rejects.toThrow();await env.AGENT_DB.prepare('UPDATE mayor_billing_checkouts SET provider_started_at=? WHERE tenant_id=?').bind(Date.now()-24*3600000,actor.tenantId).run();provider.calls=[];await expect(createCheckout(env,actor,key,provider)).rejects.toMatchObject({code:'checkout_needs_review'});expect(provider.calls).toHaveLength(0);
});
it('recovers an expired abandoned checkout only after canonical Stripe status confirms expiry',async()=>{
 const key=crypto.randomUUID();await createCheckout(env,actor,key,provider);const row=await env.AGENT_DB.prepare('SELECT stripe_session_id FROM mayor_billing_checkouts WHERE tenant_id=?').bind(actor.tenantId).first<{stripe_session_id:string}>();provider.objects.get(`/v1/checkout/sessions/${row!.stripe_session_id}`)!.status='expired';const synced=await syncBilling(env,actor,provider);expect(synced.plan.id).toBe('free');expect(synced.checkout.pending).toBe(false);await expect(createCheckout(env,actor,key,provider)).rejects.toMatchObject({code:'checkout_resolved'});expect((await createCheckout(env,actor,crypto.randomUUID(),provider)).url).toContain('checkout.stripe.com');
});
it('rejects duplicate checkouts and incorrect live price contracts',async()=>{
 await createCheckout(env,actor,crypto.randomUUID(),provider);await expect(createCheckout(env,actor,crypto.randomUUID(),provider)).rejects.toMatchObject({code:'checkout_pending'});provider.objects.get('/v1/prices/price_MayorPro')!.unit_amount=1;
 const fresh={...actor,tenantId:crypto.randomUUID().replaceAll('-','')};await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(fresh.tenantId,'Other',new Date().toISOString()).run();await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(fresh.tenantId,fresh.userId).run();await expect(createCheckout(env,fresh,crypto.randomUUID(),provider)).rejects.toMatchObject({code:'price_mismatch'});
});
it('allows members to read limits but only billing roles to checkout, sync or manage billing',async()=>{
 const request=(action='',origin=env.APP_ORIGIN)=>new Request(`${env.APP_ORIGIN}/api/businesses/${actor.tenantId}/billing${action}`,{method:action?'POST':'GET',headers:action?{origin,'content-type':'application/json','idempotency-key':crypto.randomUUID()}:{},...(action?{body:JSON.stringify(action==='/checkout'?{planId:'pro'}:{})}:{})});
 await env.AGENT_DB.prepare("UPDATE agent_memberships SET role='staff' WHERE tenant_id=?").bind(actor.tenantId).run();expect((await handleBillingRequest(request(),env,actor,provider))?.status).toBe(200);await expect(handleBillingRequest(request('/checkout'),env,actor,provider)).rejects.toMatchObject({code:'permission_denied'});
 await env.AGENT_DB.prepare("UPDATE agent_memberships SET role='owner' WHERE tenant_id=?").bind(actor.tenantId).run();await expect(handleBillingRequest(request('/checkout','https://foreign.example'),env,actor,provider)).rejects.toMatchObject({code:'invalid_origin'});await expect(handleBillingRequest(request(),env,{...actor,tenantId:crypto.randomUUID().replaceAll('-','')},provider)).rejects.toMatchObject({code:'billing_tenant_mismatch'});expect(provider.calls).toHaveLength(0);
});
it('does not unlock Pro from a forged successful return or an unpaid/authentication-required invoice',async()=>{
 const data=await preparePaid();data.invoice.status='open';data.invoice.amount_paid=0;data.invoice.amount_remaining=1400;data.subscription.status='incomplete';
 const response=await handleBillingRequest(new Request(`${env.APP_ORIGIN}/api/businesses/${actor.tenantId}/billing?billing=success&session_id=forged`),env,actor,provider);expect((await response!.json() as any).plan.id).toBe('free');await processBillingEvent(env,event('checkout.session.completed',data.session),provider);expect((await billingStatus(env,actor)).plan.id).toBe('free');expect((await env.AGENT_DB.prepare('SELECT * FROM mayor_billing_paid_periods WHERE tenant_id=?').bind(actor.tenantId).all()).results).toHaveLength(0);
});
it('grants Pro only after an owned settled payment and carries Free usage into its first period',async()=>{
 await seed('turn',35);await seed('minute',4);const data=await preparePaid();await processBillingEvent(env,event('invoice.paid',data.invoice),provider);const status=await billingStatus(env,actor);expect(status.plan.id).toBe('pro');expect(status.usage.replies).toEqual({used:35,limit:1000,remaining:965});expect(status.usage.voiceMinutes).toEqual({used:4,limit:120,remaining:116});expect((await claimUsage(env,actor,'turn')).allowed).toBe(true);expect((await billingStatus(env,actor)).usage.replies.used).toBe(36);
});
it('rejects a stale Free reservation after an upgrade and counts a downgrade without a refill',async()=>{
 await seed('turn',99);const stale=await billingUsageContext(env,actor),data=await preparePaid();await processBillingEvent(env,event('invoice.paid',data.invoice),provider);expect(await reserveMonthlyUsage(env,actor,stale,'turn')).toBeUndefined();expect((await claimUsage(env,actor,'turn')).allowed).toBe(true);const calendar=await env.AGENT_DB.prepare('SELECT count FROM mayor_billing_usage_periods WHERE tenant_id=? AND period_key=? AND kind=\'turn\'').bind(actor.tenantId,freePeriod().periodKey).first<{count:number}>();expect(calendar?.count).toBe(100);await env.AGENT_DB.prepare('UPDATE mayor_billing_paid_periods SET invalidated=1 WHERE tenant_id=?').bind(actor.tenantId).run();expect((await claimUsage(env,actor,'turn')).allowed).toBe(false);expect((await billingStatus(env,actor)).usage.replies.remaining).toBe(0);
});
it('deduplicates webhooks and never refills the allowance from repeated invoice or sync events',async()=>{
 const data=await preparePaid(),paid=event('invoice.paid',data.invoice);await processBillingEvent(env,paid,provider);await claimUsage(env,actor,'minute');expect(await processBillingEvent(env,paid,provider)).toMatchObject({outcome:'duplicate'});await processBillingEvent(env,event('invoice.paid',data.invoice),provider);await syncBilling(env,actor,provider);expect((await billingStatus(env,actor)).usage.voiceMinutes.used).toBe(1);
});
it('rejects foreign ownership, wrong price and unverified settlement without paid access',async()=>{
 const data=await preparePaid();provider.objects.get(`/v1/payment_intents/${data.intentId}`)!.status='requires_action';await expect(processBillingEvent(env,event('invoice.paid',data.invoice),provider)).rejects.toMatchObject({code:'payment_unverified'});expect((await billingStatus(env,actor)).plan.id).toBe('free');
 provider.objects.get(`/v1/payment_intents/${data.intentId}`)!.status='succeeded';data.invoice.lines.data[0].pricing.price_details.price='price_Foreign';await expect(processBillingEvent(env,event('invoice.paid',data.invoice),provider)).rejects.toMatchObject({code:'paid_invoice_contract_mismatch'});data.invoice.lines.data[0].pricing.price_details.price='price_MayorPro';data.subscription.metadata.mayor_tenant_id=crypto.randomUUID().replaceAll('-','');await expect(processBillingEvent(env,event('invoice.paid',data.invoice),provider)).rejects.toMatchObject({code:'billing_ownership_mismatch'});expect((await billingStatus(env,actor)).plan.id).toBe('free');
});
it('requires full payment allocation to the canonical invoice, beyond a succeeded intent or customer credit',async()=>{
 const data=await preparePaid(),payment=data.invoice.payments.data[0];payment.amount_paid=1;await expect(syncBilling(env,actor,provider)).rejects.toMatchObject({code:'payment_unverified'});expect((await billingStatus(env,actor)).plan.id).toBe('free');payment.amount_paid=1400;payment.invoice='in_Foreign';await expect(syncBilling(env,actor,provider)).rejects.toMatchObject({code:'payment_unverified'});payment.invoice=data.invoice.id;payment.livemode=true;await expect(syncBilling(env,actor,provider)).rejects.toMatchObject({code:'stripe_mode_mismatch'});payment.livemode=false;await syncBilling(env,actor,provider);expect((await billingStatus(env,actor)).plan.id).toBe('pro');
});
it('preserves paid-through cancellation and returns to Free with saved business records intact',async()=>{
 const data=await preparePaid();await processBillingEvent(env,event('invoice.paid',data.invoice),provider);await confirmProfile(env,actor,{name:'Saved local business'},0);await claimUsage(env,actor,'turn');data.subscription.status='canceled';data.subscription.cancel_at_period_end=true;await processBillingEvent(env,event('customer.subscription.deleted',data.subscription),provider);expect((await billingStatus(env,actor)).plan.id).toBe('pro');const expired=await billingStatus(env,actor,data.invoice.lines.data[0].period.end*1000);expect(expired.plan.id).toBe('free');expect((await readMemory(env,actor)).profile.name).toBe('Saved local business');expect((await env.AGENT_DB.prepare('SELECT status FROM agent_tenants WHERE id=?').bind(actor.tenantId).first<any>()).status).toBe('active');
});
it('resolves disputed payments through the canonical charge when the event has no customer field',async()=>{
 const data=await preparePaid();await processBillingEvent(env,event('invoice.paid',data.invoice),provider);const charge={id:'ch_MayorDispute',livemode:false,customer:data.session.customer,payment_intent:data.intentId,amount:1400,amount_refunded:0,refunded:false};provider.objects.set(`/v1/charges/${charge.id}`,charge);const disputed=event('charge.dispute.created',{id:'dp_MayorDispute',charge:charge.id});await processBillingEvent(env,disputed,provider);expect((await billingStatus(env,actor)).plan.id).toBe('free');expect(await processBillingEvent(env,disputed,provider)).toMatchObject({outcome:'duplicate'});await processBillingEvent(env,event('invoice.paid',data.invoice),provider);expect((await billingStatus(env,actor)).plan.id).toBe('free');
});
it('invalidates a fully refunded period without a later paid event restoring its allowance',async()=>{
 const data=await preparePaid();await processBillingEvent(env,event('invoice.paid',data.invoice),provider);const charge={id:'ch_MayorRefund',livemode:false,customer:data.session.customer,payment_intent:data.intentId,amount:1400,amount_refunded:1400,refunded:true};provider.objects.set(`/v1/charges/${charge.id}`,charge);await processBillingEvent(env,event('charge.refunded',charge),provider);expect((await billingStatus(env,actor)).plan.id).toBe('free');await syncBilling(env,actor,provider);expect((await billingStatus(env,actor)).plan.id).toBe('free');
});
it('creates a fresh allowance only for a new paid period, while a failed renewal grants nothing',async()=>{
 const data=await preparePaid();await processBillingEvent(env,event('invoice.paid',data.invoice),provider);const initial=(await billingUsageContext(env,actor)).periodKey;await seed('turn',900,initial);
 const start=data.invoice.lines.data[0].period.end,end=start+30*86400,invoice={...structuredClone(data.invoice),id:`in_${crypto.randomUUID().replaceAll('-','')}`,billing_reason:'subscription_cycle',status:'open',amount_paid:0,amount_remaining:1400};invoice.lines.data[0].period={start,end};data.subscription.latest_invoice=invoice.id;data.subscription.status='past_due';provider.objects.set(`/v1/invoices/${invoice.id}`,invoice);await processBillingEvent(env,event('invoice.payment_failed',invoice),provider);expect((await billingStatus(env,actor,start*1000)).plan.id).toBe('free');
 invoice.status='paid';invoice.amount_paid=1400;invoice.amount_remaining=0;invoice.payments.data[0].invoice=invoice.id;data.subscription.status='active';await processBillingEvent(env,event('invoice.paid',invoice),provider);expect((await billingStatus(env,actor,start*1000)).usage.replies).toEqual({used:0,limit:1000,remaining:1000});await processBillingEvent(env,event('invoice.paid',data.invoice,1),provider);expect((await billingStatus(env,actor,start*1000)).usage.replies.used).toBe(0);
});
it('offers a scoped portal with cancellation at period end and no unapproved plan switching',async()=>{
 await preparePaid();const result=await portalSession(env,actor,crypto.randomUUID(),provider);expect(result.url).toBe('https://billing.stripe.com/p/session/testfixture');provider.objects.get('/v1/billing_portal/configurations/bpc_Mayor')!.features.subscription_update.enabled=true;await expect(portalSession(env,actor,crypto.randomUUID(),provider)).rejects.toMatchObject({code:'portal_contract_mismatch'});
});
it('retries failed event processing and rejects simultaneous tenant mutation or changed event payloads',async()=>{
 const data=await preparePaid(),paid=event('invoice.paid',data.invoice);provider.objects.get(`/v1/payment_intents/${data.intentId}`)!.status='requires_action';await expect(processBillingEvent(env,paid,provider)).rejects.toMatchObject({code:'payment_unverified'});provider.objects.get(`/v1/payment_intents/${data.intentId}`)!.status='succeeded';await processBillingEvent(env,paid,provider);await expect(processBillingEvent(env,{...paid,created:paid.created+1},provider)).rejects.toMatchObject({code:'billing_event_conflict'});
 await env.AGENT_DB.prepare('INSERT INTO mayor_billing_leases(tenant_id,mode,token,expires_at) VALUES(?,?,?,?)').bind(actor.tenantId,'test','other-operation',Date.now()+120000).run();await expect(syncBilling(env,actor,provider)).rejects.toMatchObject({code:'billing_busy'});
});
it('verifies actual raw webhook bytes before any provider call and separates sandbox from production mode',async()=>{
 const bytes=new TextEncoder().encode(JSON.stringify(event('unrelated.event',{id:'obj_fixture'}))),timestamp=Math.floor(Date.now()/1000),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.MAYOR_STRIPE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);const input=new Uint8Array(new TextEncoder().encode(`${timestamp}.`).length+bytes.length);input.set(new TextEncoder().encode(`${timestamp}.`));input.set(bytes,new TextEncoder().encode(`${timestamp}.`).length);const signature=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,input)),byte=>byte.toString(16).padStart(2,'0')).join('');
 const request=(body:Uint8Array)=>new Request(`${env.APP_ORIGIN}/api/billing/webhook`,{method:'POST',headers:{'stripe-signature':`t=${timestamp},v1=${signature}`},body});expect((await handleBillingPublic(request(bytes),env,provider))?.status).toBe(200);await expect(handleBillingPublic(request(new TextEncoder().encode('{}')),env,provider)).rejects.toMatchObject({code:'invalid_signature'});await expect(processBillingEvent(env,{...event('invoice.paid',{id:'in_fixture'}),livemode:true},provider)).rejects.toMatchObject({code:'stripe_mode_mismatch'});expect(provider.calls).toHaveLength(0);
});
