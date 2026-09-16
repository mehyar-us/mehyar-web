import type {Actor,Env} from '../env';
import {HttpError} from '../http';
import {requireMembership,requireTenant} from '../permissions';
import {platformEmailAccess} from './access';
import {VerifiedInvitationOutbox} from './verified-outbox';

export function presentInvitationDelivery(row:{email_state?:string|null;delivered_seen?:number; bounced_seen?:number;complained_seen?:number;checked_at?:string|null}){
  let state='not_queued';
  if(row.email_state){
    const states:Record<string,string>={prepared:'queued',sending:'processing',retry:'retrying',accepted:'accepted',rejected:'failed',review_required:'review_required',cancelled:'cancelled'};
    state=Object.hasOwn(states,row.email_state)?states[row.email_state]:'unavailable';
    if(row.email_state==='accepted')state=row.complained_seen===1?'complaint':row.bounced_seen===1?'bounced':row.delivered_seen===1?'delivered':'accepted';
  }
  return {state,checkedAt:row.checked_at&&Number.isFinite(Date.parse(row.checked_at))?row.checked_at:null};
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
