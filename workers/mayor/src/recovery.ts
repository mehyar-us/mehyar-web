import type {Actor,Env} from './env';
import {requireMembership,requireTenant,OPERATORS} from './permissions';
import {reconcileBooking} from './appointments';
import {reconcileAppointmentChange} from './appointment-changes';

type Candidate={kind:'booking'|'change';id:string;tenant_id:string;actor_id:string};
type Observer=(env:Env,actor:Actor,id:string,transport?:typeof fetch)=>Promise<{status:string}>;
const observers={booking:reconcileBooking,change:reconcileAppointmentChange};
/** Read provider state only. Never dispatch a create, update, delete, or release
 * an uncertain reservation. Leases tolerate duplicate scheduled deliveries.
 */
export async function runAppointmentRecovery(env:Env,observe:Record<'booking'|'change',Observer>=observers,now=Date.now()){
 const began=Date.now(),clock=()=>now+Date.now()-began;
 const timestamp=new Date(now).toISOString();
 const exhausted=await env.AGENT_DB.prepare("UPDATE mayor_recovery_attempts SET state='review',last_result='attempts_exhausted',lease_token=NULL,updated_at=? WHERE state='pending' AND attempts>=6 AND lease_until<=?").bind(timestamp,now).run();
 const summary={claimed:0,applied:0,pending:0,review:exhausted.meta.changes,skipped:0};
 const candidates=await env.AGENT_DB.prepare(`SELECT q.kind,q.id,q.tenant_id,q.actor_id FROM (
  SELECT 'booking' AS kind,id,tenant_id,actor_id,updated_at FROM mayor_appointment_jobs WHERE state IN ('running','uncertain')
  UNION ALL SELECT 'change' AS kind,id,tenant_id,actor_id,updated_at FROM mayor_appointment_changes WHERE state IN ('running','uncertain')
 ) q LEFT JOIN mayor_recovery_attempts r ON r.kind=q.kind AND r.request_id=q.id
 WHERE q.updated_at<=? AND (r.request_id IS NULL OR (r.state='pending' AND r.attempts<6 AND r.next_attempt_at<=? AND r.lease_until<=?))
 ORDER BY COALESCE(r.next_attempt_at,0),q.updated_at LIMIT 8`).bind(new Date(now-180000).toISOString(),now,now).all<Candidate>();
 // Bounded sequential work: avoids bursts against one business's provider account.
 for(const candidate of candidates.results){
  const token=crypto.randomUUID(),claimedAt=clock();
  const lease=await env.AGENT_DB.prepare(`INSERT INTO mayor_recovery_attempts(kind,request_id,tenant_id,attempts,state,next_attempt_at,lease_until,lease_token,last_result,updated_at)
   VALUES(?,?,?,1,'pending',?,?,?,'checking',?) ON CONFLICT(kind,request_id) DO UPDATE SET
   attempts=attempts+1,lease_until=excluded.lease_until,lease_token=excluded.lease_token,last_result='checking',updated_at=excluded.updated_at
   WHERE mayor_recovery_attempts.state='pending' AND mayor_recovery_attempts.attempts<6 AND mayor_recovery_attempts.next_attempt_at<=? AND mayor_recovery_attempts.lease_until<=?
   RETURNING attempts`).bind(candidate.kind,candidate.id,candidate.tenant_id,claimedAt,claimedAt+300000,token,new Date(claimedAt).toISOString(),claimedAt,claimedAt).first<{attempts:number}>();
  if(!lease){summary.skipped++;continue;}summary.claimed++;
  let state:'pending'|'complete'|'review'='pending',outcome='uncertain';
  const actor={tenantId:candidate.tenant_id,userId:candidate.actor_id};
  try{
   await requireMembership(env,actor,OPERATORS);
   if((await requireTenant(env,actor)).status!=='active')throw new Error('Workspace unavailable');
   const deadline=AbortSignal.timeout(45000);
   const boundedFetch:typeof fetch=(input,init)=>fetch(input,{...init,signal:init?.signal?AbortSignal.any([deadline,init.signal]):deadline});
   const result=await observe[candidate.kind](env,actor,candidate.id,boundedFetch);
   if(result.status==='applied'){state='complete';outcome='provider_confirmed';}
   else if(result.status==='rejected'){state='complete';outcome='request_rejected';}
  }catch{outcome='access_or_provider_unavailable';}
  if(state==='pending'&&lease.attempts>=6)state='review';
  const finishedAt=clock(),next=finishedAt+Math.min(3600000,300000*2**(lease.attempts-1));
  const results=await env.AGENT_DB.batch([
   env.AGENT_DB.prepare("UPDATE mayor_recovery_attempts SET state=?,next_attempt_at=?,lease_until=0,lease_token=NULL,last_result=?,updated_at=? WHERE kind=? AND request_id=? AND lease_token=?")
    .bind(state,next,outcome,new Date(finishedAt).toISOString(),candidate.kind,candidate.id,token),
   env.AGENT_DB.prepare("INSERT INTO mayor_audit(id,tenant_id,actor_id,event,resource_id,created_at) SELECT ?,?,?,'appointment.recovery_checked',?,? WHERE changes()=1")
    .bind(crypto.randomUUID(),candidate.tenant_id,candidate.actor_id,candidate.id,new Date().toISOString()),
  ]);
  if(results[0].meta.changes!==1){summary.skipped++;continue;}
  if(state==='review')summary.review++;else if(state==='pending')summary.pending++;else if(outcome==='provider_confirmed')summary.applied++;
 }
 return summary;
}
