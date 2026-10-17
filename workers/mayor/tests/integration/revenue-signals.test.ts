import {env as testEnv} from 'cloudflare:workers';
import {describe,it,expect} from 'vitest';
import type {Env} from '../../src/env';
import {readRevenueSignals,revenueMetric,setRoiConfig} from '../../src/proactive';
import {buildBusinessRoutineBrief} from '../../src/business-routines';
import {confirmProfile} from '../../src/memory';

const env=testEnv as unknown as Env;
// Thursday 2026-10-08 12:00 UTC — same anchor as the proactive suite.
const NOW=Date.parse('2026-10-08T12:00:00Z');

async function fixture(){
 const actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)')
  .bind(actor.tenantId,'Revenue fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')")
  .bind(actor.tenantId,actor.userId).run();
 await confirmProfile(env,actor,{name:'Revenue Salon',vertical:'salon',timeZone:'America/New_York'},0);
 return actor;
}
async function addRecovery(tenantId:string,amountCents:number|null,daysAgo:number){
 await env.AGENT_DB.prepare('INSERT INTO mayor_roi_events(id,tenant_id,kind,occurred_at,amount_cents,meta_json) VALUES(?,?,?,?,?,?)')
  .bind(crypto.randomUUID(),tenantId,'recovery',new Date(NOW-daysAgo*86400000).toISOString(),amountCents,'{}').run();
}

describe('readRevenueSignals (revenue instrumentation)',()=>{
 it('sums recorded recovery amounts in the trailing 30 days',async()=>{
  const actor=await fixture();
  await addRecovery(actor.tenantId,12000,2);
  await addRecovery(actor.tenantId,8550,10);
  await addRecovery(actor.tenantId,99900,40); // outside the window
  const signals=await readRevenueSignals(env,actor.tenantId,NOW);
  expect(signals).toMatchObject({recoveredCents:20550,source:'recorded_amounts',recoveries:2,windowDays:30});
 });

 it('prices amount-less recoveries at the configured average ticket',async()=>{
  const actor=await fixture();
  await setRoiConfig(env,actor,{avgTicketCents:5000});
  await addRecovery(actor.tenantId,null,1);
  await addRecovery(actor.tenantId,7000,3);
  const signals=await readRevenueSignals(env,actor.tenantId,NOW);
  expect(signals).toMatchObject({recoveredCents:12000,source:'configured_avg_ticket',recoveries:2});
 });

 it('stays null when nothing is recorded or configured — never an invented zero',async()=>{
  const actor=await fixture();
  const signals=await readRevenueSignals(env,actor.tenantId,NOW);
  expect(signals.recoveredCents).toBeNull();
  expect(signals.source).toBe('not_configured');
  expect(revenueMetric(signals,'Revenue · not measured')).toEqual({key:'revenue',label:'Revenue · not measured',value:null});
 });

 it('never counts another tenant\u2019s recoveries',async()=>{
  const actor=await fixture(),other=await fixture();
  await addRecovery(other.tenantId,424242,1);
  const signals=await readRevenueSignals(env,actor.tenantId,NOW);
  expect(signals.recoveredCents).toBeNull();
 });

 it('labels the metric with its source',async()=>{
  const actor=await fixture();
  await addRecovery(actor.tenantId,1000,1);
  const signals=await readRevenueSignals(env,actor.tenantId,NOW);
  expect(revenueMetric(signals,'x')).toEqual({key:'revenue',label:'Recovered revenue · last 30 days (recorded amounts)',value:1000});
 });
});

describe('routine brief revenue metric',()=>{
 it('carries the real metric when recoveries are recorded',async()=>{
  const actor=await fixture();
  await addRecovery(actor.tenantId,25000,5);
  const brief=await buildBusinessRoutineBrief(env,actor,['daily-priorities'],NOW);
  expect(brief.metrics).toContainEqual({key:'revenue',label:'Recovered revenue · last 30 days (recorded amounts)',value:25000});
  expect(brief.scope).not.toContain('sales, revenue and benchmarks are not monitored');
 });

 it('keeps the honest null when nothing is recorded',async()=>{
  const actor=await fixture();
  const brief=await buildBusinessRoutineBrief(env,actor,['daily-priorities'],NOW);
  expect(brief.metrics).toContainEqual({key:'revenue',label:'Revenue · not recorded',value:null});
 });
});
