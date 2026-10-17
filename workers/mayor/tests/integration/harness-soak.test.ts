import {env as testEnv} from 'cloudflare:workers';
import {describe,it,expect} from 'vitest';
import type {Env} from '../../src/env';
import {confirmProfile} from '../../src/memory';
import {runProactiveCycle} from '../../src/proactive';

const env=testEnv as unknown as Env;
const TZ='America/New_York';
const NOW=Date.parse('2026-10-08T12:00:00Z');

async function fixture(){
 const actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)')
  .bind(actor.tenantId,'Soak fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')")
  .bind(actor.tenantId,actor.userId).run();
 await confirmProfile(env,actor,{name:'Soak Salon',vertical:'salon',timeZone:TZ},0);
 return actor;
}
async function setRuntime(tenantId:string,runtime:'do'|'cron'){
 const now=new Date().toISOString();
 await env.AGENT_DB.prepare(`INSERT INTO mayor_memory(tenant_id,field,value_json,source_kind,confirmed_by,confirmed_at,revision,updated_at)
  VALUES(?,'harness_runtime',?,'owner_confirmed',?,?,1,?)`)
  .bind(tenantId,JSON.stringify({runtime}),'operator',now,now).run();
}

/* Soak enablement (2026-10-17): the flag is the single switch —
 * the cron cycle keeps a 'do' tenant's agent armed, and every
 * agent sweep leaves a counts-only heartbeat in D1. */
describe('flag-driven arming + heartbeat',()=>{
 it("a 'do' tenant is armed by the cycle; a 'cron' tenant is not; the sweep heartbeats",async()=>{
  const doTenant=await fixture();
  const cronTenant=await fixture();
  await setRuntime(doTenant.tenantId,'do');
  await runProactiveCycle(env,NOW);
  const doStub=env.MAYOR_BUSINESS.get(env.MAYOR_BUSINESS.idFromName(doTenant.tenantId));
  const doStatus=await doStub.status();
  expect(doStatus.armed).toBe(true);
  expect(doStatus.sweepSchedules).toBe(1);
  const cronStub=env.MAYOR_BUSINESS.get(env.MAYOR_BUSINESS.idFromName(cronTenant.tenantId));
  expect((await cronStub.status()).armed).toBe(false);
  // Run one sweep directly (the alarm fires it in production) and
  // confirm the heartbeat lands in the tenant's own memory.
  await doStub.runSweep();
  const row=await env.AGENT_DB.prepare("SELECT value_json FROM mayor_memory WHERE tenant_id=? AND field='harness_last_sweep'")
   .bind(doTenant.tenantId).first<{value_json:string}>();
  expect(row).not.toBeNull();
  const beat=JSON.parse(row!.value_json) as {ranked:number;pending:number};
  expect(typeof beat.ranked).toBe('number');
  expect(typeof beat.pending).toBe('number');
 });
});
