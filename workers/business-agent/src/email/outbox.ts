import {z} from 'zod';
import type {Actor,Env} from '../env';
import {digest,HttpError} from '../http';
import {requireTenant,requireMembership} from '../permissions';
import {invitationEmail} from './invitation-template';
import type {PlatformEmail,SendResult} from './resend';
type Row={id:string;tenant_id:string;route_ref:string;payload_json:string;payload_hash:string;idempotency_key:string;state:string;first_attempt_at:string|null;attempts:number;lease_token:string|null};
export type EmailClaim={id:string;tenantId:string;token:string;message:PlatformEmail;idempotencyKey:string;firstAttemptAt:string};
const config=z.object({from:z.email().max(254),routeRef:z.string().min(1).max(128).regex(/^[a-zA-Z0-9:_-]+$/)}).strict();
function authoritySql(allowPaused:boolean){return `EXISTS(SELECT 1 FROM agent_team_invitations i JOIN agent_tenants t ON t.id=i.tenant_id JOIN agent_memberships m ON m.tenant_id=i.tenant_id AND m.user_id=i.invited_by
  WHERE i.id=agent_platform_email_outbox.invitation_id AND i.tenant_id=agent_platform_email_outbox.tenant_id AND i.status='pending' AND i.expires_at>? AND i.expires_at=agent_platform_email_outbox.invitation_expires_at AND i.invited_email=agent_platform_email_outbox.recipient AND i.role=agent_platform_email_outbox.invited_role
  AND t.status NOT IN ('deleted','offboarding'${allowPaused?'':",'paused'"}) AND m.role='owner' AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>?))
  AND EXISTS(SELECT 1 FROM agent_memberships m WHERE m.tenant_id=agent_platform_email_outbox.tenant_id AND m.user_id=agent_platform_email_outbox.prepared_by AND m.role='owner' AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>?))`;}

/** Durable state only: no network calls and no enabled public enqueue/dispatch path.
 * A future dispatcher must enforce sender/account readiness, suppression and quotas. */
