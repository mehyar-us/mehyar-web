import type {Actor,Env} from '../env';
import {HttpError} from '../http';
import {connectorCredential} from './credentials';
import {GoogleMailClient,GOOGLE_MAIL_OPERATIONS} from './google-mail';
import {MicrosoftMailClient,MICROSOFT_MAIL_OPERATIONS} from './microsoft-mail';
import {MailboxSync} from './mailbox-sync';
import {requireMailboxAccess} from './mailbox-runner';
import {ConnectorError} from './types';
import type {MailSnapshot} from './mail-snapshot';

/** One current-message reconciliation, never a reply or LLM instruction. */
export async function consumeMailboxChange(env:Env,actor:Actor,streamId:string,
  agentGuard:()=>Promise<void>,transport:typeof fetch=fetch) {
  const enabled=()=>{if(env.MAILBOX_PROCESSING_ENABLED!=='true')throw new HttpError(503,'mailbox_processing_disabled','Mailbox processing is not enabled.');};
  enabled();await requireMailboxAccess(env,actor,agentGuard);
  const ledger=new MailboxSync(env,actor),claim=await ledger.claimChange(streamId);
  if(!claim)return {state:'not_claimed' as const};
  const context=await ledger.changeContext(claim);
  const guard=async()=>{enabled();await requireMailboxAccess(env,actor,agentGuard,context.provider);await ledger.changeContext(claim);};
  try {
    await guard();
    const controlled:typeof fetch=async(input,init)=>{await guard();return transport(input,init);};
    const auth=await connectorCredential(env,actor,context.grantId,context.provider,
      context.provider==='google'?GOOGLE_MAIL_OPERATIONS.read:MICROSOFT_MAIL_OPERATIONS.read,controlled);
    await guard();
    let snapshot:MailSnapshot|null;
    try {
      snapshot=context.provider==='google'?await new GoogleMailClient(auth,{fetch:controlled}).readSnapshot(context.message_id)
        :await new MicrosoftMailClient(auth,{fetch:controlled}).readSnapshot(context.resource,context.message_id);
    } catch(error) {
      if(error instanceof ConnectorError&&error.kind==='not_found'&&error.status===404)snapshot=null;
      else throw error;
    }
    await guard();
    if(!await ledger.saveChange(claim,snapshot)) {
      await ledger.deferChange(claim,300,true);
      return {state:'review_required' as const};
    }
    return {state:'processed' as const};
  } catch(error) {
    if(error instanceof ConnectorError) {
      await guard();
      const delay=Math.max(300,error.retryAfterSeconds??0);
      const review=!['rate_limited','retryable_read'].includes(error.kind)||delay>86400||context.attempts>=12;
      await ledger.deferChange(claim,Math.min(delay,86400),review);
      return {state:review?'review_required' as const:'deferred' as const};
    }
    throw error;
  }
}
