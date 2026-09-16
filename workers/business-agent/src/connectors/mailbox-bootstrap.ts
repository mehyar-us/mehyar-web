import type {Actor,Env} from '../env';
import {HttpError} from '../http';
import {connectionAuthorizationStamp,connectorCredential} from './credentials';
import {GoogleMailClient,GOOGLE_MAIL_OPERATIONS} from './google-mail';
import {MailboxSync} from './mailbox-sync';
import {requireMailboxAccess} from './mailbox-runner';

/** Internal initialization. Profile history is captured before any enumeration;
 * the final bootstrap page keeps that baseline for incremental catch-up.
 * Existing progress is returned unchanged, never reset by a repeated request. */
export async function initializeGoogleMailbox(env:Env,actor:Actor,grantId:string,
  agentGuard:()=>Promise<void>,transport:typeof fetch=fetch) {
  await requireMailboxAccess(env,actor,agentGuard,'google');
  const ledger=new MailboxSync(env,actor);
  // This also requires the actor to own the grant, before requesting credentials.
  const existing=await ledger.existing(grantId,'google','mailbox');
  if(existing)return {streamId:existing};
  const authorization=await connectionAuthorizationStamp(env,actor,grantId,'google',GOOGLE_MAIL_OPERATIONS.read);
  const guard=async()=>{
    await requireMailboxAccess(env,actor,agentGuard,'google');
    if(authorization!==await connectionAuthorizationStamp(env,actor,grantId,'google',GOOGLE_MAIL_OPERATIONS.read))
      throw new HttpError(409,'mailbox_authorization_changed','Mailbox authorization changed. Restart initialization.');
  };
  const controlled:typeof fetch=async(input,init)=>{await guard();return transport(input,init);};
  const auth=await connectorCredential(env,actor,grantId,'google',GOOGLE_MAIL_OPERATIONS.read,controlled);
  await guard();
  const baseline=await new GoogleMailClient(auth,{fetch:controlled}).profileHistory();
  await guard();
  return {streamId:await ledger.open(grantId,'google','mailbox',baseline,authorization)};
}
