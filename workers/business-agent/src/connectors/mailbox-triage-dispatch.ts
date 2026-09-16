import {getAgentByName} from 'agents';
import type {Actor,Env} from '../env';
type Candidate={stream_id:string;message_id:string;receipt_token:string;tenant_id:string;user_id:string};
type Dispatch=(actor:Actor,streamId:string,messageId:string,receipt:string)=>Promise<{ok:boolean;error?:{code:string}}>;
/** Bounded starter dispatcher. Provider/AI readiness and source authority remain
 * enforced by the Agent. Queue leases prevent overlapping schedules; analysis
 * receipts prevent duplicate model work after an uncertain successful callback. */
export async function runMailboxTriageDispatch(env:Env,dispatch?:Dispatch,clock:()=>number=Date.now){
  if(env.MAILBOX_TRIAGE_DISPATCH_ENABLED!=='true'||env.MAILBOX_TRIAGE_ENABLED!=='true'||env.MAILBOX_PROCESSING_ENABLED!=='true'||env.MAILBOX_SYNC_ENABLED!=='true'||env.AI_ENABLED!=='true')
    return {disabled:true,selected:0,complete:0,deferred:0};
  const now=new Date(clock()).toISOString();
  await env.AGENT_DB.prepare("UPDATE agent_mailbox_triage_queue SET state='review_required',lease_token=NULL,lease_until=NULL WHERE rowid IN (SELECT rowid FROM agent_mailbox_triage_queue WHERE state='pending' AND attempts>=6 AND (lease_until IS NULL OR lease_until<=?) LIMIT 25)").bind(now).run();
  const eligibility=`EXISTS(SELECT 1 FROM agent_mailbox_sync s JOIN agent_mailbox_messages m ON m.stream_id=s.id
    JOIN auth_provider_grants g ON g.id=s.grant_id AND g.tenant_scope=s.tenant_id
    JOIN agent_tenants t ON t.id=s.tenant_id JOIN agent_memberships a ON a.tenant_id=t.id AND a.user_id=g.user_id
    WHERE s.id=q.stream_id AND m.message_id=q.message_id AND m.receipt_token=q.receipt_token
      AND s.state='ready' AND m.state='present' AND m.needs_reconciliation=0 AND m.text_json IS NOT NULL
      AND g.status='authorized' AND g.mailbox_paused=0 AND a.status='active' AND a.role IN ('owner','manager')
      AND (a.expires_at IS NULL OR a.expires_at>?) AND t.status IN ('active','past-due','degraded') AND t.plan_id!='trial'
      AND NOT EXISTS(SELECT 1 FROM agent_mailbox_changes c WHERE c.stream_id=q.stream_id AND c.message_id=q.message_id AND c.state='pending'))`;
  const rows=(await env.AGENT_DB.prepare(`WITH eligible AS (
    SELECT q.stream_id,q.message_id,q.receipt_token,q.next_attempt_at,s.tenant_id,g.user_id,
      ROW_NUMBER() OVER(PARTITION BY s.tenant_id ORDER BY q.next_attempt_at,q.stream_id,q.message_id) AS rank
    FROM agent_mailbox_triage_queue q JOIN agent_mailbox_sync s ON s.id=q.stream_id JOIN auth_provider_grants g ON g.id=s.grant_id
    WHERE q.state='pending' AND q.attempts<6 AND q.next_attempt_at<=? AND (q.lease_until IS NULL OR q.lease_until<=?) AND ${eligibility}
  ) SELECT * FROM eligible WHERE rank=1 ORDER BY next_attempt_at,stream_id,message_id LIMIT 5`).bind(now,now,now).all<Candidate>()).results;
  const deliver=dispatch??(async(actor,id,message,receipt)=>(await getAgentByName(env.BUSINESS_AGENTS,actor.tenantId)).analyzeMailbox(actor,id,message,receipt));
  let complete=0,deferred=0;
  for(const candidate of rows){
    const token=crypto.randomUUID();
    const claimed=await env.AGENT_DB.prepare(`UPDATE agent_mailbox_triage_queue AS q SET lease_token=?,lease_until=?,attempts=attempts+1
      WHERE stream_id=? AND message_id=? AND receipt_token=? AND state='pending' AND attempts<6 AND next_attempt_at<=?
      AND (lease_until IS NULL OR lease_until<=?) AND ${eligibility} RETURNING attempts`)
      .bind(token,new Date(clock()+120000).toISOString(),candidate.stream_id,candidate.message_id,candidate.receipt_token,now,now,now).first<{attempts:number}>();
    if(!claimed)continue;
    let success=false;
    try{success=(await deliver({tenantId:candidate.tenant_id,userId:candidate.user_id},candidate.stream_id,candidate.message_id,candidate.receipt_token)).ok;}catch{/* Retry only through a new bounded queue claim. */}
    const state=success?'complete':claimed.attempts>=6?'review_required':'pending';
    const result=await env.AGENT_DB.prepare(`UPDATE agent_mailbox_triage_queue SET state=?,next_attempt_at=?,lease_token=NULL,lease_until=NULL
      WHERE stream_id=? AND message_id=? AND receipt_token=? AND lease_token=? AND lease_until>?`)
      .bind(state,new Date(clock()+Math.min(86400000,900000*2**(claimed.attempts-1))).toISOString(),candidate.stream_id,candidate.message_id,candidate.receipt_token,token,new Date(clock()).toISOString()).run();
    if(result.meta.changes){if(success)complete++;else deferred++;}
  }
  return {disabled:false,selected:rows.length,complete,deferred};
}
