import type {Actor,Env} from '../env';
import {HttpError} from '../http';
import {OPERATORS,requireMembership,requireTenant} from '../permissions';

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
  const result=await env.AGENT_DB.prepare(`UPDATE auth_provider_grants SET mailbox_paused=1 WHERE id=? AND tenant_scope=? AND user_id=?
    AND EXISTS(SELECT 1 FROM agent_memberships m WHERE m.tenant_id=? AND m.user_id=? AND m.status='active'
      AND m.role IN ('owner','manager') AND (m.expires_at IS NULL OR m.expires_at>?)) RETURNING id`)
    .bind(grantId,actor.tenantId,actor.userId,actor.tenantId,actor.userId,now).first();
  if(!result)throw new HttpError(404,'mailbox_not_found','This mailbox is unavailable.');
  return {state:'stopped' as const};
}
