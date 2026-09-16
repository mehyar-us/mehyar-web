import type {Env} from '../env';
import {HttpError} from '../http';
import {VerifiedInvitationOutbox} from './verified-outbox';
import {requirePlatformSender} from './readiness';
import {PlatformResendClient,type EmailTransport,type SendResult} from './resend';
import type {EmailClaim} from './outbox';

export type EmailDispatchResult={state:'not_claimed'}|{state:'recorded'|'unrecorded';outcome:SendResult['state']};

/** One bounded attempt. The separately gated scheduler invokes this. Recovery
 * must call this again with the SAME job, never recreate its payload or key. */
export async function dispatchInvitationEmail(env:Env,tenantId:string,jobId:string,transport:EmailTransport=fetch,clock:()=>number=Date.now):Promise<EmailDispatchResult>{
  // Bind this entire attempt to one credential/configuration snapshot. Operator
  // evidence and DB authority are still rechecked immediately before transport.
  const attemptEnv={...env};
  await requirePlatformSender(attemptEnv,new Date(clock()));
  const outbox=new VerifiedInvitationOutbox(attemptEnv,clock);
  const claim=await outbox.claim(tenantId,jobId);
  if(!claim)return {state:'not_claimed'};
  const record=async(result:SendResult):Promise<EmailDispatchResult>=>{
    let saved:boolean;
    try{saved=await outbox.settle(claim,result);}
    catch{throw new HttpError(503,'email_result_persistence_failed','Email outcome could not be fully recorded. Retry recovery using the same job.');}
    return {state:saved?'recorded':'unrecorded',outcome:result.state};
  };
  let permitted:boolean;
  try{permitted=await outbox.mayDispatch(claim);}
  catch{return record({state:'deferred',code:'email_dispatch_checks_unavailable'});}
  if(!permitted)return record({state:'review_required',code:'email_dispatch_authority_changed'});
  return record(await send(attemptEnv,claim,transport,clock));
}

async function send(env:Env,claim:EmailClaim,transport:EmailTransport,clock:()=>number):Promise<SendResult>{
  try{return await new PlatformResendClient(env.AGENT_PLATFORM_RESEND_API_KEY!,transport,clock).send(claim.message,claim.idempotencyKey,claim.firstAttemptAt);}
  // The adapter normally returns transport uncertainty itself. Preserve it even
  // for an unexpected exception: never assume a failed response means no effect.
  catch{return {state:'uncertain',code:'email_dispatch_uncertain'};}
}
