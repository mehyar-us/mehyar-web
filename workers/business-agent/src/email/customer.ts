import type {Actor,Env} from '../env';
import {digest,HttpError} from '../http';
import {requireMembership,requireTenant} from '../permissions';
import {platformEmailAccess} from './access';
import {VerifiedInvitationOutbox} from './verified-outbox';

export function presentInvitationDelivery(row:{email_state?:string|null;cancel_requested_at?:string|null;delivered_seen?:number; bounced_seen?:number;complained_seen?:number;checked_at?:string|null}){
  let state='not_queued';
  if(row.email_state){
    const states:Record<string,string>={prepared:'queued',sending:'processing',retry:'retrying',accepted:'accepted',rejected:'failed',review_required:'review_required',cancelled:'cancelled'};
    state=Object.hasOwn(states,row.email_state)?states[row.email_state]:'unavailable';
    if(row.email_state==='accepted')state=row.complained_seen===1?'complaint':row.bounced_seen===1?'bounced':row.delivered_seen===1?'delivered':'accepted';
    else if(row.cancel_requested_at&&['prepared','sending','retry'].includes(row.email_state))state='cancellation_requested';
    else if(row.cancel_requested_at&&row.email_state==='review_required')state='cancelled_unconfirmed';
  }
  return {state,checkedAt:row.checked_at&&Number.isFinite(Date.parse(row.checked_at))?row.checked_at:null};
}

/** Available even while delivery, billing or the workspace is paused. Never
 * revoke the invitation itself and never erase a possible provider submission. */
export async function cancelInvitationEmail(env:Env,actor:Actor,invitationId:string){
  await requireTenant(env,actor);await requireMembership(env,actor,['owner']);
  const job=await env.AGENT_DB.prepare('SELECT id FROM agent_platform_email_outbox WHERE tenant_id=? AND invitation_id=?').bind(actor.tenantId,invitationId).first<{id:string}>();
  if(!job)throw new HttpError(404,'invitation_email_unavailable','This invitation email is not available.');
  const now=new Date().toISOString(),audit=await digest(JSON.stringify(['invitation-email-cancel',job.id]));
  await env.AGENT_DB.batch([
    env.AGENT_DB.prepare(`UPDATE agent_platform_email_outbox SET cancel_requested_at=?,cancel_requested_by=?
      WHERE id=? AND tenant_id=? AND cancel_requested_at IS NULL AND state IN ('prepared','sending','retry','review_required')
      AND EXISTS(SELECT 1 FROM agent_memberships m JOIN agent_tenants t ON t.id=m.tenant_id WHERE m.tenant_id=? AND m.user_id=? AND m.role='owner' AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>?) AND t.status!='deleted')`)
      .bind(now,actor.userId,job.id,actor.tenantId,actor.tenantId,actor.userId,now),
    env.AGENT_DB.prepare(`INSERT OR IGNORE INTO agent_activity(id,tenant_id,actor_id,action,summary,created_at)
      SELECT ?,tenant_id,cancel_requested_by,'invitation_email_cancel_requested','Requested cancellation of an invitation email; earlier delivery may still require confirmation.',cancel_requested_at
      FROM agent_platform_email_outbox WHERE id=? AND tenant_id=? AND cancel_requested_at IS NOT NULL`)
      .bind(audit,job.id,actor.tenantId),
  ]);
  await requireMembership(env,actor,['owner']);
  await new VerifiedInvitationOutbox(env).reconcileAuthority(actor.tenantId,job.id);
  const row=await env.AGENT_DB.prepare('SELECT state AS email_state,cancel_requested_at FROM agent_platform_email_outbox WHERE id=? AND tenant_id=?').bind(job.id,actor.tenantId).first<{email_state:string;cancel_requested_at:string|null}>();
  await requireTenant(env,actor);await requireMembership(env,actor,['owner']);
  if(!row)throw new HttpError(404,'invitation_email_unavailable','This invitation email is not available.');
  return {email:presentInvitationDelivery(row)};
}

/** Explicit owner request; the scheduler sends later using the frozen job. */
export async function queueInvitationEmail(env:Env,actor:Actor,invitationId:string){
  await requireTenant(env,actor);await requireMembership(env,actor,['owner']);
  if(env.AGENT_PLATFORM_EMAIL_ENABLED!=='true'||env.AGENT_PLATFORM_EMAIL_RECOVERY_ENABLED!=='true')throw new HttpError(503,'platform_email_disabled','Invitation email delivery is not enabled. The teammate can still sign in with their invited email.');
  await platformEmailAccess(env,actor.tenantId);
  const prepared=await new VerifiedInvitationOutbox(env).prepare(actor,invitationId);
  await requireMembership(env,actor,['owner']);
  return {email:presentInvitationDelivery({email_state:prepared.state})};
}
