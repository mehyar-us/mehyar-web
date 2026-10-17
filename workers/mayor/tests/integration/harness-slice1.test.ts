import {env as testEnv} from 'cloudflare:workers';
import {describe,it,expect} from 'vitest';
import type {Env} from '../../src/env';
import {confirmProfile} from '../../src/memory';
import {runBusinessSweep,type SignalQueue} from '../../src/harness-sweep';
import {writeHarnessFinding,readHarnessRuntime} from '../../src/harness-runtime';
import {runProactiveCycle} from '../../src/proactive';
import type {QueuedSignal} from '../../src/harness-ranking';

const env=testEnv as unknown as Env;
const TZ='America/New_York';
// Thursday 2026-10-08 08:00 EDT — outside quiet hours.
const NOW=Date.parse('2026-10-08T12:00:00Z');

/** In-memory SignalQueue with the DO store's semantics. */
class MemoryQueue implements SignalQueue{
 signals=new Map<string,QueuedSignal&{state:string;rankedDay?:string}>();
 async enqueue(signal:QueuedSignal){
  if(!this.signals.has(signal.detectionId))this.signals.set(signal.detectionId,{...signal,state:'pending'});
 }
 async pending(){return [...this.signals.values()].filter(s=>s.state==='pending').map(({detectionId,detector,queuedAt})=>({detectionId,detector,queuedAt}));}
 async markRanked(detectionId:string,day:string){const s=this.signals.get(detectionId);if(s){s.state='ranked';s.rankedDay=day;}}
 async rankedOn(day:string){return [...this.signals.values()].filter(s=>s.state==='ranked'&&s.rankedDay===day).length;}
}

async function fixture(){
 const actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)')
  .bind(actor.tenantId,'Harness fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')")
  .bind(actor.tenantId,actor.userId).run();
 await confirmProfile(env,actor,{name:'Harness Salon',vertical:'salon',timeZone:TZ},0);
 return actor;
}
async function addMissedCall(tenantId:string,minutesAgo:number,caller:string,at=NOW){
 const id=crypto.randomUUID();
 const occurred=new Date(at-minutesAgo*60000).toISOString();
 await env.AGENT_DB.prepare(`INSERT INTO mayor_missed_calls(id,tenant_id,caller_number,business_number,occurred_at,source,status,textback_sent_at)
  VALUES(?,?,?,?,?,'test','missed',NULL)`)
  .bind(id,tenantId,caller,'+17477772687',occurred).run();
 return id;
}
async function setRuntime(tenantId:string,runtime:'do'|'cron'){
 const now=new Date().toISOString();
 await env.AGENT_DB.prepare(`INSERT INTO mayor_memory(tenant_id,field,value_json,source_kind,confirmed_by,confirmed_at,revision,updated_at)
  VALUES(?,'harness_runtime',?,'owner_confirmed',?,?,1,?)`)
  .bind(tenantId,JSON.stringify({runtime}),'operator',now,now).run();
}
async function cardCount(tenantId:string){
 const row=await env.AGENT_DB.prepare('SELECT COUNT(*) AS n FROM mayor_suggestion_cards WHERE tenant_id=?').bind(tenantId).first<{n:number}>();
 return row?.n??0;
}
async function findingCount(tenantId:string,kind:string){
 const row=await env.AGENT_DB.prepare('SELECT COUNT(*) AS n FROM mayor_harness_findings WHERE tenant_id=? AND kind=?').bind(tenantId,kind).first<{n:number}>();
 return row?.n??0;
}