export class InvitationEmailOutbox {
  constructor(private readonly env:Env,private readonly clock:()=>number=Date.now){}
  async prepare(actor:Actor,invitationId:string,configuration:z.infer<typeof config>){
    const settings=config.parse(configuration);await requireTenant(this.env,actor);await requireMembership(this.env,actor,['owner']);
    const now=new Date(this.clock()).toISOString();
    const invitation=await this.env.AGENT_DB.prepare(`SELECT i.*,t.name FROM agent_team_invitations i JOIN agent_tenants t ON t.id=i.tenant_id
      WHERE i.id=? AND i.tenant_id=? AND i.status='pending' AND i.expires_at>?`).bind(invitationId,actor.tenantId,now).first<{invited_email:string;role:'manager'|'staff'|'billing'|'viewer';expires_at:string;name:string}>();
    if(!invitation)throw new HttpError(409,'invitation_email_unavailable','This invitation is no longer pending.');
    const message=invitationEmail({from:settings.from,recipient:invitation.invited_email,businessName:invitation.name,role:invitation.role,expiresAt:invitation.expires_at,appOrigin:this.env.APP_ORIGIN});
    const serialized=JSON.stringify(message),hash=await digest(serialized),id=await digest(JSON.stringify(['invitation-email-v1',actor.tenantId,invitationId]));
    await this.env.AGENT_DB.prepare(`INSERT OR IGNORE INTO agent_platform_email_outbox(id,tenant_id,invitation_id,prepared_by,route_ref,recipient,invited_role,invitation_expires_at,payload_json,payload_hash,idempotency_key,state,created_at,next_attempt_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,'prepared',?,? WHERE EXISTS(SELECT 1 FROM agent_memberships m JOIN agent_tenants t ON t.id=m.tenant_id WHERE m.tenant_id=? AND m.user_id=? AND m.role='owner' AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>?) AND t.status NOT IN ('deleted','offboarding'))
      AND EXISTS(SELECT 1 FROM agent_team_invitations WHERE id=? AND tenant_id=? AND status='pending' AND invited_email=? AND role=? AND expires_at=? AND expires_at>?)`)
      .bind(id,actor.tenantId,invitationId,actor.userId,settings.routeRef,invitation.invited_email,invitation.role,invitation.expires_at,serialized,hash,`mayor-ai:email:${id}`,now,now,actor.tenantId,actor.userId,now,invitationId,actor.tenantId,invitation.invited_email,invitation.role,invitation.expires_at,now).run();
    await requireMembership(this.env,actor,['owner']);
    const saved=await this.env.AGENT_DB.prepare('SELECT id,payload_hash,route_ref,state FROM agent_platform_email_outbox WHERE id=? AND tenant_id=?').bind(id,actor.tenantId).first<Row>();
    if(!saved)throw new HttpError(409,'invitation_email_unavailable','The invitation changed before it could be prepared.');
    if(saved.payload_hash!==hash||saved.route_ref!==settings.routeRef)throw new HttpError(409,'email_payload_changed','The prepared email requires review before changing its contents or sender routing.');
    return {id:saved.id,state:saved.state};
  }
  async claim(tenantId:string,id:string,routeRef:string):Promise<EmailClaim|null>{
    await this.reconcileAuthority(tenantId,id);
    const now=new Date(this.clock()).toISOString(),oldest=new Date(this.clock()-23*3600000).toISOString(),token=crypto.randomUUID();
    // An abandoned request outside the provider deduplication window is never resent.
    await this.env.AGENT_DB.prepare(`UPDATE agent_platform_email_outbox SET state='review_required',last_code='email_retry_window_closed',lease_token=NULL,lease_expires_at=NULL
      WHERE tenant_id=? AND id=? AND state IN ('sending','retry') AND (lease_expires_at IS NULL OR lease_expires_at<=?) AND (first_attempt_at<=? OR attempts>=5)`)
      .bind(tenantId,id,now,oldest).run();
    const changed=await this.env.AGENT_DB.prepare(`UPDATE agent_platform_email_outbox SET state='sending',attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,?),lease_token=?,lease_expires_at=?
      WHERE tenant_id=? AND id=? AND route_ref=? AND state IN ('prepared','retry','sending') AND next_attempt_at<=? AND (lease_expires_at IS NULL OR lease_expires_at<=?) AND attempts<5 AND (first_attempt_at IS NULL OR (first_attempt_at>? AND first_attempt_at<=?))
      AND ${authoritySql(false)}`)
      .bind(now,token,new Date(this.clock()+90000).toISOString(),tenantId,id,routeRef,now,now,oldest,now,now,now,now).run();
    if(!changed.meta.changes)return null;
    const row=await this.env.AGENT_DB.prepare('SELECT * FROM agent_platform_email_outbox WHERE tenant_id=? AND id=? AND lease_token=?').bind(tenantId,id,token).first<Row>();
    if(!row)return null;
    if(await digest(row.payload_json)!==row.payload_hash){await this.settle({id,tenantId,token},{state:'review_required',code:'email_payload_corrupt'});return null;}
    return {id,tenantId,token,message:JSON.parse(row.payload_json) as PlatformEmail,idempotencyKey:row.idempotency_key,firstAttemptAt:row.first_attempt_at!};
  }
  /** Definitive loss of authority stops unattempted work, but never claims to undo a possible send. */
  async reconcileAuthority(tenantId:string,id:string){
    const now=new Date(this.clock()).toISOString();
    const changed=await this.env.AGENT_DB.prepare(`UPDATE agent_platform_email_outbox
      SET state=CASE WHEN first_attempt_at IS NULL THEN 'cancelled' ELSE 'review_required' END,last_code='email_authority_withdrawn',lease_token=NULL,lease_expires_at=NULL
      WHERE tenant_id=? AND id=? AND state IN ('prepared','retry','sending') AND (lease_expires_at IS NULL OR lease_expires_at<=?) AND NOT (${authoritySql(true)})`)
      .bind(tenantId,id,now,now,now,now).run();
    return Boolean(changed.meta.changes);
  }
  /** Call immediately before transport, after sender/suppression/cost gates. No mutation or network effects. */
  async mayDispatch(claim:EmailClaim,routeRef:string){
    const now=new Date(this.clock()).toISOString(),oldest=new Date(this.clock()-23*3600000).toISOString();
    const row=await this.env.AGENT_DB.prepare(`SELECT payload_hash,idempotency_key,first_attempt_at FROM agent_platform_email_outbox
      WHERE tenant_id=? AND id=? AND route_ref=? AND state='sending' AND lease_token=? AND lease_expires_at>? AND first_attempt_at>? AND first_attempt_at<=? AND ${authoritySql(false)}`)
      .bind(claim.tenantId,claim.id,routeRef,claim.token,now,oldest,now,now,now,now).first<Row>();
    return Boolean(row&&row.first_attempt_at===claim.firstAttemptAt&&row.idempotency_key===claim.idempotencyKey&&await digest(JSON.stringify(claim.message))===row.payload_hash);
  }
  async settle(claim:Pick<EmailClaim,'id'|'tenantId'|'token'>,result:SendResult){
    const row=await this.env.AGENT_DB.prepare("SELECT * FROM agent_platform_email_outbox WHERE id=? AND tenant_id=? AND lease_token=? AND state='sending'").bind(claim.id,claim.tenantId,claim.token).first<Row>();
    if(!row)return false;
    const state=result.state==='accepted'?'accepted':result.state==='rejected'&&row.attempts===1?'rejected':['uncertain','deferred'].includes(result.state)&&row.attempts<5&&this.clock()-Date.parse(row.first_attempt_at!)<23*3600000?'retry':'review_required';
    const code=result.state==='accepted'?null:/^[a-z_]{1,80}$/.test(result.code)?result.code:'email_result_unverified';
    const saved=await this.env.AGENT_DB.prepare(`UPDATE agent_platform_email_outbox SET state=?,provider_id=?,last_code=?,next_attempt_at=?,lease_token=NULL,lease_expires_at=NULL WHERE id=? AND tenant_id=? AND lease_token=? AND state='sending'`)
      .bind(state,result.state==='accepted'?result.providerId:null,code,new Date(this.clock()+Math.min(3600,60*2**row.attempts)*1000).toISOString(),claim.id,claim.tenantId,claim.token).run();
    return Boolean(saved.meta.changes);
  }
}
