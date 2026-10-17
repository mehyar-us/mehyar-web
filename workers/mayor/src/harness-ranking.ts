import type {DetectorName} from './proactive-detectors';
import {DETECTOR_CONFIDENCE} from './proactive';

/* Harness rebuild slice 1: the thin ranker + the HARD daily cap.
 *
 * Ranking in this slice is deliberately deterministic (the spec's
 * "signals + revenue + recency" drain): strongest evidence first
 * (the WS1 confidence levels, mapped server-side from detector
 * evidence), newest first inside a level. decide() takes over the
 * ordering inside this same drain when its harness wiring lands —
 * the queue, the caps, and the breach behavior do not change.
 *
 * THE CAP IS HARD (CoC ruling, 2026-10-16): a tenant may rank at
 * most RANK_DAILY_BUDGET jobs per local day. Beyond it, jobs QUEUE
 * (they persist and drain on later sweeps/days), detectors keep
 * sweeping, and the breach is logged once per day as a finding. */
export const RANK_DAILY_BUDGET=12;

export interface QueuedSignal{
 detectionId:string;
 detector:DetectorName;
 queuedAt:number; // epoch ms
}

export function rankOrder(signals:QueuedSignal[]):QueuedSignal[]{
 return [...signals].sort((a,b)=>{
  const byLevel=DETECTOR_CONFIDENCE[b.detector]-DETECTOR_CONFIDENCE[a.detector];
  if(byLevel!==0)return byLevel;
  return b.queuedAt-a.queuedAt;
 });
}

export interface DrainPlan{
 /** Signals to rank now, in ranked order. */
 toRank:QueuedSignal[];
 /** Signals that stay queued because the daily budget is spent. */
 deferred:QueuedSignal[];
 /** True when work was deferred by the cap — the breach the ruling
  * wants logged (once per day) while everything else keeps running. */
 breach:boolean;
}

export function planDrain(pending:QueuedSignal[],rankedToday:number,budget=RANK_DAILY_BUDGET):DrainPlan{
 const ordered=rankOrder(pending);
 const room=Math.max(0,budget-rankedToday);
 const toRank=ordered.slice(0,room);
 const deferred=ordered.slice(room);
 return {toRank,deferred,breach:deferred.length>0};
}
