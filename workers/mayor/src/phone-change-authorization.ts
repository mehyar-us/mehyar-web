import type {Actor,Env} from './env';
import {assertPhoneCustomer,type PhoneCustomer} from './customer-phone-access';
import {HttpError} from './http';
export async function assertPhoneChangeAuthority(env:Env,actor:Actor,changeId:string,expectedCallId?:string){
 const row=await env.AGENT_DB.prepare('SELECT call_id,customer_id,scope_json,tenant_id FROM mayor_phone_changes WHERE change_id=?').bind(changeId).first<{call_id:string;customer_id:string;scope_json:string;tenant_id:string}>();
 if(!row){if(expectedCallId)throw new HttpError(403,'phone_change_unavailable','This call cannot change that appointment.');return;}
 const scope=JSON.parse(row.scope_json) as PhoneCustomer;
 if(row.tenant_id!==actor.tenantId||scope.grantor!==actor.userId||!scope.allowChanges||expectedCallId&&row.call_id!==expectedCallId)throw new HttpError(403,'phone_change_unavailable','This call cannot change that appointment.');
 await assertPhoneCustomer(env,row.call_id,scope);
 const linked=await env.AGENT_DB.prepare('SELECT 1 AS ok FROM mayor_appointment_changes ch JOIN mayor_appointment_customers ac ON ac.booking_id=ch.appointment_id AND ac.tenant_id=ch.tenant_id WHERE ch.id=? AND ch.tenant_id=? AND ac.customer_id=?').bind(changeId,actor.tenantId,row.customer_id).first();
 if(!linked||row.customer_id!==scope.customerId)throw new HttpError(403,'phone_change_unavailable','This call cannot change that appointment.');
}
