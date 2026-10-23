import {env as testEnv} from 'cloudflare:workers';
import {beforeEach,expect,it} from 'vitest';
import type {Actor,Env} from '../../src/env';
import {handleBillingPublic,handleBillingRequest} from '../../src/billing';
import {cashtextStatus,processConnectEvent,startConnectOnboarding} from '../../src/billing/cashtext';
import {StripeClient,type StripeObject,type StripeEvent} from '../../src/billing/stripe';

/* Phase 2 proof battery (integration spec §6 item 2, Miniflare/D1):
 * CashText Connect — onboarding (Express account + account link +
 * settings row), status sync (read-on-view + account.updated), the
 * separate Connect webhook (own secret, tenant resolved ONLY via
 * mayor_cashtext_settings.stripe_account_id), an invoice lifecycle on
 * the connected account through the {stripeAccount} client extension,
 * payment, and the webhook advancing our row to paid — replay-safe.
 * All test mode, injected transport.
 *
 * Classes, stated exactly: the Stripe-side objects here are served by
 * the injected FakeStripe (transport class). The REAL Stripe test-API
 * results (Connect not enabled on the test platform account; the
 * finalized-invoice footer/description verdict) are in the Phase 2
 * report §3 — they are not claimed by this file. */
const dbEnv=testEnv as unknown as Env;
let env:Env,actor:Actor,provider:FakeStripe;
const CONNECT_SECRET='whsec_connect_fixture';
const PLATFORM_ACCOUNT='acct_platformfixture';
class FakeStripe extends StripeClient{
 accounts=new Map<string,StripeObject>();invoices=new Map<string,StripeObject>();customers=new Map<string,StripeObject>();
 calls:Array<{path:string;method:string;body?:Record<string,unknown>;key?:string;stripeAccount?:string}>=[];
 constructor(){super('sk_test_fixture');}
 async request(path:string,method:'GET'|'POST'|'DELETE'='GET',body?:Record<string,unknown>,key?:string,options?:{stripeAccount?:string}){
  this.calls.push({path,method,body,key,stripeAccount:options?.stripeAccount});const normalized=path.split('?')[0];
  if(method==='GET'&&path==='/v1/account')return {id:PLATFORM_ACCOUNT,livemode:false};
  if(method==='POST'&&path==='/v1/accounts'){const id=`acct_${crypto.randomUUID().replaceAll('-','')}`,object:StripeObject={id,livemode:false,object:'account',type:'express',country:'US',charges_enabled:false,payouts_enabled:false,details_submitted:false,requirements:{},metadata:body?.metadata,capabilities:{card_payments:'pending',transfers:'pending'}};this.accounts.set(id,object);return structuredClone(object);}
  if(method==='POST'&&path==='/v1/account_links'){const account=String(body?.account);if(!this.accounts.has(account))throw new Error(`Fixture missing account: ${account}`);return {object:'account_link',created:Math.floor(Date.now()/1000),expires_at:Math.floor(Date.now()/1000)+300,url:`https://connect.stripe.com/setup/s/${account}`};}
  if(method==='GET'&&normalized.startsWith('/v1/accounts/')){const object=this.accounts.get(normalized.slice('/v1/accounts/'.length));if(!object)throw new Error(`Fixture missing: ${normalized}`);return structuredClone(object);}
  if(method==='POST'&&normalized.startsWith('/v1/accounts/')){const object=this.accounts.get(normalized.slice('/v1/accounts/'.length));if(!object)throw new Error(`Fixture missing: ${normalized}`);Object.assign(object,body);return structuredClone(object);}
  // Connected-account objects (the {stripeAccount} extension's calls).
  if(method==='POST'&&path==='/v1/customers'){const id=`cus_${crypto.randomUUID().replaceAll('-','')}`,object:StripeObject={id,livemode:false,email:body?.email};this.customers.set(id,object);return object;}
  if(method==='POST'&&path==='/v1/invoices'){const id=`in_${crypto.randomUUID().replaceAll('-','')}`,object:StripeObject={id,livemode:false,object:'invoice',customer:body?.customer,status:'draft',collection_method:body?.collection_method,footer:body?.footer??null,description:body?.description??null,total:0};this.invoices.set(id,object);return structuredClone(object);}
  if(method==='POST'&&path==='/v1/invoiceitems'){const invoice=this.invoices.get(String(body?.invoice));if(invoice)invoice.total+=Number(body?.amount??0);return {id:`ii_${crypto.randomUUID().replaceAll('-','')}`,livemode:false};}
  if(method==='POST'&&normalized.startsWith('/v1/invoices/')){
   const invoice=this.invoices.get(normalized.slice('/v1/invoices/'.length).split('/')[0]);if(!invoice)throw new Error(`Fixture missing: ${normalized}`);
   if(normalized.endsWith('/finalize'))invoice.status='open';
   else if(normalized.endsWith('/send'))invoice.hosted_invoice_url=`https://invoice.stripe.com/i/${invoice.id}`;
   else if(normalized.endsWith('/pay'))invoice.status='paid';
   else Object.assign(invoice,body);
   return structuredClone(invoice);
  }
  throw new Error(`Fixture missing: ${method} ${path}`);
 }
}
beforeEach(async()=>{
 env={...dbEnv,MAYOR_STRIPE_MODE:'test',MAYOR_STRIPE_SECRET_KEY:'sk_test_fixture',MAYOR_STRIPE_WEBHOOK_SECRET:'whsec_fixture',MAYOR_STRIPE_CONNECT_WEBHOOK_SECRET:CONNECT_SECRET,MAYOR_STRIPE_CASHTEXT_PRICE_ID:'price_1UTi8B8y1yiOc3KfC6DbiX5f',MAYOR_STRIPE_ACCOUNT_ID:PLATFORM_ACCOUNT};provider=new FakeStripe();actor={tenantId:crypto.randomUUID().replaceAll('-',''),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Connect fixture',new Date().toISOString()).run();await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
});
async function settingsRow(tenantId=actor.tenantId){return env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_settings WHERE tenant_id=?').bind(tenantId).first<any>();}
async function onboard(){const result=await startConnectOnboarding(env,actor,crypto.randomUUID(),provider,true);const row=await settingsRow();return {result,accountId:row.stripe_account_id as string};}
async function seedInvoice(accountTenant=actor,over:Record<string,unknown>={}){
 const customerId=crypto.randomUUID();
 await env.AGENT_DB.prepare('INSERT INTO mayor_customers(id,tenant_id,name,name_key,email,confirmed_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(customerId,accountTenant.tenantId,'Maria Lopez','maria lopez','maria@example.com',accountTenant.userId,new Date().toISOString(),new Date().toISOString()).run();
 const id=crypto.randomUUID(),invoiceId=`in_${crypto.randomUUID().replaceAll('-','')}`;
 await env.AGENT_DB.prepare("INSERT INTO mayor_cashtext_invoices(id,tenant_id,customer_id,stripe_customer_id,stripe_invoice_id,description,amount_cents,status,idempotency_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(id,accountTenant.tenantId,customerId,'cus_fixture',invoiceId,'Water heater install',40000,'sent',`key-${id}`,new Date().toISOString(),new Date().toISOString()).run();
 return {id,invoiceId,...over};
}
function connectEvent(type:string,object:StripeObject,account?:string,created=Math.floor(Date.now()/1000)):StripeEvent{return {id:`evt_${crypto.randomUUID().replaceAll('-','')}`,type,created,livemode:false,account,data:{object}};}
async function sign(payload:string,secret:string){const t=Math.floor(Date.now()/1000),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${t}.${payload}`));return `t=${t},v1=${[...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,'0')).join('')}`;}
async function deliverConnect(event:StripeEvent,secret=CONNECT_SECRET){const payload=JSON.stringify(event);return handleBillingPublic(new Request(`${env.APP_ORIGIN}/api/billing/connect-webhook`,{method:'POST',headers:{'stripe-signature':await sign(payload,secret)},body:payload}),env,provider);}

it('onboarding (gate open in the harness): Express account created with the specced shape, settings row written, account link on connect.stripe.com; a second call reuses the account',async()=>{
 const {result,accountId}=await onboard();
 expect(result.url).toContain('https://connect.stripe.com/setup/s/');expect(result.accountStatus).toBe('pending');
 const creates=provider.calls.filter(call=>call.path==='/v1/accounts'&&call.method==='POST');expect(creates).toHaveLength(1);
 expect(creates[0].body).toMatchObject({type:'express',country:'US',capabilities:{card_payments:{requested:true},transfers:{requested:true}},metadata:{mayor_billing_domain:'mayor_cashtext',mayor_tenant_id:actor.tenantId}});
 expect(creates[0].key).toBe(`mayor-pwa:cashtext-connect:test:${actor.tenantId}`);
 expect(creates[0].stripeAccount).toBeUndefined(); // platform call — the assertion stays platform-only
 const links=provider.calls.filter(call=>call.path==='/v1/account_links');expect(links).toHaveLength(1);
 expect(links[0].body).toMatchObject({account:accountId,type:'account_onboarding',return_url:`${env.APP_ORIGIN}/billing?module=cashtext`,refresh_url:`${env.APP_ORIGIN}/billing?module=cashtext`});
 const row=await settingsRow();expect(row.stripe_account_id).toBe(accountId);expect(row.account_status).toBe('pending');expect(row.charges_enabled).toBe(0);
 await startConnectOnboarding(env,actor,crypto.randomUUID(),provider,true);
 expect(provider.calls.filter(call=>call.path==='/v1/accounts'&&call.method==='POST')).toHaveLength(1);
 expect(provider.calls.filter(call=>call.path==='/v1/account_links')).toHaveLength(2);
});

it('onboarding (gate closed, the production state): the route refuses 503 and nothing is created',async()=>{
 const request=()=>new Request(`${env.APP_ORIGIN}/api/businesses/${actor.tenantId}/billing/connect-onboard`,{method:'POST',headers:{origin:env.APP_ORIGIN,'content-type':'application/json','idempotency-key':crypto.randomUUID()},body:JSON.stringify({module:'cashtext'})});
 await expect(handleBillingRequest(request(),env,actor,provider)).rejects.toMatchObject({code:'cashtext_connect_not_ready'});
 expect(provider.calls).toHaveLength(0);expect(await settingsRow()).toBeNull();
 const status=await cashtextStatus(env,actor,true,Date.now(),provider);
 expect(status.connect).toMatchObject({status:'not_connected',onboardingOpen:false,accountLinked:false});
});

it('status sync: read-on-view refresh mirrors Stripe state into the settings row (pending → active → restricted)',async()=>{
 const {accountId}=await onboard(),account=provider.accounts.get(accountId)!;
 Object.assign(account,{charges_enabled:true,payouts_enabled:true,details_submitted:true});
 const status=await cashtextStatus(env,actor,true,Date.now(),provider);
 expect(status.connect).toMatchObject({status:'active',chargesEnabled:true,payoutsEnabled:true,accountLinked:true});
 expect(await settingsRow()).toMatchObject({account_status:'active',charges_enabled:1,payouts_enabled:1});
 Object.assign(account,{requirements:{disabled_reason:'requirements.past_due'}});
 const refreshed=await handleBillingRequest(new Request(`${env.APP_ORIGIN}/api/businesses/${actor.tenantId}/billing/connect-refresh`,{method:'POST',headers:{origin:env.APP_ORIGIN,'content-type':'application/json','idempotency-key':crypto.randomUUID()},body:JSON.stringify({module:'cashtext'})}),env,actor,provider);
 expect(refreshed?.status).toBe(200);expect((await refreshed!.json() as any).connect.status).toBe('restricted');
 expect((await settingsRow()).account_status).toBe('restricted');
});

it('webhook: account.updated keeps the settings row current; replay is a duplicate',async()=>{
 const {accountId}=await onboard();
 const event=connectEvent('account.updated',{id:accountId,charges_enabled:true,payouts_enabled:true,details_submitted:true,requirements:{}},accountId);
 const response=await deliverConnect(event);expect(response?.status).toBe(200);expect(await response!.json()).toMatchObject({outcome:'processed'});
 expect(await settingsRow()).toMatchObject({account_status:'active',charges_enabled:1,payouts_enabled:1});
 const replay=await deliverConnect(event);expect(await replay!.json()).toMatchObject({outcome:'duplicate'});
});

it('invoice on the connected account: create + finalize + send via the {stripeAccount} extension, pay it, and the Connect webhook advances our row to paid — replay idempotent',async()=>{
 const {accountId}=await onboard();
 const client=provider as unknown as StripeClient;
 const customer=await client.request('/v1/customers','POST',{email:'maria@example.com'},'mayor-pwa:cashtext-customer:fixture',{stripeAccount:accountId});
 const invoice=await client.request('/v1/invoices','POST',{customer:customer.id,collection_method:'send_invoice',days_until_due:7,footer:'Thank you',description:'Water heater install'},'mayor-pwa:cashtext-invoice:fixture',{stripeAccount:accountId});
 await client.request('/v1/invoiceitems','POST',{customer:customer.id,invoice:invoice.id,amount:40000,currency:'usd',description:'Water heater install'},'mayor-pwa:cashtext-item:fixture',{stripeAccount:accountId});
 const finalized=await client.request(`/v1/invoices/${invoice.id}/finalize`,'POST',{},'mayor-pwa:cashtext-finalize:fixture',{stripeAccount:accountId});
 expect(finalized.status).toBe('open');expect(finalized.total).toBe(40000);
 const sent=await client.request(`/v1/invoices/${invoice.id}/send`,'POST',{},'mayor-pwa:cashtext-send:fixture',{stripeAccount:accountId});
 expect(sent.hosted_invoice_url).toContain('invoice.stripe.com');
 // Every connected-account call carried the header; the platform calls never did.
 const connectedCalls=provider.calls.filter(call=>['/v1/customers','/v1/invoices','/v1/invoiceitems'].includes(call.path)||call.path.startsWith('/v1/invoices/'));
 expect(connectedCalls.length).toBeGreaterThan(0);for(const call of connectedCalls)expect(call.stripeAccount).toBe(accountId);
 // Our row for this invoice (Phase 3's executor writes these in production;
 // here the row is the fixture the webhook must advance).
 const seeded=await seedInvoice(actor);await env.AGENT_DB.prepare('UPDATE mayor_cashtext_invoices SET stripe_invoice_id=?,stripe_customer_id=?,hosted_invoice_url=? WHERE id=?').bind(invoice.id,customer.id,sent.hosted_invoice_url,seeded.id).run();
 const paid=await client.request(`/v1/invoices/${invoice.id}/pay`,'POST',{},'mayor-pwa:cashtext-pay:fixture',{stripeAccount:accountId});expect(paid.status).toBe('paid');
 const event=connectEvent('invoice.paid',{id:invoice.id,hosted_invoice_url:sent.hosted_invoice_url},accountId);
 const response=await deliverConnect(event);expect(await response!.json()).toMatchObject({outcome:'processed'});
 const row=await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_invoices WHERE id=?').bind(seeded.id).first<any>();
 expect(row.status).toBe('paid');expect(row.paid_at).toBe(new Date(event.created*1000).toISOString());
 const replay=await deliverConnect(event);expect(await replay!.json()).toMatchObject({outcome:'duplicate'});
 const after=await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_invoices WHERE id=?').bind(seeded.id).first<any>();
 expect(after.status).toBe('paid');expect(after.paid_at).toBe(row.paid_at);
 expect((await env.AGENT_DB.prepare("SELECT * FROM mayor_billing_events WHERE event_id=? AND status='processed'").bind(event.id).all()).results).toHaveLength(1);
});

it('webhook: invoice.sent confirms an approved invoice; invoice.payment_failed changes no state',async()=>{
 const {accountId}=await onboard();const seeded=await seedInvoice(actor);
 await env.AGENT_DB.prepare("UPDATE mayor_cashtext_invoices SET status='approved' WHERE id=?").bind(seeded.id).run();
 expect(await processConnectEvent(env,connectEvent('invoice.sent',{id:seeded.invoiceId,hosted_invoice_url:'https://invoice.stripe.com/i/fixture'},accountId))).toMatchObject({outcome:'processed'});
 let row=await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_invoices WHERE id=?').bind(seeded.id).first<any>();expect(row.status).toBe('sent');expect(row.sent_at).not.toBeNull();
 expect(await processConnectEvent(env,connectEvent('invoice.payment_failed',{id:seeded.invoiceId},accountId))).toMatchObject({outcome:'processed'});
 row=await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_invoices WHERE id=?').bind(seeded.id).first<any>();expect(row.status).toBe('sent');expect(row.paid_at).toBeNull();
});

it('webhook: refund/dispute events on the connected account are noted, never acted on',async()=>{
 const {accountId}=await onboard();const seeded=await seedInvoice(actor);
 for(const type of ['charge.dispute.created','charge.refunded','refund.created']){
  expect(await processConnectEvent(env,connectEvent(type,{id:`ch_${crypto.randomUUID().replaceAll('-','')}`,invoice:seeded.invoiceId},accountId))).toMatchObject({outcome:'noted'});
 }
 const row=await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_invoices WHERE id=?').bind(seeded.id).first<any>();
 expect(row.status).toBe('sent');expect(row.paid_at).toBeNull();
});

it('webhook tenant resolution: ONLY event.account via the settings table — unknown accounts, missing accounts, and metadata spoofs resolve nothing',async()=>{
 const {accountId}=await onboard();const seeded=await seedInvoice(actor);
 expect(await processConnectEvent(env,connectEvent('invoice.paid',{id:seeded.invoiceId},'acct_unknownfixture'))).toMatchObject({outcome:'unrelated_account'});
 expect(await processConnectEvent(env,connectEvent('invoice.paid',{id:seeded.invoiceId},undefined))).toMatchObject({outcome:'unrelated_account'});
 // Metadata naming another tenant cannot move the resolution: the event
 // carries tenant A's account, so only A's rows are in scope — an invoice
 // id from tenant B's book is unrelated here and B's row never changes.
 const other:Actor={tenantId:crypto.randomUUID().replaceAll('-',''),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(other.tenantId,'Other',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO mayor_cashtext_settings(tenant_id,stripe_account_id,account_status,created_at,updated_at) VALUES(?,'acct_otherfixture','active',?,?)").bind(other.tenantId,new Date().toISOString(),new Date().toISOString()).run();
 const foreign=await seedInvoice(other);
 const spoof=connectEvent('invoice.paid',{id:foreign.invoiceId,metadata:{mayor_tenant_id:other.tenantId}},accountId);
 expect(await processConnectEvent(env,spoof)).toMatchObject({outcome:'unrelated_invoice'});
 const brow=await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_invoices WHERE id=?').bind(foreign.id).first<any>();expect(brow.status).toBe('sent');
 const arow=await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_invoices WHERE id=?').bind(seeded.id).first<any>();expect(arow.status).toBe('sent');
});

it('endpoint security: fails closed 503 without its secret, 400 on a bad signature, and the platform endpoint still drops Connect events as unrelated_account',async()=>{
 const {accountId}=await onboard();const seeded=await seedInvoice(actor);
 const event=connectEvent('invoice.paid',{id:seeded.invoiceId},accountId),payload=JSON.stringify(event);
 const unconfigured={...env,MAYOR_STRIPE_CONNECT_WEBHOOK_SECRET:undefined} as Env;
 await expect(handleBillingPublic(new Request(`${env.APP_ORIGIN}/api/billing/connect-webhook`,{method:'POST',headers:{'stripe-signature':await sign(payload,CONNECT_SECRET)},body:payload}),unconfigured,provider)).rejects.toMatchObject({status:503,code:'connect_webhook_not_ready'});
 await expect(deliverConnect(event,'whsec_wrongsecret')).rejects.toMatchObject({status:400,code:'invalid_signature'});
 // The platform endpoint, signed with the PLATFORM secret: the existing
 // unrelated_account drop is exactly why Connect needed its own endpoint.
 const platform=await handleBillingPublic(new Request(`${env.APP_ORIGIN}/api/billing/webhook`,{method:'POST',headers:{'stripe-signature':await sign(payload,'whsec_fixture')},body:payload}),env,provider);
 expect(await platform!.json()).toMatchObject({outcome:'unrelated_account'});
 const row=await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_invoices WHERE id=?').bind(seeded.id).first<any>();expect(row.status).toBe('sent');
});
