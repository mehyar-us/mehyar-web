import {z} from 'zod';
import type {Actor,Env} from './env';
import {readCustomer} from './customers';
import {OPERATORS,requireMembership} from './permissions';
import {HttpError} from './http';
import {verifiedCallNumber} from './phone-verification';
import {requirePhoneCall} from './phone-call-access';
import {activePhoneRegistrationPolicy} from './phone-registration-policy';

export const customerPhoneAccessSchema=z.object({customerId:z.uuid(),enabled:z.boolean(),allowChanges:z.boolean().optional(),allowBookings:z.boolean().optional()}).strict();
export type CustomerPhoneAccessProposal={customerId:string;name:string;phone:string|null;customerRevision:number;accessRevision:number;enabled:boolean;allowChanges:boolean;allowBookings:boolean};
const unavailable=()=>new HttpError(409,'phone_access_unavailable','Phone appointment access is unavailable. Ask the business for help.');
export async function prepareCustomerPhoneAccess(env:Env,actor:Actor,input:z.infer<typeof customerPhoneAccessSchema>):Promise<CustomerPhoneAccessProposal>{
 input=customerPhoneAccessSchema.parse(input);
 const customer=await readCustomer(env,actor,input.customerId);
 if(input.enabled){
  if(!customer.phone)throw unavailable();
  const count=await env.AGENT_DB.prepare('SELECT COUNT(*) AS count FROM mayor_customers WHERE tenant_id=? AND phone=?').bind(actor.tenantId,customer.phone).first<{count:number}>();
  if(count?.count!==1)throw unavailable();
 }
 const access=await env.AGENT_DB.prepare('SELECT revision,customer_revision,enabled,allow_changes,allow_bookings FROM mayor_customer_phone_access WHERE customer_id=? AND tenant_id=?').bind(customer.id,actor.tenantId).first<{revision:number;customer_revision:number;enabled:number;allow_changes:number;allow_bookings:number}>();
 return {customerId:customer.id,name:customer.name,phone:customer.phone,customerRevision:customer.revision,accessRevision:access?.revision??0,enabled:input.enabled,allowChanges:input.enabled&&(input.allowChanges??(access?.customer_revision===customer.revision&&access.enabled===1&&access.allow_changes===1)),allowBookings:input.enabled&&(input.allowBookings??(access?.customer_revision===customer.revision&&access.enabled===1&&access.allow_bookings===1))};
}
export function customerPhoneAccessReadback(proposal:CustomerPhoneAccessProposal){
 return proposal.enabled?`Allow ${proposal.name} to hear appointment times by verifying ${proposal.phone} with a text code? Confirm this is their own number, not a shared number. Contact changes will invalidate access. ${proposal.allowChanges?'Also allow rescheduling and cancellation, each only after a separate caller confirmation.':'Appointment changes by phone are not allowed.'} ${proposal.allowBookings?'Also allow new bookings after a separate caller confirmation.':'New phone bookings are not allowed.'} No message will be sent. Say yes to allow access, or tell me what to correct.`:
 `Disable phone appointment access for ${proposal.name}? Say yes to disable access. No message will be sent.`;
}
export async function confirmCustomerPhoneAccess(env:Env,actor:Actor,proposal:CustomerPhoneAccessProposal){
 await requireMembership(env,actor,OPERATORS);
 const now=new Date().toISOString();
 const eligible=`EXISTS(SELECT 1 FROM mayor_customers c WHERE c.id=? AND c.tenant_id=? AND c.revision=? AND (?=0 OR (c.phone IS NOT NULL AND (SELECT COUNT(*) FROM mayor_customers others WHERE others.tenant_id=c.tenant_id AND others.phone=c.phone)=1))) AND EXISTS(SELECT 1 FROM agent_memberships m JOIN agent_tenants t ON t.id=m.tenant_id WHERE m.tenant_id=? AND m.user_id=? AND m.status='active' AND m.role IN ('owner','manager') AND t.status='active' AND (m.expires_at IS NULL OR m.expires_at>?))`;
 const args=[proposal.customerId,actor.tenantId,proposal.customerRevision,Number(proposal.enabled),actor.tenantId,actor.userId,now];
 const statement=proposal.accessRevision===0?
  env.AGENT_DB.prepare(`INSERT OR IGNORE INTO mayor_customer_phone_access(customer_id,tenant_id,customer_revision,enabled,allow_changes,allow_bookings,granted_by,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE ${eligible}`).bind(proposal.customerId,actor.tenantId,proposal.customerRevision,Number(proposal.enabled),Number(proposal.allowChanges),Number(proposal.allowBookings),actor.userId,now,...args):
  env.AGENT_DB.prepare(`UPDATE mayor_customer_phone_access SET customer_revision=?,enabled=?,allow_changes=?,allow_bookings=?,granted_by=?,updated_at=?,revision=revision+1 WHERE customer_id=? AND tenant_id=? AND revision=? AND ${eligible}`).bind(proposal.customerRevision,Number(proposal.enabled),Number(proposal.allowChanges),Number(proposal.allowBookings),actor.userId,now,proposal.customerId,actor.tenantId,proposal.accessRevision,...args);
 const results=await env.AGENT_DB.batch([statement,env.AGENT_DB.prepare("INSERT INTO mayor_audit(id,tenant_id,actor_id,event,resource_id,created_at) SELECT ?,?,?,?, ?,? WHERE changes()=1").bind(crypto.randomUUID(),actor.tenantId,actor.userId,proposal.enabled?'customer.phone_access_enabled':'customer.phone_access_disabled',proposal.customerId,now)]);
 if(results[0].meta.changes!==1)throw unavailable();
 return {enabled:proposal.enabled};
}
/** A dedicated caller principal, never an owner session or arbitrary contact search. */
export async function phoneCustomer(env:Env,callId:string){
 const verified=await verifiedCallNumber(env,callId);if(!verified)throw unavailable();
 const now=new Date().toISOString();
 const row=await env.AGENT_DB.prepare(`SELECT c.id,c.revision AS customer_revision,a.revision AS access_revision,a.granted_by,a.allow_changes,a.allow_bookings
 FROM mayor_customers c JOIN mayor_customer_phone_access a ON a.customer_id=c.id AND a.tenant_id=c.tenant_id AND a.customer_revision=c.revision AND a.enabled=1
 JOIN agent_memberships m ON m.tenant_id=c.tenant_id AND m.user_id=a.granted_by AND m.status='active' AND m.role IN ('owner','manager') AND (m.expires_at IS NULL OR m.expires_at>?)
 WHERE c.tenant_id=? AND c.phone=? AND (SELECT COUNT(*) FROM mayor_customers others WHERE others.tenant_id=c.tenant_id AND others.phone=c.phone)=1`).bind(now,verified.tenantId,verified.number).first<{id:string;customer_revision:number;access_revision:number;granted_by:string;allow_changes:number;allow_bookings:number}>();
 if(!row)throw unavailable();
 const registration=await env.AGENT_DB.prepare('SELECT policy_revision FROM mayor_phone_registrations WHERE customer_id=? AND tenant_id=?').bind(row.id,verified.tenantId).first<{policy_revision:number}>();
 // Registration creates revision 1. A later, separately confirmed operator
 // grant is independent authority and must not remain pinned to the old policy.
 if(registration&&row.access_revision===1){
  const policy=await activePhoneRegistrationPolicy(env,verified.tenantId);
  if(policy.revision!==registration.policy_revision||policy.grantor!==row.granted_by)throw unavailable();
 }
 const connection=await requirePhoneCall(env,callId);
 if(connection.connectionRevision!==verified.connectionRevision)throw unavailable();
 return {tenantId:verified.tenantId,customerId:row.id,customerRevision:row.customer_revision,accessRevision:row.access_revision,grantor:row.granted_by,connectionRevision:connection.connectionRevision,allowChanges:row.allow_changes===1,allowBookings:row.allow_bookings===1};
}
export type PhoneCustomer=Awaited<ReturnType<typeof phoneCustomer>>;
export async function assertPhoneCustomer(env:Env,callId:string,expected:PhoneCustomer){
 const current=await phoneCustomer(env,callId);if(JSON.stringify(current)!==JSON.stringify(expected))throw unavailable();
 return current;
}
