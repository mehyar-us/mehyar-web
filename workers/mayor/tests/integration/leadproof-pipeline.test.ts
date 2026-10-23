import {env as testEnv} from 'cloudflare:workers';
import {beforeEach,expect,it} from 'vitest';
import type {Actor,Env} from '../../src/env';
import {processBillingEvent} from '../../src/billing/events';
import {createLeadProofCheckout} from '../../src/billing/leadproof';
import {requestLeadProofPack,getLeadProofPack} from '../../src/leadproof/packs';
import {applyRunnerResults,sweepLeadProofTimeouts,type Drafter,type RunnerCompany} from '../../src/leadproof/pipeline';
import {handleLeadProofRunnerRequest,type LeadProofEnv} from '../../src/leadproof/routes';
import {renderLeadProofExport} from '../../src/leadproof/export';
import {LEADPROOF_PACK_PRICE_CENTS,LEADPROOF_PRICE_VERSION} from '../../src/billing/plans';
import {StripeClient,type StripeObject,type StripeEvent} from '../../src/billing/stripe';

/* Phase 6 proof battery (integration spec §4.3/§4.4/§6 item 4, pipeline
 * half): the token-gated Harvey job contract; the evidence gate
 * (observation-less and source-unresolved leads dropped); shortfall →
 * pack failed in the open + credit restored; drafting with the
 * citation check (uncited draft ships without a first line); export
 * stamps; the 24-hour sweep. Drafting is injected — no model call
 * leaves the test. */
