import type {Env} from './env';
import {localDayKey} from './proactive-detectors';

/* Harness rebuild slice 1 (2026-10-17): the per-tenant runtime flag
 * and the findings log.
 *
 * harness_runtime lives in mayor_memory (field 'harness_runtime'):
 * 'cron' (default — the existing proactive cycle runs the tenant)
 * or 'do' (the tenant's MayorBusiness agent runs its detectors on
 * its own 15-minute cadence). A tenant's detectors run in EXACTLY
 * ONE runtime: the cron cycle skips 'do' tenants, and the agent
 * disarms itself if the flag is not 'do'. Any read failure resolves
 * to 'cron' — the proven path is the safe default. */
export type HarnessRuntime='cron'|'do';

export async function readHarnessRuntime(env:Env,tenantId:string):Promise<HarnessRuntime>{
 try{
  const row=await env.AGENT_DB.prepare("SELECT value_json FROM mayor_memory WHERE tenant_id=? AND field='harness_runtime'")
   .bind(tenantId).first<{value_json:string}>();
  if(!row)return 'cron';
  const parsed=JSON.parse(row.value_json) as {runtime?:unknown};
  return parsed.runtime==='do'?'do':'cron';
 }catch{return 'cron';}
}

/** One finding per tenant per day per kind (unique index + OR
 * IGNORE): a breach window is logged once, however many sweeps
 * observe it. Detail carries counts only — no customer data. */
export async function writeHarnessFinding(env:Env,tenantId:string,kind:string,detail:Record<string,unknown>,nowMs=Date.now(),timeZone='UTC'):Promise<void>{
 const day=localDayKey(nowMs,timeZone);
 await env.AGENT_DB.prepare(`INSERT OR IGNORE INTO mayor_harness_findings (id,tenant_id,day,kind,detail_json,created_at)
  VALUES (?,?,?,?,?,?)`)
  .bind(crypto.randomUUID(),tenantId,day,kind,JSON.stringify(detail),new Date(nowMs).toISOString()).run();
}
