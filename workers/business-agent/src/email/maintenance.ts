import type {Env} from '../env';
import {invitationEmailAuthoritySql} from './outbox';
import {VerifiedInvitationOutbox} from './verified-outbox';

/** Local-only cleanup must continue while sending is disabled. No credentials,
 * provider reads/writes, fresh send claims or changes to invitation access. */
export async function runEmailMaintenance(env:Env,clock:()=>number=Date.now){
  const now=new Date(clock()).toISOString();
  const jobs=await env.AGENT_DB.prepare(`SELECT id,tenant_id FROM agent_platform_email_outbox
    WHERE (lease_expires_at IS NULL OR lease_expires_at<=?) AND (
      (state IN ('prepared','retry','sending') AND NOT (${invitationEmailAuthoritySql(true)}))
      OR EXISTS(SELECT 1 FROM agent_platform_email_reservations r WHERE r.job_id=agent_platform_email_outbox.id AND r.tenant_id=agent_platform_email_outbox.tenant_id AND r.state='held'
        AND (agent_platform_email_outbox.state='accepted' OR (agent_platform_email_outbox.state='cancelled' AND first_attempt_at IS NULL AND attempts=0)))
      OR EXISTS(SELECT 1 FROM agent_email_supplier_commitments c WHERE c.job_id=agent_platform_email_outbox.id AND c.tenant_id=agent_platform_email_outbox.tenant_id AND c.status='held'
        AND agent_platform_email_outbox.state='cancelled' AND first_attempt_at IS NULL AND attempts=0))
    ORDER BY created_at,id LIMIT 25`).bind(now,now,now,now).all<{id:string;tenant_id:string}>();
  const outbox=new VerifiedInvitationOutbox(env,clock);let checked=0,failed=0;
  for(const job of jobs.results){
    try{await outbox.reconcileAuthority(job.tenant_id,job.id);checked++;}
    catch{failed++;}
  }
  return {checked,failed};
}
