import type {Actor,Env} from '../env';
import {HttpError} from '../http';
import {InvitationEmailOutbox,type EmailClaim} from './outbox';
import {requirePlatformSender} from './readiness';
import type {SendResult} from './resend';
import {PlatformEmailAllowance} from './allowance';
import {platformEmailAccess} from './access';
import {PlatformEmailSupplierBudget} from './supplier-budget';

/** Compose sender evidence with durable invitation identity. This is deliberately
 * not a sender: delivery orchestration and recovery still need implementation. */
export class VerifiedInvitationOutbox {
  private readonly outbox:InvitationEmailOutbox;
  private readonly allowance:PlatformEmailAllowance;
  private readonly supplier:PlatformEmailSupplierBudget;
  constructor(private readonly env:Env,private readonly clock:()=>number=Date.now){this.outbox=new InvitationEmailOutbox(env,clock);this.allowance=new PlatformEmailAllowance(env,clock);this.supplier=new PlatformEmailSupplierBudget(env,clock);}
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
    const sender=await this.sender();
    await this.reconcileAuthority(tenantId,id);
    const candidate=await this.env.AGENT_DB.prepare("SELECT id FROM agent_platform_email_outbox WHERE tenant_id=? AND id=? AND route_ref=? AND state IN ('prepared','sending','retry')").bind(tenantId,id,sender.routeRef).first();
    if(!candidate)return null;
    const budget=await platformEmailAccess(this.env,tenantId,new Date(this.clock()));
    if(!await this.allowance.reserve(tenantId,id,budget))throw new HttpError(409,'email_allowance_unavailable','This email has no available reservation in the current subscription period.');
    if(!await this.supplier.reserve(tenantId,id,sender.routeRef.slice(7)))throw new HttpError(409,'email_supplier_budget_unavailable','Platform email delivery is paused pending supplier budget verification.');
    const claim=await this.outbox.claim(tenantId,id,sender.routeRef);
    if(!claim){await this.allowance.reconcile(tenantId,id);await this.supplier.reconcile(tenantId,id);return null;}
    try{
      if(!await this.mayDispatch(claim)){await this.outbox.settle(claim,{state:'review_required',code:'email_dispatch_authority_changed'});return null;}
    }catch(error){await this.outbox.settle(claim,{state:'deferred',code:'email_readiness_changed'});throw error;}
    return claim;
  }
  async mayDispatch(claim:EmailClaim){
    const sender=await this.sender();
    if(claim.message.from!==sender.from||!await this.outbox.mayDispatch(claim,sender.routeRef))return false;
    const budget=await platformEmailAccess(this.env,claim.tenantId,new Date(this.clock()));
    return await this.allowance.permits(claim.tenantId,claim.id,budget)
      &&await this.supplier.permits(claim.tenantId,claim.id,sender.routeRef.slice(7))
      &&await this.outbox.mayDispatch(claim,sender.routeRef);
  }
  // Persist historical outcomes even if readiness was revoked after a send.
  async settle(claim:Pick<EmailClaim,'id'|'tenantId'|'token'>,result:SendResult){const saved=await this.outbox.settle(claim,result);await this.allowance.reconcile(claim.tenantId,claim.id);await this.supplier.reconcile(claim.tenantId,claim.id);return saved;}
  async reconcileAuthority(tenantId:string,id:string){const changed=await this.outbox.reconcileAuthority(tenantId,id);await this.allowance.reconcile(tenantId,id);await this.supplier.reconcile(tenantId,id);return changed;}
}