const dbEnv=testEnv as unknown as Env;
let env:LeadProofEnv,actor:Actor,provider:FakeStripe;
const TEST_PRICE_ID='price_1UTi8Q8y1yiOc3KfHyWzKUCt';
const price={id:TEST_PRICE_ID,livemode:false,active:true,currency:'usd',unit_amount:LEADPROOF_PACK_PRICE_CENTS,type:'one_time',recurring:null,billing_scheme:'per_unit',tax_behavior:'unspecified',metadata:{mayor_billing_domain:'mayor_leadproof_pack',mayor_leadproof_version:LEADPROOF_PRICE_VERSION}};
class FakeStripe extends StripeClient{
 objects=new Map<string,StripeObject>();lines=new Map<string,StripeObject[]>();
 constructor(){super('sk_test_fixture');this.objects.set(`/v1/prices/${TEST_PRICE_ID}`,structuredClone(price));this.objects.set('/v1/account',{id:'acct_platformfixture',livemode:false});}
 async request(path:string,method:'GET'|'POST'|'DELETE'='GET',body?:Record<string,unknown>){
  const normalized=path.split('?')[0];
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
function event(type:string,object:StripeObject):StripeEvent{return {id:`evt_${crypto.randomUUID().replaceAll('-','')}`,type,created:Math.floor(Date.now()/1000),livemode:false,data:{object}};}
beforeEach(async()=>{
 env={...dbEnv,MAYOR_STRIPE_MODE:'test',MAYOR_STRIPE_SECRET_KEY:'sk_test_fixture',MAYOR_STRIPE_WEBHOOK_SECRET:'whsec_fixture',MAYOR_STRIPE_PRICE_ID:'price_MayorPro',MAYOR_STRIPE_ACCOUNT_ID:'acct_platformfixture',MAYOR_STRIPE_LEADPROOF_PRICE_ID:TEST_PRICE_ID,LEADPROOF_RUNNER_TOKEN:'runner-token-fixture'} as LeadProofEnv;
 provider=new FakeStripe();actor={tenantId:crypto.randomUUID().replaceAll('-',''),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Pipeline fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
});
async function paidPack(){
 await createLeadProofCheckout(env,actor,crypto.randomUUID(),provider);
 const checkout=await env.AGENT_DB.prepare('SELECT * FROM mayor_leadproof_checkouts WHERE tenant_id=?').bind(actor.tenantId).first<any>();
 const session=provider.objects.get(`/v1/checkout/sessions/${checkout.stripe_session_id}`)!;
 Object.assign(session,{status:'complete',payment_status:'paid'});
 await processBillingEvent(env,event('checkout.session.completed',session),provider);
 return requestLeadProofPack(env,actor,{icpText:'Property managers in Brooklyn',icpParams:{category:'property managers',geography:'Brooklyn, NY'}});
}
const goodCompany=(n:number):RunnerCompany=>({name:`Manager ${n} LLC`,website:`https://manager${n}.example.com`,sourceUrl:`https://manager${n}.example.com`,observations:[{text:`Manager ${n} lists twelve Brooklyn buildings and a same-day repairs promise on its rentals page`}]});
const citingDrafter:Drafter=async({observations})=>({whyNow:`Fits right now: ${observations[0].text}`,firstLine:`I noticed this: ${observations[0].text}`,observationId:observations[0].id});
const creditRow=async()=>(await env.AGENT_DB.prepare('SELECT * FROM mayor_leadproof_pack_credits WHERE tenant_id=?').bind(actor.tenantId).all()).results[0] as any;

it('runner door: unconfigured token fails closed (503), wrong token refused (401), queued job listed once and claimed',async()=>{
 const bare={...env,LEADPROOF_RUNNER_TOKEN:undefined} as LeadProofEnv;
 await expect(handleLeadProofRunnerRequest(new Request('https://x/api/leadproof/jobs?status=queued'),bare)).rejects.toMatchObject({status:503,code:'leadproof_runner_unconfigured'});
 await expect(handleLeadProofRunnerRequest(new Request('https://x/api/leadproof/jobs?status=queued',{headers:{authorization:'Bearer wrong'}}),env)).rejects.toMatchObject({status:401});
 const pack=await paidPack();
 const res=await handleLeadProofRunnerRequest(new Request('https://x/api/leadproof/jobs?status=queued',{headers:{authorization:'Bearer runner-token-fixture'}}),env);
 const body=await res!.json() as any;expect(body.jobs).toHaveLength(1);expect(body.jobs[0].id).toBe(pack.id);expect(body.jobs[0].icpParams.category).toBe('property managers');
 expect((await getLeadProofPack(env.AGENT_DB,actor.tenantId,pack.id))?.status).toBe('discovering');
 const again=await handleLeadProofRunnerRequest(new Request('https://x/api/leadproof/jobs?status=queued',{headers:{authorization:'Bearer runner-token-fixture'}}),env);
 expect(((await again!.json()) as any).jobs).toHaveLength(0);
});

it('evidence gate + drafting: 18 good leads ready the pack with cited first lines; dropped leads named; re-applying results is idempotent',async()=>{
 const pack=await paidPack();
 const companies:RunnerCompany[]=[...Array.from({length:18},(_,i)=>goodCompany(i+1)),
  {name:'Ghost PM',website:'https://ghost.example.com',sourceUrl:'https://ghost.example.com',observations:[]},
  {name:'Mismatch PM',website:'https://real.example.com',sourceUrl:'https://aggregated-leads.example.net/listing/9',observations:[{text:'Mismatch PM manages buildings in Brooklyn'}]}];
 const outcome=await applyRunnerResults(env,pack.id,{companies},citingDrafter) as any;
 expect(outcome.status).toBe('ready');expect(outcome.leadCount).toBe(18);
 expect(outcome.dropped).toEqual([{name:'Ghost PM',reason:'no_observation'},{name:'Mismatch PM',reason:'source_unresolved'}]);
 const stored=await getLeadProofPack(env.AGENT_DB,actor.tenantId,pack.id);expect(stored?.status).toBe('ready');expect(stored?.leadCount).toBe(18);
 const leads=(await env.AGENT_DB.prepare('SELECT * FROM mayor_leadproof_leads WHERE pack_id=?').bind(pack.id).all()).results as any[];
 expect(leads).toHaveLength(18);expect(leads[0].first_line).toContain('I noticed this');expect(leads[0].why_now).toContain('Fits right now');
 expect(JSON.parse(leads[0].evidence_json)[0].text).toContain('twelve Brooklyn buildings');
 const again=await applyRunnerResults(env,pack.id,{companies},citingDrafter) as any;
 expect(again.idempotent).toBe(true);expect((await env.AGENT_DB.prepare('SELECT * FROM mayor_leadproof_leads WHERE pack_id=?').bind(pack.id).all()).results).toHaveLength(18);
});

it('citation check: a drafter citing nothing real ships the lead WITHOUT a first line, why_now grounded in the observation itself',async()=>{
 const pack=await paidPack();
 const fabricating:Drafter=async()=>({whyNow:'They won a citywide excellence award in 2026',firstLine:'Congrats on the award!',observationId:'obs-99'});
 const companies=Array.from({length:16},(_,i)=>goodCompany(i+1));
 const outcome=await applyRunnerResults(env,pack.id,{companies},fabricating) as any;
 expect(outcome.status).toBe('ready');
 const leads=(await env.AGENT_DB.prepare('SELECT * FROM mayor_leadproof_leads WHERE pack_id=?').bind(pack.id).all()).results as any[];
 expect(leads.every((lead:any)=>lead.first_line===null)).toBe(true);
 expect(leads[0].why_now).toContain('twelve Brooklyn buildings');
});

it('shortfall: fewer than 15 admitted fails the pack in the open and restores the credit automatically',async()=>{
 const pack=await paidPack();
 const companies=[...Array.from({length:12},(_,i)=>goodCompany(i+1)),
  ...Array.from({length:6},(_,i)=>({name:`Empty ${i}`,website:'https://e.example.com',sourceUrl:'https://e.example.com',observations:[]}))];
 const outcome=await applyRunnerResults(env,pack.id,{companies},citingDrafter) as any;
 expect(outcome.status).toBe('failed');expect(outcome.shortfallReason).toBe('shortfall_evidence_gate');
 const stored=await getLeadProofPack(env.AGENT_DB,actor.tenantId,pack.id);expect(stored?.status).toBe('failed');expect(stored?.shortfallReason).toBe('shortfall_evidence_gate');
 expect((await creditRow()).consumed_by_pack_id).toBeNull();
 // The restored credit is spendable again on a fresh request.
 const second=await requestLeadProofPack(env,actor,{icpText:'Plumbers in Queens',icpParams:{category:'plumbers',geography:'Queens, NY'}});
 expect(second.status).toBe('queued');
});

it('export: a ready pack exports CSV + JSON with evidence attached, and the first export stamps the pack exported',async()=>{
 const pack=await paidPack();
 await applyRunnerResults(env,pack.id,{companies:Array.from({length:15},(_,i)=>goodCompany(i+1))},citingDrafter);
 const csv=await renderLeadProofExport(env,actor,pack.id,'csv');
 expect(csv.contentType).toContain('text/csv');expect(csv.body).toContain('Manager 1 LLC');expect(csv.body).toContain('why_now');expect(csv.body).toContain('twelve Brooklyn buildings');
 const json=JSON.parse((await renderLeadProofExport(env,actor,pack.id,'json')).body);
 expect(json.leads).toHaveLength(15);expect(json.leads[0].evidence[0].text).toContain('Brooklyn buildings');
 const stored=await getLeadProofPack(env.AGENT_DB,actor.tenantId,pack.id);expect(stored?.status).toBe('exported');expect(stored?.exportedAt).toBeTruthy();
});

it('24-hour sweep: a stale queued pack fails with the timeout reason and its credit restores',async()=>{
 const pack=await paidPack();
 await env.AGENT_DB.prepare("UPDATE mayor_leadproof_packs SET created_at=? WHERE id=?").bind(new Date(Date.now()-25*3600_000).toISOString(),pack.id).run();
 expect(await sweepLeadProofTimeouts(env)).toEqual({timedOut:1});
 const stored=await getLeadProofPack(env.AGENT_DB,actor.tenantId,pack.id);expect(stored?.status).toBe('failed');expect(stored?.shortfallReason).toBe('timeout_24h');
 expect((await creditRow()).consumed_by_pack_id).toBeNull();
});
