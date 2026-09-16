import {getAgentByName} from 'agents';
import type {Actor,Env} from '../env';

type Candidate={id:string;tenant_id:string;user_id:string;next_attempt_at:string|null;attempts:number|null;
  lease_token:string|null;lease_until:string|null;page_token:string|null;ordinal:number|null};
type Dispatch=(actor:Actor,streamId:string)=>Promise<{ok:boolean;value?:{state:string}}>;

/** Consume before polling. Full pending queues must still be eligible to drain. */
export async function runMailboxProcessing(env:Env,dispatch?:Dispatch,clock:()=>number=Date.now) {
  if(env.MAILBOX_SYNC_ENABLED!=='true'||env.MAILBOX_RECOVERY_ENABLED!=='true'||env.MAILBOX_PROCESSING_ENABLED!=='true')
    return {disabled:true,selected:0,processed:0,deferred:0};
  const now=new Date(clock()).toISOString();
  const candidates=(await env.AGENT_DB.prepare(`WITH eligible AS (
    SELECT s.id,s.tenant_id,g.user_id,w.next_attempt_at,w.attempts,w.lease_token,w.lease_until,w.page_token,w.ordinal,
      ROW_NUMBER() OVER(PARTITION BY s.tenant_id ORDER BY COALESCE(w.next_attempt_at,'1970-01-01T00:00:00.000Z'),s.id) AS tenant_rank
    FROM agent_mailbox_sync s JOIN auth_provider_grants g ON g.id=s.grant_id AND g.tenant_scope=s.tenant_id AND g.provider=s.provider
    JOIN agent_tenants t ON t.id=s.tenant_id JOIN agent_memberships m ON m.tenant_id=t.id AND m.user_id=g.user_id
    LEFT JOIN agent_mailbox_consumers w ON w.stream_id=s.id
    WHERE g.status='authorized' AND m.status='active' AND m.role IN ('owner','manager') AND (m.expires_at IS NULL OR m.expires_at>?)
      AND t.status IN ('active','past-due','degraded') AND t.plan_id!='trial'
      AND (w.state IS NULL OR w.state='ready') AND (w.next_attempt_at IS NULL OR w.next_attempt_at<=?)
      AND (w.lease_until IS NULL OR w.lease_until<=?)
      AND EXISTS(SELECT 1 FROM agent_mailbox_changes c WHERE c.stream_id=s.id AND c.state='pending')
  ) SELECT * FROM eligible WHERE tenant_rank=1 ORDER BY COALESCE(next_attempt_at,'1970-01-01T00:00:00.000Z'),id LIMIT 5`)
    .bind(now,now,now).all<Candidate>()).results;
  const deliver:Dispatch=dispatch??(async(actor,id)=>(await getAgentByName(env.BUSINESS_AGENTS,actor.tenantId)).consumeMailbox(actor,id));
  let processed=0,deferred=0;
  const active=new Set(candidates);
  // Round-robin: a busy tenant never takes all 25 dispatches.
  for(let round=0;round<5;round++)for(const candidate of [...active]) {
    try {
      const result=await deliver({tenantId:candidate.tenant_id,userId:candidate.user_id},candidate.id);
      if(result.ok&&result.value?.state==='processed'){processed++;continue;}
      active.delete(candidate);
      if(result.ok&&result.value&&['deferred','review_required'].includes(result.value.state)){deferred++;continue;}
    } catch {active.delete(candidate);}
    deferred++;
    try {
      const next=new Date(clock()+900000).toISOString();
      if(candidate.next_attempt_at===null) {
        // A rejected Agent call may never have created its consumer row.
        await env.AGENT_DB.prepare('INSERT OR IGNORE INTO agent_mailbox_consumers(stream_id,next_attempt_at) VALUES (?,?)').bind(candidate.id,next).run();
      } else {
        await env.AGENT_DB.prepare(`UPDATE agent_mailbox_consumers SET next_attempt_at=? WHERE stream_id=? AND state='ready'
          AND next_attempt_at=? AND attempts=? AND lease_token IS ? AND lease_until IS ? AND page_token IS ? AND ordinal IS ?
          AND (lease_until IS NULL OR lease_until<=?)`)
          .bind(next,candidate.id,candidate.next_attempt_at,candidate.attempts,candidate.lease_token,candidate.lease_until,candidate.page_token,candidate.ordinal,now).run();
      }
    } catch {console.error(JSON.stringify({event:'agent_mailbox_processing_delay_unavailable'}));}
  }
  return {disabled:false,selected:candidates.length,processed,deferred};
}
