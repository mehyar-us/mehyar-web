import {z} from 'zod';
import type {Actor,Env} from './env';
import {requireMembership,OPERATORS} from './permissions';
import {HttpError} from './http';
const name=z.string().trim().min(1).max(160).transform(value=>value.replace(/\s+/g,' '));
const email=z.email().max(254).transform(value=>value.toLowerCase()).nullable();
const phone=z.string().regex(/^\+[1-9]\d{6,14}$/,'Use a phone number with its country code.').nullable();
const profileSchema=z.object({name,email,phone}).strict().refine(profile=>profile.email!==null||profile.phone!==null,'Provide at least one contact method.');
export const customerPatchSchema=z.object({id:z.uuid().optional(),name:name.optional(),email:email.optional(),phone:phone.optional()}).strict()
 .refine(input=>input.name!==undefined||input.email!==undefined||input.phone!==undefined,'Describe at least one contact change.');
export const customerSearchSchema=z.object({query:z.string().trim().min(2).max(160)}).strict();
type Profile=z.infer<typeof profileSchema>;
export type CustomerProposal={id:string;expectedRevision:number;profile:Profile};
type Customer=Profile&{id:string;revision:number};
const key=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
const unavailable=()=>new HttpError(409,'customer_changed','The customer record changed or already exists. Search and review it again.');
export async function readCustomer(env:Env,actor:Actor,id:string){
 await requireMembership(env,actor,OPERATORS);
 const row=await env.AGENT_DB.prepare('SELECT id,name,email,phone,revision FROM mayor_customers WHERE id=? AND tenant_id=?').bind(id,actor.tenantId).first<Customer>();
 if(!row)throw new HttpError(404,'customer_unavailable','This customer record is not available.');
 return {...row,identityVerified:false as const};
}
export async function searchCustomers(env:Env,actor:Actor,raw:z.infer<typeof customerSearchSchema>){
 const input=customerSearchSchema.parse(raw);await requireMembership(env,actor,OPERATORS);
 const query=key(input.query);
 const rows=await env.AGENT_DB.prepare(`SELECT id,name,email,phone,revision FROM mayor_customers
 WHERE tenant_id=? AND (instr(name_key,?)>0 OR instr(COALESCE(email,''),?)>0 OR instr(COALESCE(phone,''),?)>0)
 ORDER BY name_key,id LIMIT 11`).bind(actor.tenantId,query,query,query).all<Customer>();
 return {customers:rows.results.slice(0,10).map(row=>({...row,identityVerified:false})),hasMore:rows.results.length>10};
}
export async function prepareCustomer(env:Env,actor:Actor,raw:z.infer<typeof customerPatchSchema>):Promise<CustomerProposal>{
 const input=customerPatchSchema.parse(raw);await requireMembership(env,actor,OPERATORS);
 const current=input.id?await readCustomer(env,actor,input.id):null;
 const profile=profileSchema.parse({name:input.name??current?.name,email:input.email===undefined?current?.email??null:input.email,phone:input.phone===undefined?current?.phone??null:input.phone});
 const duplicate=await env.AGENT_DB.prepare(`SELECT id FROM mayor_customers WHERE tenant_id=? AND name_key=? AND email IS ? AND phone IS ? AND id!=?`).bind(actor.tenantId,key(profile.name),profile.email,profile.phone,current?.id??'').first();
 if(duplicate)throw unavailable();
 return {id:current?.id??crypto.randomUUID(),expectedRevision:current?.revision??0,profile};
}
export function customerReadback(proposal:CustomerProposal){
 return `Please verify ${proposal.expectedRevision?'these updated customer contact details':'this new customer contact'}: ${proposal.profile.name}. Email: ${proposal.profile.email??'not provided'}. Phone: ${proposal.profile.phone??'not provided'}. This saves contact information; it does not verify the person or send a message. Say yes to save, or tell me what to correct.`;
}
/** Never exposed as an AI write tool; call only after a separate explicit confirmation. */
export async function confirmCustomer(env:Env,actor:Actor,proposal:CustomerProposal){
 await requireMembership(env,actor,OPERATORS);
 const profile=profileSchema.parse(proposal.profile),now=new Date().toISOString();
 const existing=await env.AGENT_DB.prepare('SELECT name,email,phone,revision FROM mayor_customers WHERE tenant_id=? AND id=?').bind(actor.tenantId,proposal.id).first<Customer>();
 if(existing?.revision===proposal.expectedRevision+1&&existing.name===profile.name&&existing.email===profile.email&&existing.phone===profile.phone)return {id:proposal.id,revision:existing.revision,saved:true,identityVerified:false};
 const permitted=`EXISTS(SELECT 1 FROM agent_memberships m JOIN agent_tenants t ON t.id=m.tenant_id WHERE m.tenant_id=? AND m.user_id=? AND m.status='active' AND t.status='active' AND m.role IN ('owner','manager') AND (m.expires_at IS NULL OR m.expires_at>?))`;
 const statement=proposal.expectedRevision===0
  ?env.AGENT_DB.prepare(`INSERT OR IGNORE INTO mayor_customers(id,tenant_id,name,name_key,email,phone,confirmed_by,created_at,updated_at)
   SELECT ?,?,?,?,?,?,?,?,? WHERE ${permitted} RETURNING id,revision`).bind(proposal.id,actor.tenantId,profile.name,key(profile.name),profile.email,profile.phone,actor.userId,now,now,actor.tenantId,actor.userId,now)
  :env.AGENT_DB.prepare(`UPDATE OR IGNORE mayor_customers SET name=?,name_key=?,email=?,phone=?,confirmed_by=?,updated_at=?,revision=revision+1
   WHERE id=? AND tenant_id=? AND revision=? AND ${permitted} RETURNING id,revision`).bind(profile.name,key(profile.name),profile.email,profile.phone,actor.userId,now,proposal.id,actor.tenantId,proposal.expectedRevision,actor.tenantId,actor.userId,now);
 // D1 change counts include the audit trigger; use the mutation receipt itself.
 const result=await statement.first<{id:string;revision:number}>();
 if(!result)throw unavailable();
 return {id:proposal.id,revision:proposal.expectedRevision+1,saved:true,identityVerified:false};
}
