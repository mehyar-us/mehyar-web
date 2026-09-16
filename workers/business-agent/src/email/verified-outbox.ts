import type {Actor,Env} from '../env';
import {HttpError} from '../http';
import {InvitationEmailOutbox,type EmailClaim} from './outbox';
import {requirePlatformSender} from './readiness';
import type {SendResult} from './resend';

/** Compose sender evidence with durable invitation identity. This is deliberately
 * not a sender: runtime quota/supplier-budget gates must be added
 * before a scheduled or public path can invoke network transport. */
export class VerifiedInvitationOutbox {
  private readonly outbox:InvitationEmailOutbox;
  constructor(private readonly env:Env,private readonly clock:()=>number=Date.now){this.outbox=new InvitationEmailOutbox(env,clock);}
  private async sender(){
    const verified=await requirePlatformSender(this.env,new Date(this.clock()));
    // The label is useful to operators, but only this full configuration binding
    // can fence a queued job from credentials belonging to another provider account.
    return {from:verified.from,routeRef:`resend:${verified.configurationHash}`};
  }
  async prepare(actor:Actor,invitationId:string){
    const sender=await this.sender(),prepared=await this.outbox.prepare(actor,invitationId,sender),current=await this.sender();
    if(current.routeRef!==sender.routeRef)throw new HttpError(409,'email_sender_changed','The sender changed while preparing this invitation. Review its email state.');
    return prepared;
  }
  async claim(tenantId:string,id:string):Promise<EmailClaim|null>{
    const sender=await this.sender(),claim=await this.outbox.claim(tenantId,id,sender.routeRef);
    if(!claim)return null;
    try{
      if(!await this.mayDispatch(claim)){await this.outbox.settle(claim,{state:'review_required',code:'email_dispatch_authority_changed'});return null;}
    }catch(error){await this.outbox.settle(claim,{state:'deferred',code:'email_readiness_changed'});throw error;}
    return claim;
  }
  async mayDispatch(claim:EmailClaim){
    const sender=await this.sender();
    return claim.message.from===sender.from&&await this.outbox.mayDispatch(claim,sender.routeRef);
  }
  // Persist historical outcomes even if readiness was revoked after a send.
  settle(claim:Pick<EmailClaim,'id'|'tenantId'|'token'>,result:SendResult){return this.outbox.settle(claim,result);}
  reconcileAuthority(tenantId:string,id:string){return this.outbox.reconcileAuthority(tenantId,id);}
}
