import type {Actor,Env} from './env';
import {assertPhoneCustomer,type PhoneCustomer} from './customer-phone-access';
import {HttpError} from './http';
export async function assertPhoneBookingAuthority(env:Env,actor:Actor,bookingId:string,expectedCallId?:string){
 const row=await env.AGENT_DB.prepare('SELECT call_id,customer_id,scope_json,tenant_id FROM mayor_phone_bookings WHERE booking_id=?').bind(bookingId).first<{call_id:string;customer_id:string;scope_json:string;tenant_id:string}>();
 const deny=()=>new HttpError(403,'phone_booking_unavailable','This call cannot confirm that booking.');
 if(!row){if(expectedCallId)throw deny();return;}
 const scope=JSON.parse(row.scope_json) as PhoneCustomer;
 if(row.tenant_id!==actor.tenantId||scope.grantor!==actor.userId||!scope.allowBookings||expectedCallId&&row.call_id!==expectedCallId)throw deny();
 await assertPhoneCustomer(env,row.call_id,scope);
 const linked=await env.AGENT_DB.prepare('SELECT 1 AS ok FROM mayor_appointment_customers WHERE booking_id=? AND tenant_id=? AND customer_id=?').bind(bookingId,actor.tenantId,row.customer_id).first();
 if(!linked||row.customer_id!==scope.customerId)throw deny();
}
