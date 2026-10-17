import type {Env} from './env';
import {runDetectors,localDayKey,type DetectionRow} from './proactive-detectors';
import {materializeDetection,maybeSendBriefing} from './proactive';
import {planDrain,RANK_DAILY_BUDGET,type QueuedSignal} from './harness-ranking';
import {writeHarnessFinding} from './harness-runtime';

/* Harness rebuild slice 1: one tenant's sweep, run by its
 * MayorBusiness agent on the ruled 15-minute cadence.
 *
 * Sweep = run the five detectors over the tenant's D1 records,
 * enqueue every new detection as a ranking job (the queue lives in
 * the agent's own SQLite — physically per-tenant), then drain the
 * queue in ranked order under the HARD daily budget. Materializing
 * a job = the shared card path (card + surface gate + surface), so
 * a 'do' tenant's cards behave exactly like a 'cron' tenant's.
 *
 * Breach (budget spent with jobs still queued): the jobs PERSIST
 * and drain on later sweeps; detectors keep running; one finding
 * per day is written to D1. Nothing here can stall another tenant:
 * each agent sweeps only its own business. */
export interface SignalQueue{
 enqueue(signal:QueuedSignal):Promise<void>;
 pending():Promise<QueuedSignal[]>;
 markRanked(detectionId:string,day:string):Promise<void>;
 rankedOn(day:string):Promise<number>;
}

async function loadDetections(env:Env,ids:string[]):Promise<Map<string,DetectionRow>>{
 const out=new Map<string,DetectionRow>();
 if(ids.length===0)return out;
 const placeholders=ids.map(()=>'?').join(',');
 const rows=await env.AGENT_DB.prepare(`SELECT * FROM mayor_proactive_detections WHERE id IN (${placeholders})`)
  .bind(...ids).all<DetectionRow>();
 for(const row of rows.results)out.set(row.id,row);
 return out;
}

export interface SweepSummary{
 created:number;ranked:number;surfaced:number;deferred:number;breach:boolean;briefing:boolean;
}

export async function runBusinessSweep(env:Env,tenantId:string,queue:SignalQueue,nowMs=Date.now()):Promise<SweepSummary>{
 const {context,created}=await runDetectors(env,tenantId,nowMs);
 for(const d of created){
  await queue.enqueue({detectionId:d.id,detector:d.detector,queuedAt:nowMs});
 }
 const day=localDayKey(nowMs,context.timeZone);
 const plan=planDrain(await queue.pending(),await queue.rankedOn(day));
 let ranked=0,surfaced=0;
 if(plan.toRank.length>0){
  const rows=await loadDetections(env,plan.toRank.map(s=>s.detectionId));
  for(const signal of plan.toRank){
   const detection=rows.get(signal.detectionId);
   if(detection&&detection.state==='open'){
    const outcome=await materializeDetection(env,context,detection);
    if(outcome==='surfaced')surfaced++;
   }
   // A missing or no-longer-open detection also leaves the queue:
   // the job is done either way, and the budget counts the drain.
   await queue.markRanked(signal.detectionId,day);
   ranked++;
  }
 }
 if(plan.breach){
  await writeHarnessFinding(env,tenantId,'rank_budget_breach',{
   deferred:plan.deferred.length,ranked_today:await queue.rankedOn(day),budget:RANK_DAILY_BUDGET,
  },nowMs,context.timeZone);
 }
 const briefing=await maybeSendBriefing(env,context);
 return {created:created.length,ranked,surfaced,deferred:plan.deferred.length,breach:plan.breach,briefing};
}
