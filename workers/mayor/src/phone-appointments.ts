import {calendarClient,calendarOperations} from './connectors/calendar-provider';
import type {Env} from './env';
import {phoneCustomer,assertPhoneCustomer} from './customer-phone-access';
import {connectorCredential,connectionAuthorizationStamp} from './connectors/credentials';
import {GoogleCalendarClient,GOOGLE_CALENDAR_OPERATIONS} from './connectors/google-calendar';
import {MicrosoftCalendarClient,MICROSOFT_CALENDAR_OPERATIONS} from './connectors/microsoft-calendar';
import {bookingReceipt} from './connectors/booking-receipt';
import {bookingSchema} from './appointments';
import {readSchedulingPolicy} from './scheduling-policy';
import {HttpError} from './http';
type Appointment={id:string;provider:'google'|'microsoft'|'zoho';calendar_id:string;event_id:string;input_json:string;grant_id:string;authorization_stamp:string;unsettled:number};
/** No caller-selected IDs or search terms. Scope is derived from verified storage. */
export async function readPhoneAppointments(env:Env,callId:string,transport:typeof fetch=fetch){
 const scope=await phoneCustomer(env,callId),actor={tenantId:scope.tenantId,userId:scope.grantor};
 const query=()=>env.AGENT_DB.prepare(`SELECT a.id,a.provider,a.calendar_id,a.event_id,a.input_json,j.grant_id,j.authorization_stamp,EXISTS(SELECT 1 FROM mayor_appointment_changes ch WHERE ch.appointment_id=a.id AND ch.state IN ('running','uncertain')) AS unsettled
 FROM mayor_appointments a JOIN mayor_appointment_jobs j ON j.id=a.id AND j.tenant_id=a.tenant_id
 JOIN mayor_appointment_customers ac ON ac.booking_id=a.id AND ac.tenant_id=a.tenant_id
 WHERE a.tenant_id=? AND ac.customer_id=? AND a.state='confirmed' AND julianday(json_extract(a.input_json,'$.end'))>julianday(?)
 ORDER BY julianday(json_extract(a.input_json,'$.start')),a.id LIMIT 6`).bind(scope.tenantId,scope.customerId,new Date().toISOString()).all<Appointment>();
 const rows=await query(),{policy}=await readSchedulingPolicy(env,actor);
 if(!policy||rows.results.some(row=>row.unsettled))throw new HttpError(409,'phone_calendar_unavailable','Appointment times cannot be verified. Please ask for a callback.');
 const appointments=await Promise.all(rows.results.slice(0,5).map(async row=>{
  const operation=calendarOperations(row.provider).read;
  if(await connectionAuthorizationStamp(env,actor,row.grant_id,row.provider,operation)!==row.authorization_stamp)throw new Error('calendar_changed');
  const credential=await connectorCredential(env,actor,row.grant_id,row.provider,operation,transport);
  const client=calendarClient(row.provider,credential,{fetch:transport});
  const input=bookingSchema.parse(JSON.parse(row.input_json));
  bookingReceipt(row.provider,await client.readAppointment(row.calendar_id,row.event_id),row.calendar_id,{...input,requestId:row.id,timeZone:'UTC'},row.event_id);
  await connectionAuthorizationStamp(env,actor,row.grant_id,row.provider,operation).then(stamp=>{if(stamp!==row.authorization_stamp)throw new Error('calendar_changed');});
  return {id:row.id,start:input.start,end:input.end};
 }));
 await assertPhoneCustomer(env,callId,scope);
 if(JSON.stringify((await query()).results)!==JSON.stringify(rows.results))throw new Error('appointments_changed');
 await env.AGENT_DB.prepare("INSERT INTO mayor_audit(id,tenant_id,actor_id,event,resource_id,created_at) VALUES(?,?,?,'phone.appointment_times_read',?,?)").bind(crypto.randomUUID(),scope.tenantId,'phone:'+callId,scope.customerId,new Date().toISOString()).run();
 return {scope,appointments,hasMore:rows.results.length>5,timeZone:policy.timeZone};
}
export function phoneAppointmentReadback(result:Awaited<ReturnType<typeof readPhoneAppointments>>){
 const format=(value:string)=>new Intl.DateTimeFormat('en-US',{timeZone:result.timeZone,dateStyle:'full',timeStyle:'short'}).format(new Date(value));
 return result.appointments.length?`I checked the calendar. Your upcoming appointment times are ${result.appointments.map(item=>`${format(item.start)} to ${format(item.end)}`).join('; ')}. Time zone ${result.timeZone}.${result.hasMore?' There are more appointments; please ask the business for the full list.':''} No appointment has been changed.`:
 'I found no upcoming appointments linked to your verified customer record in The Mayor. The business may have other records; you can ask for a callback.';
}
