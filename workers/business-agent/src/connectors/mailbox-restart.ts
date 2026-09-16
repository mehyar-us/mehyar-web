import type {Actor,Env} from '../env';
import {HttpError} from '../http';
import {MailboxSync} from './mailbox-sync';
import {requireMailboxAccess} from './mailbox-runner';
import {connectorCredential} from './credentials';
import {GoogleMailClient,GOOGLE_MAIL_OPERATIONS} from './google-mail';

/** Internal service, invoked by the owning Agent. Completed retries never
 * request another provider baseline or reset subsequent synchronization. */
export async function restartMailbox(env:Env,actor:Actor,streamId:string,requestKey:string,expectedRound:string,
  agentGuard:()=>Promise<void>,transport:typeof fetch=fetch) {
  if(env.MAILBOX_RECOVERY_ENABLED!=='true'||env.MAILBOX_PROCESSING_ENABLED!=='true')
    throw new HttpError(503,'mailbox_setup_unavailable','Mailbox recovery is awaiting activation.');
  await requireMailboxAccess(env,actor,agentGuard);
  const ledger=new MailboxSync(env,actor),context=await ledger.recoveryContext(streamId,requestKey,expectedRound);
  const guard=async()=>{
    await requireMailboxAccess(env,actor,agentGuard,context.provider);
    const current=await ledger.recoveryContext(streamId,requestKey,expectedRound);
    if(current.authorization!==context.authorization)throw new HttpError(409,'mailbox_authorization_changed','Mailbox authorization changed. Refresh status.');
    return current;
  };
  if((await guard()).alreadyRestarted)return {state:'restarted' as const};
  let baseline:string|undefined;
  if(context.provider==='google') {
    const controlled:typeof fetch=async(input,init)=>{await guard();return transport(input,init);};
    const credential=await connectorCredential(env,actor,context.grantId,'google',GOOGLE_MAIL_OPERATIONS.read,controlled);
    await guard();
    baseline=await new GoogleMailClient(credential,{fetch:controlled}).profileHistory();
  }
  if((await guard()).alreadyRestarted)return {state:'restarted' as const};
  try{return await ledger.restart(streamId,requestKey,expectedRound,baseline);}
  catch(error){
    // Concurrent identical service requests may capture different fresh Gmail
    // histories. Only the first committed baseline wins; later callers use its receipt.
    if((await guard()).alreadyRestarted)return {state:'restarted' as const};
    throw error;
  }
}
