import type {Actor,Env} from '../env';
import {HttpError} from '../http';
import {OPERATORS,requireMembership} from '../permissions';
import {connectionAuthorizationStamp,connectorCredential} from './credentials';
import {MicrosoftMailClient,MICROSOFT_MAIL_OPERATIONS} from './microsoft-mail';
import {requireMailboxAccess} from './mailbox-runner';
import type {FolderSessions} from './folder-sessions';

/** Read-only setup discovery. The caller supplies the owning Agent's live guard/storage. */
export async function connectedMailboxFolders(env:Env,actor:Actor,grantId:string,sessions:FolderSessions,
  agentGuard:()=>Promise<void>,continuation?:string,transport:typeof fetch=fetch) {
  const access=async()=>{
    await requireMembership(env,actor,OPERATORS);
    await requireMailboxAccess(env,actor,agentGuard,'microsoft');
    const own=await env.AGENT_DB.prepare("SELECT id FROM auth_provider_grants WHERE id=? AND tenant_scope=? AND user_id=? AND provider='microsoft'")
      .bind(grantId,actor.tenantId,actor.userId).first();
    if(!own)throw new HttpError(404,'mailbox_not_found','This mailbox connection is unavailable.');
  };
  await access();
  const authorization=await connectionAuthorizationStamp(env,actor,grantId,'microsoft',MICROSOFT_MAIL_OPERATIONS.read);
  const guard=async()=>{
    await access();
    if(authorization!==await connectionAuthorizationStamp(env,actor,grantId,'microsoft',MICROSOFT_MAIL_OPERATIONS.read))
      throw new HttpError(409,'mailbox_authorization_changed','Account authorization changed. Reload the folder list.');
  };
  const controlled:typeof fetch=async(input,init)=>{await guard();return transport(input,init);};
  // Resolve the session before obtaining credentials: stale/foreign handles cannot
  // trigger a token refresh. The session calls this only after its scope checks.
  const client={listFolders:async(parent?:string,cursor?:string)=>{
    const auth=await connectorCredential(env,actor,grantId,'microsoft',MICROSOFT_MAIL_OPERATIONS.read,controlled);
    await guard();
    return new MicrosoftMailClient(auth,{fetch:controlled}).listFolders(parent,cursor);
  }};
  return sessions.read({userId:actor.userId,grantId,authorization},client,guard,continuation);
}
