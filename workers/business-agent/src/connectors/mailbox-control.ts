import type {Actor,Env} from '../env';
import {HttpError} from '../http';
import {OPERATORS,requireMembership,requireTenant} from '../permissions';
import {requireMailboxAccess} from './mailbox-runner';
import {connectionAuthorizationStamp} from './credentials';
import {GOOGLE_MAIL_OPERATIONS} from './google-mail';
import {MICROSOFT_MAIL_OPERATIONS} from './microsoft-mail';

export async function requireMailboxRunning(env:Env,actor:Actor,grantId:string) {
  const grant=await env.AGENT_DB.prepare('SELECT mailbox_paused FROM auth_provider_grants WHERE id=? AND tenant_scope=? AND user_id=?')
    .bind(grantId,actor.tenantId,actor.userId).first<{mailbox_paused:number}>();
  if(!grant)throw new HttpError(404,'mailbox_not_found','This mailbox is unavailable.');
  if(grant.mailbox_paused)throw new HttpError(409,'mailbox_stopped','Monitoring for this account is stopped.');
}

/** Always available to the connection owner, including when paid/provider access is disabled. */
export async function stopMailbox(env:Env,actor:Actor,grantId:string) {
  await requireMembership(env,actor,OPERATORS);await requireTenant(env,actor);
  const now=new Date().toISOString();
  const result=await env.AGENT_DB.prepare(`UPDATE auth_provider_grants SET mailbox_paused=1,mailbox_control_revision=mailbox_control_revision+1 WHERE id=? AND tenant_scope=? AND user_id=?
    AND EXISTS(SELECT 1 FROM agent_memberships m WHERE m.tenant_id=? AND m.user_id=? AND m.status='active'
      AND m.role IN ('owner','manager') AND (m.expires_at IS NULL OR m.expires_at>?)) RETURNING id`)
    .bind(grantId,actor.tenantId,actor.userId,actor.tenantId,actor.userId,now).first();
  if(!result)throw new HttpError(404,'mailbox_not_found','This mailbox is unavailable.');
  return {state:'stopped' as const};
}

export async function resumeMailbox(env:Env,actor:Actor,grantId:string,expectedRevision:number,guard:()=>Promise<void>) {
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)throw new HttpError(400,'invalid_mailbox_revision','Refresh mailbox status.');
  await requireMembership(env,actor,OPERATORS);await guard();
  if(env.MAILBOX_RECOVERY_ENABLED!=='true'||env.MAILBOX_PROCESSING_ENABLED!=='true')throw new HttpError(503,'mailbox_setup_unavailable','Mailbox processing is awaiting activation.');
  const grant=await env.AGENT_DB.prepare('SELECT provider,authorization_revision,granted_scopes FROM auth_provider_grants WHERE id=? AND tenant_scope=? AND user_id=?')
    .bind(grantId,actor.tenantId,actor.userId).first<{provider:'google'|'microsoft';authorization_revision:number;granted_scopes:string}>();
  if(!grant)throw new HttpError(404,'mailbox_not_found','This mailbox is unavailable.');
  await requireMailboxAccess(env,actor,guard,grant.provider);
  await connectionAuthorizationStamp(env,actor,grantId,grant.provider,grant.provider==='google'?GOOGLE_MAIL_OPERATIONS.read:MICROSOFT_MAIL_OPERATIONS.read);
  await guard();
  const now=new Date().toISOString();
  const result=await env.AGENT_DB.prepare(`UPDATE auth_provider_grants SET mailbox_paused=0,
    mailbox_control_revision=CASE WHEN mailbox_paused=1 THEN mailbox_control_revision+1 ELSE mailbox_control_revision END
    WHERE id=? AND tenant_scope=? AND user_id=? AND status='authorized' AND authorization_revision=? AND granted_scopes=?
    AND ((mailbox_paused=1 AND mailbox_control_revision=?) OR (mailbox_paused=0 AND mailbox_control_revision=?))
    AND EXISTS(SELECT 1 FROM agent_memberships m JOIN agent_tenants t ON t.id=m.tenant_id
      WHERE m.tenant_id=? AND m.user_id=? AND m.status='active' AND m.role IN ('owner','manager')
      AND (m.expires_at IS NULL OR m.expires_at>?) AND t.status NOT IN ('paused','offboarding','deleted')) RETURNING id`)
    .bind(grantId,actor.tenantId,actor.userId,grant.authorization_revision,grant.granted_scopes,expectedRevision,expectedRevision+1,actor.tenantId,actor.userId,now).first();
  if(!result)throw new HttpError(409,'mailbox_control_changed','Mailbox control changed. Refresh status before resuming.');
  return {state:'resumed' as const};
}
