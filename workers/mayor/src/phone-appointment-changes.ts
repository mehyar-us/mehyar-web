import {z} from 'zod';
import type {Env} from './env';
import {phoneCustomer,assertPhoneCustomer} from './customer-phone-access';
import {changeSchema,proposeAppointmentChange,confirmAppointmentChange} from './appointment-changes';
import {assertPhoneChangeAuthority} from './phone-change-authorization';
import {HttpError} from './http';

export async function proposePhoneAppointmentChange(env:Env,callId:string,raw:z.infer<typeof changeSchema>,transport:typeof fetch=fetch){
 const input=changeSchema.parse(raw),scope=await phoneCustomer(env,callId);
 if(!scope.allowChanges)throw new HttpError(403,'phone_changes_not_allowed','The business has not allowed appointment changes on this call.');
 const actor={tenantId:scope.tenantId,userId:scope.grantor};
 const linked=await env.AGENT_DB.prepare('SELECT 1 AS ok FROM mayor_appointment_customers WHERE booking_id=? AND tenant_id=? AND customer_id=?').bind(input.appointmentId,scope.tenantId,scope.customerId).first();
 if(!linked)throw new HttpError(403,'phone_change_unavailable','This call cannot change that appointment.');
 const proposal=await proposeAppointmentChange(env,actor,input,transport);
 await assertPhoneCustomer(env,callId,scope);
 const now=new Date().toISOString();
 await env.AGENT_DB.batch([
  env.AGENT_DB.prepare('INSERT INTO mayor_phone_changes(change_id,tenant_id,call_id,customer_id,scope_json,created_at) VALUES(?,?,?,?,?,?)').bind(proposal.id,scope.tenantId,callId,scope.customerId,JSON.stringify(scope),now),
  env.AGENT_DB.prepare("INSERT INTO mayor_audit(id,tenant_id,actor_id,event,resource_id,created_at) VALUES(?,?,?,'phone.appointment_change_proposed',?,?)").bind(crypto.randomUUID(),scope.tenantId,'phone:'+callId,proposal.id,now),
 ]);
 // Never return private titles, attendee addresses or linked contact details.
 return {id:proposal.id,scope,kind:proposal.kind,before:{start:proposal.before.start,end:proposal.before.end},after:{start:proposal.after.start,end:proposal.after.end},timeZone:proposal.timeZone,expiresAt:proposal.expiresAt};
}
export async function confirmPhoneAppointmentChange(env:Env,callId:string,id:string,valid:()=>boolean,transport:typeof fetch=fetch){
 const scope=await phoneCustomer(env,callId),actor={tenantId:scope.tenantId,userId:scope.grantor};
 await assertPhoneChangeAuthority(env,actor,id,callId);
 if(!valid())throw new Error('phone_confirmation_interrupted');
 return confirmAppointmentChange(env,actor,id,transport,async()=>{
  await assertPhoneChangeAuthority(env,actor,id,callId);
  if(!valid())throw new Error('phone_confirmation_interrupted');
 });
}
export function phoneChangeReadback(proposal:Awaited<ReturnType<typeof proposePhoneAppointmentChange>>){
 const time=(value:string)=>new Intl.DateTimeFormat('en-US',{timeZone:proposal.timeZone,dateStyle:'full',timeStyle:'short'}).format(new Date(value));
 const before=`${time(proposal.before.start)} to ${time(proposal.before.end)}`;
 return proposal.kind==='cancel'?`Cancel your appointment from ${before}, time zone ${proposal.timeZone}? Say yes to cancel, or tell me what to correct.`:
 `Move your appointment from ${before} to ${time(proposal.after.start)} to ${time(proposal.after.end)}, time zone ${proposal.timeZone}? Say yes to reschedule, or tell me what to correct.`;
}
