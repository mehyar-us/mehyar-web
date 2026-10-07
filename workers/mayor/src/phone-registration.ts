import {z} from 'zod';
import type {Env} from './env';
import {HttpError} from './http';
import {verifiedCallNumber} from './phone-verification';
import {activePhoneRegistrationPolicy} from './phone-registration-policy';
export const phoneRegistrationSchema=z.object({name:z.string().trim().min(1).max(160).transform(value=>value.replace(/\s+/g,' '))}).strict();
export type PhoneRegistrationProposal={id:string;callId:string;tenantId:string;number:string;name:string;policyRevision:number;grantor:string;connectionRevision:number;expiresAt:number};
const deny=()=>new HttpError(409,'phone_registration_unavailable','I cannot register this contact on the call. Please ask the business for help.');
export async function preparePhoneRegistration(env:Env,callId:string,raw:z.infer<typeof phoneRegistrationSchema>):Promise<PhoneRegistrationProposal>{
 const input=phoneRegistrationSchema.parse(raw),verified=await verifiedCallNumber(env,callId);if(!verified)throw deny();
 const policy=await activePhoneRegistrationPolicy(env,verified.tenantId);
 const existing=await env.AGENT_DB.prepare('SELECT 1 FROM mayor_customers WHERE tenant_id=? AND phone=? LIMIT 1').bind(verified.tenantId,verified.number).first();if(existing)throw deny();
 return {id:crypto.randomUUID(),callId,tenantId:verified.tenantId,number:verified.number,name:input.name,policyRevision:policy.revision,grantor:policy.grantor,connectionRevision:verified.connectionRevision,expiresAt:Date.now()+120000};
}
export function phoneRegistrationReadback(proposal:PhoneRegistrationProposal){
 return `Save a new contact named ${proposal.name} using the number you verified on this call? Please confirm this is your own number, not a shared number. You can then book and manage appointments linked to this new contact, with a separate confirmation for each change. This does not verify your personal identity or book an appointment. Say yes to save, or tell me what to correct.`;
}
/** Only the separate confirmation handler calls this; never an AI write tool. */
export async function confirmPhoneRegistration(env:Env,callId:string,proposal:PhoneRegistrationProposal,valid:()=>boolean){
 if(proposal.callId!==callId||proposal.expiresAt<=Date.now()||!valid())throw deny();
 const verified=await verifiedCallNumber(env,callId);if(!verified||verified.tenantId!==proposal.tenantId||verified.number!==proposal.number||verified.connectionRevision!==proposal.connectionRevision)throw deny();
 const policy=await activePhoneRegistrationPolicy(env,proposal.tenantId);if(policy.revision!==proposal.policyRevision||policy.grantor!==proposal.grantor)throw deny();
 const name=phoneRegistrationSchema.parse({name:proposal.name}).name,now=new Date().toISOString();
 // Enforce the mutable authorization conditions in the insertion itself, not
 // just in preceding reads. Batch statements run atomically and never attach
 // an existing contact by phone number or guessed name.
 const eligible=`EXISTS(SELECT 1 FROM mayor_phone_registration_policy p
 JOIN agent_memberships m ON m.tenant_id=p.tenant_id AND m.user_id=p.granted_by
 JOIN agent_tenants t ON t.id=p.tenant_id
 WHERE p.tenant_id=? AND p.enabled=1 AND p.revision=? AND p.granted_by=? AND m.status='active' AND m.role IN ('owner','manager') AND (m.expires_at IS NULL OR m.expires_at>?) AND t.status='active')
 AND EXISTS(SELECT 1 FROM mayor_phone_calls c JOIN mayor_phone_verifications v ON v.call_id=c.id AND v.tenant_id=c.tenant_id AND v.connection_revision=c.connection_revision AND v.provider=c.provider
 JOIN mayor_phone_connections n ON n.tenant_id=c.tenant_id AND n.provider=c.provider AND n.revision=c.connection_revision
 JOIN agent_memberships owner ON owner.tenant_id=n.tenant_id AND owner.user_id=n.owner_user_id
 WHERE c.id=? AND c.tenant_id=? AND c.caller_number=? AND c.connection_revision=? AND c.state='streaming' AND c.expires_at>? AND v.state='approved' AND v.expires_at>?
 AND n.status='authorized' AND n.selected_number IS NOT NULL AND owner.status='active' AND owner.role IN ('owner','manager') AND (owner.expires_at IS NULL OR owner.expires_at>?))
 AND NOT EXISTS(SELECT 1 FROM mayor_customers WHERE tenant_id=? AND phone=?)
 AND NOT EXISTS(SELECT 1 FROM mayor_phone_registrations WHERE call_id=?)`;
 if(!valid()||proposal.expiresAt<=Date.now())throw deny();
 const result=await env.AGENT_DB.batch([
  env.AGENT_DB.prepare(`INSERT INTO mayor_customers(id,tenant_id,name,name_key,phone,confirmed_by,created_at,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE ${eligible} RETURNING id`).bind(proposal.id,proposal.tenantId,name,name.normalize('NFKC').toLowerCase(),proposal.number,'phone:'+callId,now,now,proposal.tenantId,proposal.policyRevision,proposal.grantor,now,callId,proposal.tenantId,proposal.number,proposal.connectionRevision,now,now,now,proposal.tenantId,proposal.number,callId),
  env.AGENT_DB.prepare(`INSERT INTO mayor_phone_registrations(customer_id,tenant_id,call_id,policy_revision,created_at) SELECT id,tenant_id,?,?,? FROM mayor_customers WHERE id=? AND tenant_id=? AND confirmed_by=?`).bind(callId,proposal.policyRevision,now,proposal.id,proposal.tenantId,'phone:'+callId),
  env.AGENT_DB.prepare(`INSERT INTO mayor_customer_phone_access(customer_id,tenant_id,customer_revision,enabled,allow_changes,allow_bookings,granted_by,updated_at) SELECT c.id,c.tenant_id,c.revision,1,1,1,?,? FROM mayor_customers c JOIN mayor_phone_registrations r ON r.customer_id=c.id AND r.tenant_id=c.tenant_id WHERE c.id=? AND c.tenant_id=? AND r.call_id=?`).bind(proposal.grantor,now,proposal.id,proposal.tenantId,callId),
 ]);
 if(!result[0].results.length)throw deny();return {saved:true,customerId:proposal.id};
}
