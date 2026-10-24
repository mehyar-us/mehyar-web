import {env as testEnv} from 'cloudflare:workers';
import {beforeEach,expect,it} from 'vitest';
import type {Actor,Env} from '../../src/env';
import {billingStatus} from '../../src/billing/service';
import {cashtextDraftHealth} from '../../src/cashtext/health';
import {getLeadProofPack,listLeadProofPacks} from '../../src/leadproof/packs';
import {renderLeadProofExport} from '../../src/leadproof/export';
import {leadproofQaState,recordLeadProofQa} from '../../src/leadproof/qa';

/* Phase 7 gauntlet battery (integration spec §9 Phase 7): cross-tenant
 * bleed proofs across the module tables (0078 CashText, 0079
 * LeadProof, 0081 cadence) and the §10 kill-criteria instrumentation
 * computing from live rows. Two tenants, A's data everywhere, B must
 * see and touch none of it. */
const dbEnv=testEnv as unknown as Env;
let env:Env,A:Actor,B:Actor;
async function tenant(name:string):Promise<Actor>{
 const actor={tenantId:crypto.randomUUID().replaceAll('-',''),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,name,new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
 return actor;
}
beforeEach(async()=>{
 env={...dbEnv,MAYOR_STRIPE_MODE:'test',MAYOR_STRIPE_SECRET_KEY:'sk_test_fixture',MAYOR_STRIPE_WEBHOOK_SECRET:'whsec_fixture',MAYOR_STRIPE_PRICE_ID:'price_MayorPro'} as Env;
 A=await tenant('Tenant A');B=await tenant('Tenant B');
});

it('cross-tenant bleed: B sees none of A\'s module state — billing status, packs, exports, summaries',async()=>{
 const now=new Date().toISOString();
 // A's CashText footprint: a paid invoice + a Friday summary (0081).
 const customerId=crypto.randomUUID();
 await env.AGENT_DB.prepare("INSERT INTO mayor_customers(id,tenant_id,name,name_key,email,confirmed_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
  .bind(customerId,A.tenantId,'Maria Alvarez','maria alvarez','maria@example.com',A.userId,now,now).run();
 await env.AGENT_DB.prepare("INSERT INTO mayor_cashtext_invoices(id,tenant_id,customer_id,description,amount_cents,currency,status,due_date,idempotency_key,draft_error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
  .bind(crypto.randomUUID(),A.tenantId,customerId,'Bathroom work',40000,'usd','paid','2026-10-20',crypto.randomUUID(),0,now,now).run();
 await env.AGENT_DB.prepare("INSERT INTO mayor_cashtext_summaries(id,tenant_id,week_key,timezone,text,summary_json,created_at) VALUES(?,?,?,?,?,?,?)")
  .bind(crypto.randomUUID(),A.tenantId,'2026-10-19','America/New_York','Friday cash summary — A only.','{}',now).run();
 // A's LeadProof footprint: checkout + credit + a ready pack (0079).
 const checkoutId=crypto.randomUUID(),packId=crypto.randomUUID();
 await env.AGENT_DB.prepare("INSERT INTO mayor_leadproof_checkouts(id,tenant_id,mode,request_id,catalog_version,price_id,status,created_at,updated_at) VALUES(?,?, 'test',?, 'v', 'price_x', 'paid', ?, ?)").bind(checkoutId,A.tenantId,crypto.randomUUID(),now,now).run();
 await env.AGENT_DB.prepare("INSERT INTO mayor_leadproof_pack_credits(id,tenant_id,checkout_id,consumed_by_pack_id,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(),A.tenantId,checkoutId,packId,now,now).run();
 await env.AGENT_DB.prepare("INSERT INTO mayor_leadproof_packs(id,tenant_id,credit_id,icp_text,icp_params_json,status,lead_count,created_at,updated_at) SELECT ?,?,id,?,?, 'ready',15,?,? FROM mayor_leadproof_pack_credits WHERE checkout_id=?").bind(packId,A.tenantId,'Plumbers in Queens', JSON.stringify({category:'plumbers',geography:'Queens, NY',qualifiers:[],scope:'businesses'}),now,now,checkoutId).run();
 // B's reads.
 const statusB=await billingStatus(env,B);
 expect(statusB.modules.leadproof?.creditsHeld).toBe(0);
 expect(statusB.modules.leadproof?.packs).toHaveLength(0);
 expect(await getLeadProofPack(env.AGENT_DB,B.tenantId,packId)).toBeNull();
 expect(await listLeadProofPacks(env.AGENT_DB,B.tenantId)).toHaveLength(0);
 await expect(renderLeadProofExport(env,B,packId,'csv')).rejects.toMatchObject({code:'leadproof_pack_not_found'});
 const summaryB=await env.AGENT_DB.prepare('SELECT * FROM mayor_cashtext_summaries WHERE tenant_id=?').bind(B.tenantId).all();
 expect(summaryB.results).toHaveLength(0);
 // A's own reads still work (the isolation is not a blanket failure).
 const statusA=await billingStatus(env,A);
 expect(statusA.modules.leadproof?.packs[0]?.id).toBe(packId);
});

it('§10 CashText: the draft-error bar computes — not evaluable below 20 sends, tripped above 5% at n≥20',async()=>{
 const now=new Date().toISOString();
 const customerId=crypto.randomUUID();
 await env.AGENT_DB.prepare("INSERT INTO mayor_customers(id,tenant_id,name,name_key,email,confirmed_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
  .bind(customerId,A.tenantId,'Maria Alvarez','maria alvarez','maria@example.com',A.userId,now,now).run();
 const insert=async(tenantId:string,status:string,draftError:number)=>{
  await env.AGENT_DB.prepare("INSERT INTO mayor_cashtext_invoices(id,tenant_id,customer_id,description,amount_cents,currency,status,due_date,idempotency_key,draft_error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(),tenantId,customerId,'Work',100,'usd',status,'2026-10-20',crypto.randomUUID(),draftError,now,now).run();
 };
 for(let i=0;i<19;i++)await insert(A.tenantId,'sent',i===0?1:0);
 let health=await cashtextDraftHealth(env.AGENT_DB,A.tenantId);
 expect(health.approvedSends).toBe(19);expect(health.evaluable).toBe(false);expect(health.tripped).toBe(false);
 await insert(A.tenantId,'sent',1);await insert(A.tenantId,'sent',0);
 health=await cashtextDraftHealth(env.AGENT_DB,A.tenantId);
 expect(health.approvedSends).toBe(21);expect(health.draftErrors).toBe(2);expect(health.evaluable).toBe(true);expect(health.tripped).toBe(true);
 const clean=await cashtextDraftHealth(env.AGENT_DB,B.tenantId);
 expect(clean.approvedSends).toBe(0);expect(clean.errorRate).toBeNull();
});

it('§10 LeadProof: the QA tripwire computes — evaluable at five reviewed packs, tripped above 15% combined bad',async()=>{
 const now=new Date().toISOString();
 // Five packs for A, ten sampled leads each; verdicts land per lead.
 const seedPack=async(badCount:number,fabricatedCount:number)=>{
  const checkoutId=crypto.randomUUID(),creditId=crypto.randomUUID(),packId=crypto.randomUUID();
  await env.AGENT_DB.prepare("INSERT INTO mayor_leadproof_checkouts(id,tenant_id,mode,request_id,catalog_version,price_id,status,created_at,updated_at) VALUES(?,?, 'test', ?, 'v', 'price_x', 'paid', ?, ?)").bind(checkoutId,A.tenantId,crypto.randomUUID(),now,now).run();
  await env.AGENT_DB.prepare("INSERT INTO mayor_leadproof_pack_credits(id,tenant_id,checkout_id,consumed_by_pack_id,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(creditId,A.tenantId,checkoutId,packId,now,now).run();
  await env.AGENT_DB.prepare("INSERT INTO mayor_leadproof_packs(id,tenant_id,credit_id,icp_text,icp_params_json,status,lead_count,created_at,updated_at) VALUES(?,?,?,?,?,'exported',10,?,?)").bind(packId,A.tenantId,creditId,'Plumbers',JSON.stringify({category:'plumbers',geography:'Queens, NY',qualifiers:[],scope:'businesses'}),now,now).run();
  for(let i=0;i<10;i++){
   const leadId=crypto.randomUUID();
   await env.AGENT_DB.prepare("INSERT INTO mayor_leadproof_leads(id,pack_id,tenant_id,company_name,source_url,evidence_json,why_now,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(leadId,packId,A.tenantId,`Co ${i}`,`https://co${i}.example.com`,'[]','why',now).run();
   const verdict=i<fabricatedCount?'fabricated':i<fabricatedCount+badCount?'wrong_fit':'fit';
   await recordLeadProofQa(env.AGENT_DB,{packId,leadId,verdict,reviewer:'gauntlet'});
  }
 };
 await seedPack(3,0);await seedPack(3,0);await seedPack(3,0);await seedPack(3,0);
 let state=await leadproofQaState(env.AGENT_DB,A.tenantId);
 expect(state.packsReviewed).toBe(4);expect(state.evaluable).toBe(false);expect(state.tripped).toBe(false);
 await seedPack(2,1);
 state=await leadproofQaState(env.AGENT_DB,A.tenantId);
 expect(state.packsReviewed).toBe(5);expect(state.leadsSampled).toBe(50);expect(state.combinedBadRate).toBeCloseTo(0.3);expect(state.tripped).toBe(true);
 const other=await leadproofQaState(env.AGENT_DB,B.tenantId);
 expect(other.packsReviewed).toBe(0);expect(other.tripped).toBe(false);
});

