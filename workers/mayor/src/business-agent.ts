import {Agent} from 'agents';
import type {Env} from './env';
import {readHarnessRuntime} from './harness-runtime';
import {runBusinessSweep,type SignalQueue} from './harness-sweep';
import type {QueuedSignal} from './harness-ranking';
import type {DetectorName} from './proactive-detectors';

/* Harness rebuild slice 1 (2026-10-17): one MayorBusiness agent per
 * business (idFromName(tenantId)), per the approved harness memo —
 * physically private SQLite per tenant holds the ranking queue; D1
 * stays the system of record. The agent sweeps on the CoC-ruled
 * 15-minute cadence (scheduleEvery) and drains its queue under the
 * HARD daily cap (see harness-ranking.ts).
 *
 * Ships DARK: an instance does work only while its tenant's
 * harness_runtime flag reads 'do'. If the flag is off (or flips
 * off), the sweep cancels its own schedules and the cron runtime
 * owns the tenant again — exactly one runtime per tenant, always. */
export class MayorBusiness extends Agent<Env>{
 /* Schema setup is idempotent and runs at EVERY entry point, not
  * only onStart: an RPC (arm/status) can reach a fresh instance
  * before onStart's effects are visible, and 'no such table' must
  * never be the soak's first surprise. */
 private ensureSchema(){
  this.sql`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`;
  this.sql`CREATE TABLE IF NOT EXISTS signals (detection_id TEXT PRIMARY KEY, detector TEXT NOT NULL, queued_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending', ranked_day TEXT)`;
 }
 async onStart(){ this.ensureSchema(); }

 private tenantId():string|null{
  this.ensureSchema();
  const rows=this.sql<{value:string}>`SELECT value FROM meta WHERE key='tenant_id'`;
  return rows[0]?.value??null;
 }

 /** Operator arming (the soak path): records the tenant and starts
  * the 15-minute cadence if it is not already running. Idempotent. */
 async arm(tenantId:string){
  this.ensureSchema();
  this.sql`INSERT INTO meta (key,value) VALUES ('tenant_id',${tenantId}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;
  const schedules=await this.listSchedules();
  if(!schedules.some(s=>s.callback==='runSweep')){
   await this.scheduleEvery(900,'runSweep');
  }
  return {armed:true,tenantId};
 }

 private signalQueue():SignalQueue{
  const sql=this.sql.bind(this);
  return {
   enqueue:async(signal:QueuedSignal)=>{
    sql`INSERT OR IGNORE INTO signals (detection_id,detector,queued_at) VALUES (${signal.detectionId},${signal.detector},${signal.queuedAt})`;
   },
   pending:async()=>{
    const rows=sql<{detection_id:string;detector:string;queued_at:number}>`SELECT detection_id,detector,queued_at FROM signals WHERE state='pending' ORDER BY queued_at ASC`;
    return rows.map(r=>({detectionId:r.detection_id,detector:r.detector as DetectorName,queuedAt:r.queued_at}));
   },
   markRanked:async(detectionId:string,day:string)=>{
    sql`UPDATE signals SET state='ranked',ranked_day=${day} WHERE detection_id=${detectionId}`;
   },
   rankedOn:async(day:string)=>{
    const rows=sql<{n:number}>`SELECT COUNT(*) AS n FROM signals WHERE state='ranked' AND ranked_day=${day}`;
    return rows[0]?.n??0;
   },
  };
 }

 /** The cadence callback (scheduleEvery 900s). */
 async runSweep(){
  const tenantId=this.tenantId();
  if(!tenantId)return;
  if(await readHarnessRuntime(this.env,tenantId)!=='do'){
   for(const s of await this.listSchedules())await this.cancelSchedule(s.id);
   return;
  }
  const summary=await runBusinessSweep(this.env,tenantId,this.signalQueue());
  // Soak observability (2026-10-17): every agent sweep leaves a
  // counts-only heartbeat in the tenant's own memory, so the
  // runtime is watchable from D1 without opening the DO.
  const pending=(this.sql<{n:number}>`SELECT COUNT(*) AS n FROM signals WHERE state='pending'`)[0]?.n??0;
  const now=new Date().toISOString();
  await this.env.AGENT_DB.prepare(`INSERT INTO mayor_memory(tenant_id,field,value_json,source_kind,confirmed_by,confirmed_at,revision,updated_at)
   VALUES(?,'harness_last_sweep',?,'system_derived',NULL,?,1,?)
   ON CONFLICT(tenant_id,field) DO UPDATE SET value_json=excluded.value_json,revision=mayor_memory.revision+1,updated_at=excluded.updated_at`)
   .bind(tenantId,JSON.stringify({at:now,...summary,pending}),now,now).run();
 }

 /** Operator/soak read: is this agent armed, and what is queued? */
 async status(){
  this.ensureSchema();
  const tenantId=this.tenantId();
  const schedules=(await this.listSchedules()).filter(s=>s.callback==='runSweep');
  const pending=(this.sql<{n:number}>`SELECT COUNT(*) AS n FROM signals WHERE state='pending'`)[0]?.n??0;
  const total=(this.sql<{n:number}>`SELECT COUNT(*) AS n FROM signals`)[0]?.n??0;
  return {tenantId,armed:schedules.length>0,sweepSchedules:schedules.length,pending,totalSignals:total};
 }
}