describe('runBusinessSweep',()=>{
 it('turns a seeded missed call into a card through the ranked drain',async()=>{
  const actor=await fixture();
  await addMissedCall(actor.tenantId,20,'+17185550001');
  const queue=new MemoryQueue();
  const summary=await runBusinessSweep(env,actor.tenantId,queue,NOW);
  expect(summary.created).toBeGreaterThanOrEqual(1);
  expect(summary.ranked).toBeGreaterThanOrEqual(1);
  expect(await cardCount(actor.tenantId)).toBeGreaterThanOrEqual(1);
  expect(await queue.pending()).toHaveLength(0);
 });

 it('a no-signal sweep creates and ranks nothing',async()=>{
  const actor=await fixture();
  const queue=new MemoryQueue();
  const summary=await runBusinessSweep(env,actor.tenantId,queue,NOW);
  expect(summary.created).toBe(0);
  expect(summary.ranked).toBe(0);
  expect(await cardCount(actor.tenantId)).toBe(0);
 });

 it('cap breach: jobs queue past the budget, one finding per day, and the queue drains next day',async()=>{
  const actor=await fixture();
  for(let i=0;i<13;i++)await addMissedCall(actor.tenantId,20,'+171855501'+String(i).padStart(2,'0'));
  const queue=new MemoryQueue();
  const day1=await runBusinessSweep(env,actor.tenantId,queue,NOW);
  expect(day1.ranked).toBe(12);
  expect(day1.deferred).toBe(1);
  expect(day1.breach).toBe(true);
  expect(await cardCount(actor.tenantId)).toBe(12);
  expect(await findingCount(actor.tenantId,'rank_budget_breach')).toBe(1);
  // Same day again: budget still spent, job still queued, finding NOT duplicated.
  const again=await runBusinessSweep(env,actor.tenantId,queue,NOW+3600000);
  expect(again.deferred).toBe(1);
  expect(await findingCount(actor.tenantId,'rank_budget_breach')).toBe(1);
  // Next day: the queued job drains.
  const day2=await runBusinessSweep(env,actor.tenantId,queue,NOW+86400000);
  expect(day2.ranked).toBe(1);
  expect(day2.deferred).toBe(0);
  expect(await cardCount(actor.tenantId)).toBe(13);
  expect(await queue.pending()).toHaveLength(0);
 });

 it("isolation: one tenant's sweep never touches another tenant",async()=>{
  const a=await fixture();
  const b=await fixture();
  await addMissedCall(a.tenantId,20,'+17185550002');
  await addMissedCall(b.tenantId,20,'+17185550003');
  const queueA=new MemoryQueue();
  await runBusinessSweep(env,a.tenantId,queueA,NOW);
  expect(await cardCount(a.tenantId)).toBeGreaterThanOrEqual(1);
  expect(await cardCount(b.tenantId)).toBe(0);
 });
});

describe('findings dedupe',()=>{
 it('one row per tenant/day/kind regardless of repeats',async()=>{
  const actor=await fixture();
  await writeHarnessFinding(env,actor.tenantId,'rank_budget_breach',{deferred:1},NOW,TZ);
  await writeHarnessFinding(env,actor.tenantId,'rank_budget_breach',{deferred:5},NOW,TZ);
  await writeHarnessFinding(env,actor.tenantId,'other_kind',{},NOW,TZ);
  expect(await findingCount(actor.tenantId,'rank_budget_breach')).toBe(1);
  expect(await findingCount(actor.tenantId,'other_kind')).toBe(1);
 });
});

describe('runtime split',()=>{
 it("the cron cycle skips a 'do' tenant and still serves a 'cron' tenant",async()=>{
  const doTenant=await fixture();
  const cronTenant=await fixture();
  await setRuntime(doTenant.tenantId,'do');
  await addMissedCall(doTenant.tenantId,20,'+17185550004');
  await addMissedCall(cronTenant.tenantId,20,'+17185550005');
  expect(await readHarnessRuntime(env,doTenant.tenantId)).toBe('do');
  await runProactiveCycle(env,NOW);
  expect(await cardCount(doTenant.tenantId)).toBe(0);
  expect(await cardCount(cronTenant.tenantId)).toBeGreaterThanOrEqual(1);
 });
});
