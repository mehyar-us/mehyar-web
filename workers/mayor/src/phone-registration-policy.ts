import {z} from 'zod';
import type {Actor,Env} from './env';
import {OPERATORS,requireMembership} from './permissions';
import {HttpError} from './http';

export const phoneRegistrationPolicySchema=z.object({enabled:z.boolean()}).strict();
export type PhoneRegistrationPolicyProposal={enabled:boolean;revision:number};
const unavailable=()=>new HttpError(409,'phone_registration_unavailable','Phone registration settings changed. Please review them again.');
export async function readPhoneRegistrationPolicy(env:Env,actor:Actor){
 await requireMembership(env,actor,OPERATORS);
 const row=await env.AGENT_DB.prepare('SELECT enabled,revision FROM mayor_phone_registration_policy WHERE tenant_id=?').bind(actor.tenantId).first<{enabled:number;revision:number}>();
 return {enabled:row?.enabled===1,revision:row?.revision??0};
}
export async function preparePhoneRegistrationPolicy(env:Env,actor:Actor,raw:z.infer<typeof phoneRegistrationPolicySchema>):Promise<PhoneRegistrationPolicyProposal>{
 const input=phoneRegistrationPolicySchema.parse(raw),current=await readPhoneRegistrationPolicy(env,actor);
 return {...input,revision:current.revision};
}
export function phoneRegistrationPolicyReadback(proposal:PhoneRegistrationPolicyProposal){
 return proposal.enabled
  ? 'Allow new callers to register their own name after verifying their calling number by text? They must confirm saving their contact. They may hear and manage only appointments linked to their new contact, with a separate confirmation for every booking, rescheduling or cancellation. Numbers already attached to a contact cannot self-register. This verifies number possession, not personal identity. Say yes to allow new caller registration, or tell me what to change.'
  : 'Disable new caller registration by phone and access granted through that registration setting? Say yes to disable it. Existing appointments will not be cancelled.';
}
/** Invoke only after the operator has separately confirmed the server readback. */
export async function confirmPhoneRegistrationPolicy(env:Env,actor:Actor,proposal:PhoneRegistrationPolicyProposal){
 await requireMembership(env,actor,OPERATORS);
 const input=z.object({enabled:z.boolean(),revision:z.number().int().nonnegative()}).strict().parse(proposal);
 const now=new Date().toISOString();
 const eligible="EXISTS(SELECT 1 FROM agent_memberships m JOIN agent_tenants t ON t.id=m.tenant_id WHERE m.tenant_id=? AND m.user_id=? AND m.status='active' AND t.status='active' AND m.role IN ('owner','manager') AND (m.expires_at IS NULL OR m.expires_at>?))";
 const stmt=input.revision===0
  ?env.AGENT_DB.prepare(`INSERT OR IGNORE INTO mayor_phone_registration_policy(tenant_id,enabled,granted_by,updated_at) SELECT ?,?,?,? WHERE ${eligible} RETURNING revision`).bind(actor.tenantId,Number(input.enabled),actor.userId,now,actor.tenantId,actor.userId,now)
  :env.AGENT_DB.prepare(`UPDATE mayor_phone_registration_policy SET enabled=?,granted_by=?,updated_at=?,revision=revision+1 WHERE tenant_id=? AND revision=? AND ${eligible} RETURNING revision`).bind(Number(input.enabled),actor.userId,now,actor.tenantId,input.revision,actor.tenantId,actor.userId,now);
 const results=await env.AGENT_DB.batch([stmt,env.AGENT_DB.prepare("INSERT INTO mayor_audit(id,tenant_id,actor_id,event,resource_id,created_at) SELECT ?,?,?,?, ?,? WHERE changes()=1").bind(crypto.randomUUID(),actor.tenantId,actor.userId,input.enabled?'phone.registration_enabled':'phone.registration_disabled',actor.tenantId,now)]);
 const receipt=results[0].results[0] as {revision:number}|undefined;if(!receipt)throw unavailable();
 return {enabled:input.enabled,revision:receipt.revision};
}
/** Live policy authority for caller enrollment; membership revocation is immediate. */
export async function activePhoneRegistrationPolicy(env:Env,tenantId:string){
 const now=new Date().toISOString();
 const row=await env.AGENT_DB.prepare(`SELECT p.revision,p.granted_by AS grantor FROM mayor_phone_registration_policy p
 JOIN agent_memberships m ON m.tenant_id=p.tenant_id AND m.user_id=p.granted_by
 JOIN agent_tenants t ON t.id=p.tenant_id
 WHERE p.tenant_id=? AND p.enabled=1 AND m.status='active' AND m.role IN ('owner','manager') AND (m.expires_at IS NULL OR m.expires_at>?) AND t.status='active'`).bind(tenantId,now).first<{revision:number;grantor:string}>();
 if(!row)throw unavailable();return row;
}
