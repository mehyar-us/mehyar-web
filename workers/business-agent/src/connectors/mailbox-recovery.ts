import { getAgentByName } from 'agents';
import type { Actor, Env } from '../env';

type Candidate = { id:string;tenant_id:string;user_id:string;next_poll_at:string;updated_at:string };
type DispatchResult = {ok:boolean;value?:{state:string}};
type Dispatch = (actor:Actor,streamId:string)=>Promise<DispatchResult>;

/** Bounded cron dispatcher. All provider work runs inside the owning Agent so
 * its current pause state is checked around each request and persistence step. */
export async function runMailboxRecovery(env:Env,dispatch?:Dispatch,clock:()=>number=Date.now) {
  if(env.MAILBOX_SYNC_ENABLED!=='true'||env.MAILBOX_RECOVERY_ENABLED!=='true')return {disabled:true,selected:0,completed:0,deferred:0};
  const now=new Date(clock()).toISOString();
  const candidates=(await env.AGENT_DB.prepare(`WITH eligible AS (
    SELECT s.id,s.tenant_id,g.user_id,s.next_poll_at,s.updated_at,
      ROW_NUMBER() OVER(PARTITION BY s.tenant_id ORDER BY s.next_poll_at,s.updated_at,s.id) AS tenant_rank
    FROM agent_mailbox_sync s JOIN auth_provider_grants g ON g.id=s.grant_id AND g.tenant_scope=s.tenant_id AND g.provider=s.provider
    JOIN agent_tenants t ON t.id=s.tenant_id
    JOIN agent_memberships m ON m.tenant_id=t.id AND m.user_id=g.user_id
    WHERE s.state='ready' AND s.next_poll_at<=? AND (s.lease_until IS NULL OR s.lease_until<=?)
      AND g.status='authorized' AND g.mailbox_paused=0 AND m.status='active' AND m.role IN ('owner','manager') AND (m.expires_at IS NULL OR m.expires_at>?)
      AND t.status IN ('active','past-due','degraded') AND t.plan_id!='trial'
      AND (SELECT COUNT(*) FROM agent_mailbox_changes c JOIN agent_mailbox_sync backlog ON backlog.id=c.stream_id
        WHERE backlog.tenant_id=s.tenant_id AND c.state='pending')<=9000
  ) SELECT id,tenant_id,user_id,next_poll_at,updated_at FROM eligible WHERE tenant_rank=1 ORDER BY next_poll_at,updated_at,id LIMIT 5`)
    .bind(now,now,now).all<Candidate>()).results;
  const deliver:Dispatch=dispatch??(async(actor,id)=>{
    const agent=await getAgentByName(env.BUSINESS_AGENTS,actor.tenantId);
    return agent.syncMailbox(actor,id);
  });
  let completed=0,deferred=0;
  for(const candidate of candidates) {
    try {
      const result=await deliver({tenantId:candidate.tenant_id,userId:candidate.user_id},candidate.id);
      if(result.ok&&result.value&&['saved','resync_required','deferred'].includes(result.value.state)){completed++;continue;}
    } catch { /* A failed tenant must not prevent work for other tenants. */ }
    deferred++;
    // Do not overwrite provider backoff, a live claim or another worker's progress.
    try { await env.AGENT_DB.prepare(`UPDATE agent_mailbox_sync SET next_poll_at=?
      WHERE id=? AND tenant_id=? AND state='ready' AND next_poll_at=? AND updated_at=?
        AND next_poll_at<=? AND (lease_until IS NULL OR lease_until<=?)`)
      .bind(new Date(clock()+900000).toISOString(),candidate.id,candidate.tenant_id,candidate.next_poll_at,candidate.updated_at,now,now).run();
    } catch { console.error(JSON.stringify({event:'agent_mailbox_retry_delay_unavailable'})); }
  }
  return {disabled:false,selected:candidates.length,completed,deferred};
}
