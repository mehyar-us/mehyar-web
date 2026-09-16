import type {Actor,Env} from '../env';
import {HttpError} from '../http';
import {OPERATORS,requireMembership,requireTenant} from '../permissions';
import {credentialAuthorizationStamp} from './credentials';
import {requireMailboxAccess} from './mailbox-runner';
type Grant={user_id:string;account_id:string;authorization_revision:number;granted_scopes:string;status:string};
export async function googleMailboxStatus(env:Env,actor:Actor,grantId:string,paused:()=>boolean) {
  const readGrant=async()=>{
    await requireMembership(env,actor,OPERATORS);await requireTenant(env,actor);
    const row=await env.AGENT_DB.prepare("SELECT user_id,account_id,authorization_revision,granted_scopes,status FROM auth_provider_grants WHERE id=? AND tenant_scope=? AND user_id=? AND provider='google'")
      .bind(grantId,actor.tenantId,actor.userId).first<Grant>();
    if(!row)throw new HttpError(404,'mailbox_not_found','This mailbox is not available.');return row;
  };
  const grant=await readGrant(),authorization=await credentialAuthorizationStamp(grant);
  const stream=await env.AGENT_DB.prepare(`SELECT s.id,s.state,s.sync_mode,w.state AS consumer_state FROM agent_mailbox_sync s
    LEFT JOIN agent_mailbox_consumers w ON w.stream_id=s.id
    WHERE s.tenant_id=? AND s.grant_id=? AND s.authorization=? AND s.provider='google' AND s.resource='mailbox'`)
    .bind(actor.tenantId,grantId,authorization).first<{id:string;state:string;sync_mode:string;consumer_state:string|null}>();
  const counts=stream?await env.AGENT_DB.prepare(`SELECT
    (SELECT COUNT(*) FROM agent_mailbox_changes WHERE stream_id=? AND state='pending') AS pending,
    (SELECT MAX(observed_at) FROM agent_mailbox_messages WHERE stream_id=?) AS lastObservedAt`)
    .bind(stream.id,stream.id).first<{pending:number;lastObservedAt:string|null}>():null;
  let available=false;
  if(env.MAILBOX_RECOVERY_ENABLED==='true'&&env.MAILBOX_PROCESSING_ENABLED==='true'&&!paused()) {
    try {await requireMailboxAccess(env,actor,async()=>{},'google');available=true;}
    catch(error){if(!(error instanceof HttpError))throw error;}
  }
  const latest=await readGrant();
  if(latest.status!==grant.status||await credentialAuthorizationStamp(latest)!==authorization)
    throw new HttpError(409,'mailbox_changed','Mailbox authorization changed. Refresh its status.');
  const tenant=await requireTenant(env,actor);
  const granted=new Set(JSON.parse(grant.granted_scopes) as string[]);
  const readable=['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.modify','https://mail.google.com/'].some(scope=>granted.has(scope));
  const state=grant.status!=='authorized'||!readable?'reconnect_required'
    :paused()||['paused','offboarding'].includes(tenant.status)?'paused'
    :!stream?'not_started':stream.state!=='ready'||stream.consumer_state==='review_required'?'needs_attention'
    :!available?'disabled':stream.sync_mode==='bootstrap'?'initializing':'monitoring';
  return {state,setupEnabled:state==='not_started'&&available,pending:counts?.pending??0,lastObservedAt:counts?.lastObservedAt??null};
}
