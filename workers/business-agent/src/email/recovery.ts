import type {Env} from '../env';
import {requirePlatformSender} from './readiness';
import {dispatchInvitationEmail} from './dispatch';
import {reconcileInvitationDelivery} from './delivery';
import type {EmailTransport} from './resend';

/** Bounded cron worker, independently disabled. Per-job leases remain the
 * authority for duplicate exclusion; scheduling never creates replacement jobs. */
export async function runEmailRecovery(env:Env,transport:EmailTransport=fetch,clock:()=>number=Date.now){
  if(env.AGENT_PLATFORM_EMAIL_RECOVERY_ENABLED!=='true'||env.AGENT_PLATFORM_EMAIL_ENABLED!=='true')return {disabled:true,sent:0,checked:0,deferred:0};
  const snapshot={...env},sender=await requirePlatformSender(snapshot,new Date(clock())),route=`resend:${sender.configurationHash}`,now=new Date(clock()).toISOString();
  let sent=0,checked=0,deferred=0;
  // Read existing receipts first: a newly observed complaint can suppress a send
  // later in this invocation. One candidate per tenant prevents a single backlog
  // from occupying the whole batch.
  const receipts=await env.AGENT_DB.prepare(`WITH due AS (
    SELECT o.id,o.tenant_id,COALESCE(d.next_check_at,o.created_at) AS due_at,
      ROW_NUMBER() OVER (PARTITION BY o.tenant_id ORDER BY COALESCE(d.next_check_at,o.created_at),o.id) AS position
    FROM agent_platform_email_outbox o JOIN agent_tenants t ON t.id=o.tenant_id
    LEFT JOIN agent_platform_email_delivery d ON d.job_id=o.id AND d.tenant_id=o.tenant_id
    WHERE o.state='accepted' AND o.provider_id IS NOT NULL AND o.route_ref=? AND t.status NOT IN ('deleted','offboarding')
      AND (d.checks IS NULL OR d.checks<48) AND (d.next_check_at IS NULL OR d.next_check_at<=?) AND (d.lease_expires_at IS NULL OR d.lease_expires_at<=?))
    SELECT id,tenant_id FROM due WHERE position=1 ORDER BY due_at,id LIMIT 5`)
    .bind(route,now,now).all<{id:string;tenant_id:string}>();
  for(const job of receipts.results){
    try{const result=await reconcileInvitationDelivery(snapshot,job.tenant_id,job.id,transport,clock);if(result.state==='recorded')checked++;else if(result.state==='unverified')deferred++;}
    catch{deferred++;}
  }
  const due=await env.AGENT_DB.prepare(`WITH due AS (
    SELECT o.id,o.tenant_id,o.next_attempt_at,
      ROW_NUMBER() OVER (PARTITION BY o.tenant_id ORDER BY o.next_attempt_at,o.id) AS position
    FROM agent_platform_email_outbox o JOIN agent_tenants t ON t.id=o.tenant_id
    WHERE o.state IN ('prepared','retry','sending') AND o.route_ref=? AND t.status!='paused'
      AND o.next_attempt_at<=? AND (o.lease_expires_at IS NULL OR o.lease_expires_at<=?))
    SELECT id,tenant_id,next_attempt_at FROM due WHERE position=1 ORDER BY next_attempt_at,id LIMIT 5`)
    .bind(route,now,now).all<{id:string;tenant_id:string;next_attempt_at:string}>();
  for(const job of due.results){
    let postpone=false;
    try{const result=await dispatchInvitationEmail(snapshot,job.tenant_id,job.id,transport,clock);if(result.state==='recorded'&&result.outcome==='accepted')sent++;postpone=result.state!=='recorded';}
    catch{postpone=true;deferred++;}
    if(postpone){
      // Only touch an unchanged, unleased candidate. Never overwrite another
      // worker's backoff/lease or a newly recorded terminal outcome.
      const current=new Date(clock()).toISOString();
      await env.AGENT_DB.prepare(`UPDATE agent_platform_email_outbox SET next_attempt_at=?,last_code=COALESCE(last_code,'email_recovery_deferred')
        WHERE id=? AND tenant_id=? AND state IN ('prepared','retry','sending') AND next_attempt_at=? AND (lease_expires_at IS NULL OR lease_expires_at<=?)`)
        .bind(new Date(clock()+900000).toISOString(),job.id,job.tenant_id,job.next_attempt_at,current).run();
    }
  }
  return {disabled:false,sent,checked,deferred};
}
