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
 async onStart(){
  this.sql`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`;
  this.sql`CREATE TABLE IF NOT EXISTS signals (detection_id TEXT PRIMARY KEY, detector TEXT NOT NULL, queued_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending', ranked_day TEXT)`;
 }

 private tenantId():string|null{
  const rows=this.sql<{value:string}>`SELECT value FROM meta WHERE key='tenant_id'`;
  return rows[0]?.value??null;
 }

 /** Operator arming (the soak path): records the tenant and starts
  * the 15-minute cadence if it is not already running. Idempotent. */
 async arm(tenantId:string){
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
  await runBusinessSweep(this.env,tenantId,this.signalQueue());
 }
}
