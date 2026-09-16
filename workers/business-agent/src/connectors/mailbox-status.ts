import type {Actor,Env} from '../env';
import {HttpError} from '../http';
import {OPERATORS,requireMembership,requireTenant} from '../permissions';
import {credentialAuthorizationStamp} from './credentials';
import {requireMailboxAccess} from './mailbox-runner';
type Grant={user_id:string;account_id:string;authorization_revision:number;granted_scopes:string;status:string;mailbox_paused:number;mailbox_control_revision:number};
export async function googleMailboxStatus(env:Env,actor:Actor,grantId:string,paused:()=>boolean) {
  return mailboxStatus(env,actor,grantId,paused,'google');
}
export async function microsoftMailboxStatus(env:Env,actor:Actor,grantId:string,paused:()=>boolean) {
  return mailboxStatus(env,actor,grantId,paused,'microsoft');
}
async function mailboxStatus(env:Env,actor:Actor,grantId:string,paused:()=>boolean,provider:'google'|'microsoft') {
  const readGrant=async()=>{
    await requireMembership(env,actor,OPERATORS);await requireTenant(env,actor);
    const row=await env.AGENT_DB.prepare("SELECT user_id,account_id,authorization_revision,granted_scopes,status,mailbox_paused,mailbox_control_revision FROM auth_provider_grants WHERE id=? AND tenant_scope=? AND user_id=? AND provider=?")
      .bind(grantId,actor.tenantId,actor.userId,provider).first<Grant>();
    if(!row)throw new HttpError(404,'mailbox_not_found','This mailbox is not available.');return row;
  };
  const grant=await readGrant(),authorization=await credentialAuthorizationStamp(grant);
  const summary=await env.AGENT_DB.prepare(`SELECT COUNT(*) AS configuredFolders,
    COALESCE(SUM(CASE WHEN s.state!='ready' OR w.state='review_required' THEN 1 ELSE 0 END),0) AS attention,
    COALESCE(SUM(CASE WHEN s.sync_mode='bootstrap' OR (s.provider='microsoft' AND s.checkpoint IS NULL) THEN 1 ELSE 0 END),0) AS initializing
    FROM agent_mailbox_sync s
    LEFT JOIN agent_mailbox_consumers w ON w.stream_id=s.id
    WHERE s.tenant_id=? AND s.grant_id=? AND s.authorization=? AND s.provider=? AND (?='microsoft' OR s.resource='mailbox')`)
    .bind(actor.tenantId,grantId,authorization,provider,provider).first<{configuredFolders:number;attention:number;initializing:number}>();
  const counts=await env.AGENT_DB.prepare(`WITH streams AS (SELECT id FROM agent_mailbox_sync
    WHERE tenant_id=? AND grant_id=? AND authorization=? AND provider=? AND (?='microsoft' OR resource='mailbox')) SELECT
    (SELECT COUNT(*) FROM agent_mailbox_changes WHERE stream_id IN (SELECT id FROM streams) AND state='pending') AS pending,
    (SELECT MAX(observed_at) FROM agent_mailbox_messages WHERE stream_id IN (SELECT id FROM streams) AND needs_reconciliation=0) AS lastObservedAt`)
    .bind(actor.tenantId,grantId,authorization,provider,provider).first<{pending:number;lastObservedAt:string|null}>();
  let available=false;
  if(env.MAILBOX_RECOVERY_ENABLED==='true'&&env.MAILBOX_PROCESSING_ENABLED==='true'&&!paused()) {
    try {await requireMailboxAccess(env,actor,async()=>{},provider);available=true;}
    catch(error){if(!(error instanceof HttpError))throw error;}
  }
  const latest=await readGrant();
  if(latest.status!==grant.status||latest.mailbox_control_revision!==grant.mailbox_control_revision||latest.mailbox_paused!==grant.mailbox_paused||await credentialAuthorizationStamp(latest)!==authorization)
    throw new HttpError(409,'mailbox_changed','Mailbox authorization changed. Refresh its status.');
  const tenant=await requireTenant(env,actor);
  const granted=new Set((JSON.parse(grant.granted_scopes) as string[]).map(scope=>scope.replace(/^https:\/\/graph.microsoft.com\//,'')));
  const readable=(provider==='google'?['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.modify','https://mail.google.com/']:['Mail.Read','Mail.ReadWrite']).some(scope=>granted.has(scope));
  const state=grant.mailbox_paused?'stopped':grant.status!=='authorized'||!readable?'reconnect_required'
    :paused()||['paused','offboarding'].includes(tenant.status)?'paused'
    :!summary?.configuredFolders?'not_started':summary.attention>0?'needs_attention'
    :!available?'disabled':summary.initializing>0?'initializing':'monitoring';
  return {state,setupEnabled:provider==='google'&&state==='not_started'&&available,pending:counts?.pending??0,lastObservedAt:counts?.lastObservedAt??null,
    ...(state==='stopped'?{controlRevision:grant.mailbox_control_revision,resumeEnabled:available&&readable&&grant.status==='authorized'}:{}),
    ...(provider==='microsoft'?{configuredFolders:summary?.configuredFolders??0}:{})};
}
