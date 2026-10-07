import {ZohoCalendarClient} from './connectors/zoho-calendar';
import {calendarClient,calendarOperations} from './connectors/calendar-provider';
import {z} from 'zod';
import type {Actor,Env} from './env';
import {HttpError} from './http';
import {OPERATORS,requireMembership} from './permissions';
import {readSchedulingPolicy,validateSlot} from './scheduling-policy';
import {selectedCalendar} from './calendars';
import {connectorCredential,connectionAuthorizationStamp} from './connectors/credentials';
import {GoogleCalendarClient,GOOGLE_CALENDAR_OPERATIONS} from './connectors/google-calendar';
import {MicrosoftCalendarClient,MICROSOFT_CALENDAR_OPERATIONS} from './connectors/microsoft-calendar';
import type {AppointmentReceipt,Provider} from './connectors/types';
import {stableId} from './connectors/http';
import {bookingReceipt} from './connectors/booking-receipt';
import {readCustomer} from './customers';
import {assertPhoneBookingAuthority} from './phone-booking-authorization';
import {requireAppointmentCustomerVersion} from './appointment-customers';

export const bookingSchema=z.object({title:z.string().trim().min(1).max(200),appointmentType:z.string().min(1).max(160),staff:z.string().min(1).max(160).optional(),start:z.string().max(40),end:z.string().max(40),attendees:z.array(z.email().max(254)).max(20)}).strict();
export const bookingProposalSchema=bookingSchema.extend({customerId:z.uuid().optional()});
type Booking=z.infer<typeof bookingProposalSchema>;
type Job={id:string;tenant_id:string;actor_id:string;provider:Provider;grant_id:string;calendar_id:string;authorization_stamp:string;policy_revision:number;input_json:string;reserved_start:string;reserved_end:string;state:string;expires_at:string;receipt_json:string|null};
const operation=(provider:Provider)=>calendarOperations(provider).create;
function unavailable(code:string,message:string):never{throw new HttpError(409,code,message);}
async function recordBooking(env:Env,actor:Actor,job:Job,receipt:AppointmentReceipt){
 const now=new Date().toISOString();
 await env.AGENT_DB.batch([
  env.AGENT_DB.prepare("UPDATE mayor_appointment_jobs SET state='applied',receipt_json=?,updated_at=? WHERE id=? AND state IN ('running','uncertain')").bind(JSON.stringify(receipt),now,job.id),
  env.AGENT_DB.prepare("INSERT OR IGNORE INTO mayor_appointments(id,tenant_id,provider,calendar_id,event_id,etag,input_json,state,created_at,updated_at) SELECT ?,?,?,?,?,?,?,'confirmed',?,? WHERE changes()=1").bind(job.id,actor.tenantId,job.provider,job.calendar_id,receipt.id,receipt.etag??null,job.input_json,now,now),
  env.AGENT_DB.prepare("INSERT INTO mayor_audit(id,tenant_id,actor_id,event,resource_id,created_at) SELECT ?,?,COALESCE((SELECT 'phone:'||call_id FROM mayor_phone_bookings WHERE booking_id=?),?),'appointment.booked',?,? WHERE changes()=1").bind(crypto.randomUUID(),actor.tenantId,job.id,actor.userId,job.id,now),
 ]);
}
export async function proposeBooking(env:Env,actor:Actor,raw:Booking){
 await requireMembership(env,actor,OPERATORS);
 const {customerId,...input}=bookingProposalSchema.parse(raw);
 const customer=customerId?await readCustomer(env,actor,customerId):null;
 const [{policy,revision},selection]=await Promise.all([readSchedulingPolicy(env,actor),selectedCalendar(env,actor)]);
 if(!policy)unavailable('policy_required','First confirm your scheduling rules.');
 if(!selection?.available)unavailable('calendar_required','First connect and choose a scheduling calendar.');
 const reserved=validateSlot(policy,input);
 const stamp=await connectionAuthorizationStamp(env,actor,selection.grantId,selection.provider,operation(selection.provider));
 const id=crypto.randomUUID(),now=new Date().toISOString(),expiresAt=new Date(Date.now()+120000).toISOString();
 const statements=[env.AGENT_DB.prepare(`INSERT INTO mayor_appointment_jobs(id,tenant_id,actor_id,provider,grant_id,calendar_id,authorization_stamp,policy_revision,input_json,reserved_start,reserved_end,state,expires_at,created_at,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,'proposed',?,?,?)`).bind(id,actor.tenantId,actor.userId,selection.provider,selection.grantId,selection.calendar.id,stamp,revision,JSON.stringify(input),reserved.start,reserved.end,expiresAt,now,now)];
 if(customer)statements.push(env.AGENT_DB.prepare('INSERT INTO mayor_appointment_customers(booking_id,tenant_id,customer_id,customer_revision) VALUES(?,?,?,?)').bind(id,actor.tenantId,customer.id,customer.revision));
 await env.AGENT_DB.batch(statements);
 return {id,status:'awaiting_confirmation',input,customer,calendarName:selection.calendar.name,timeZone:policy.timeZone,expiresAt};
}
/** Only invoke following a separate explicit confirmation; never expose as an LLM tool. */
export async function confirmBooking(env:Env,actor:Actor,id:string,transport:typeof fetch=fetch,beforeDispatch?:()=>Promise<void>){
 await assertPhoneBookingAuthority(env,actor,id);
 await requireMembership(env,actor,OPERATORS);
 const job=await env.AGENT_DB.prepare('SELECT * FROM mayor_appointment_jobs WHERE id=? AND tenant_id=? AND actor_id=?').bind(id,actor.tenantId,actor.userId).first<Job>();
 if(!job)throw new HttpError(404,'appointment_unavailable','This appointment request is unavailable.');
 if(job.state==='applied')return {status:'applied',receipt:JSON.parse(job.receipt_json!) as AppointmentReceipt};
 if(job.state!=='proposed')return {status:job.state};
 if(job.expires_at<=new Date().toISOString())unavailable('confirmation_expired','Please review the appointment again.');
 await requireAppointmentCustomerVersion(env,actor,id);
 const input=bookingSchema.parse(JSON.parse(job.input_json));
 const [{policy,revision},selection]=await Promise.all([readSchedulingPolicy(env,actor),selectedCalendar(env,actor)]);
 if(!policy||revision!==job.policy_revision)unavailable('policy_changed','Scheduling rules changed. Review the appointment again.');
 if(!selection?.available||selection.grantId!==job.grant_id||selection.calendar.id!==job.calendar_id)unavailable('calendar_changed','The scheduling calendar changed. Review the appointment again.');
 validateSlot(policy,input);
 const op=operation(job.provider);
 if(job.authorization_stamp!==await connectionAuthorizationStamp(env,actor,job.grant_id,job.provider,op))unavailable('connection_changed','Account permissions changed. Review the appointment again.');
 // Atomic acquisition prevents concurrent app jobs from claiming overlapping times.
 // Running/uncertain jobs retain their reservation after a crash until reconciled.
 const acquired=await env.AGENT_DB.prepare(`UPDATE mayor_appointment_jobs SET state='running',updated_at=? WHERE id=? AND state='proposed'
  AND NOT EXISTS(SELECT 1 FROM mayor_appointment_jobs other WHERE other.tenant_id=? AND other.provider=? AND other.calendar_id=?
   AND other.id!=? AND other.reservation_active=1 AND other.state IN ('running','uncertain','applied') AND other.reserved_start<? AND other.reserved_end>?)`)
  .bind(new Date().toISOString(),id,actor.tenantId,job.provider,job.calendar_id,id,job.reserved_end,job.reserved_start).run();
 if(acquired.meta.changes!==1)unavailable('appointment_conflict','Another appointment request holds this time. Choose another time or check the existing request.');
 let dispatched=false;
 try{
  const auth=await connectorCredential(env,actor,job.grant_id,job.provider,op,transport);
  const client=calendarClient(job.provider,auth,{fetch:transport});
  let cursor:string|undefined;const cursors=new Set<string>();
  for(let page=0;page<20;page++){
   const availability=await client.listAvailability(job.calendar_id,{start:job.reserved_start,end:job.reserved_end,timeZone:policy.timeZone},cursor);
   if(availability.busy.some(b=>!Number.isFinite(Date.parse(b.start))||!Number.isFinite(Date.parse(b.end))||Date.parse(b.end)<=Date.parse(b.start)||Date.parse(b.start)<Date.parse(job.reserved_end)&&Date.parse(b.end)>Date.parse(job.reserved_start)))unavailable('calendar_busy','The calendar is busy at that time.');
   if(availability.complete)break;
   cursor=availability.nextCursor;
   if(!cursor||cursors.has(cursor)||page===19)unavailable('availability_incomplete','Calendar availability could not be fully checked.');
   cursors.add(cursor);
  }
  await requireMembership(env,actor,OPERATORS);
  if(job.authorization_stamp!==await connectionAuthorizationStamp(env,actor,job.grant_id,job.provider,op))unavailable('connection_changed','Account permissions changed.');
  const latest=await readSchedulingPolicy(env,actor);
  if(latest.revision!==revision)unavailable('policy_changed','Scheduling rules changed.');
  const currentCalendar=await selectedCalendar(env,actor);
  if(!currentCalendar?.available||currentCalendar.grantId!==job.grant_id||currentCalendar.calendar.id!==job.calendar_id)unavailable('calendar_changed','The selected calendar changed.');
  await requireAppointmentCustomerVersion(env,actor,id);
  await assertPhoneBookingAuthority(env,actor,id);
  await beforeDispatch?.();
  dispatched=true;
  const receipt=await client.createAppointment(job.calendar_id,{...input,timeZone:policy.timeZone,requestId:id});
  await recordBooking(env,actor,job,receipt);
  return {status:'applied',receipt};
 }catch{
  const status=dispatched?'uncertain':'rejected';
  await env.AGENT_DB.prepare('UPDATE mayor_appointment_jobs SET state=?,updated_at=? WHERE id=? AND state=\'running\'').bind(status,new Date().toISOString(),id).run();
  return {status};
 }
}

export async function listBookingRequests(env:Env,actor:Actor){
 await requireMembership(env,actor,OPERATORS);
 const result=await env.AGENT_DB.prepare(`SELECT j.id,
  COALESCE(c.state,CASE WHEN a.state='cancelled' THEN 'cancelled' ELSE j.state END) AS state,
  j.input_json,j.created_at,r.state AS recovery_state,r.attempts,r.next_attempt_at
  FROM mayor_appointment_jobs j LEFT JOIN mayor_appointments a ON a.id=j.id
  LEFT JOIN mayor_appointment_changes c ON c.appointment_id=j.id AND c.state IN ('running','uncertain')
  LEFT JOIN mayor_recovery_attempts r ON r.request_id=COALESCE(c.id,j.id) AND r.kind=CASE WHEN c.id IS NULL THEN 'booking' ELSE 'change' END
  WHERE j.tenant_id=? AND j.actor_id=? ORDER BY j.created_at DESC LIMIT 20`).bind(actor.tenantId,actor.userId).all<{id:string;state:string;input_json:string;created_at:string;recovery_state:string|null;attempts:number|null;next_attempt_at:number|null}>();
 // Discard fetched appointment data if access changed during the query.
 await requireMembership(env,actor,OPERATORS);
 return result.results.map(row=>({id:row.id,status:row.state,input:bookingSchema.parse(JSON.parse(row.input_json)),createdAt:row.created_at,
  recovery:['running','uncertain'].includes(row.state)&&row.recovery_state?{status:row.recovery_state,attempts:row.attempts,nextCheckAt:row.recovery_state==='pending'?new Date(row.next_attempt_at!).toISOString():null}:null}));
}
/** Recovery observes only. Absence, changed content or incomplete reads never release a reservation. */
export async function reconcileBooking(env:Env,actor:Actor,id:string,transport:typeof fetch=fetch){
 await requireMembership(env,actor,OPERATORS);
 const job=await env.AGENT_DB.prepare('SELECT * FROM mayor_appointment_jobs WHERE id=? AND tenant_id=? AND actor_id=?').bind(id,actor.tenantId,actor.userId).first<Job>();
 if(!job)throw new HttpError(404,'appointment_unavailable','This appointment request is unavailable.');
 if(job.state==='applied')return {status:'applied'};
 if(!['running','uncertain'].includes(job.state))return {status:job.state};
 const input=bookingSchema.parse(JSON.parse(job.input_json));
 const read=calendarOperations(job.provider).read;
 if(job.authorization_stamp!==await connectionAuthorizationStamp(env,actor,job.grant_id,job.provider,read))unavailable('connection_changed','Reconnect the original calendar account before checking this booking.');
 const auth=await connectorCredential(env,actor,job.grant_id,job.provider,read,transport);
 try{
  const expectedId=job.provider==='google'?await stableId(job.id):undefined;
  const raw=job.provider==='zoho'?await new ZohoCalendarClient(auth,{fetch:transport}).findCreatedAppointment(job.calendar_id,job.id,{...input,timeZone:'UTC'}):job.provider==='google'?await new GoogleCalendarClient(auth,{fetch:transport}).readAppointment(job.calendar_id,expectedId!):await new MicrosoftCalendarClient(auth,{fetch:transport}).findCreatedAppointment(job.calendar_id,job.id);
  if(!raw||typeof raw!=='object')return {status:'uncertain'};
  const receipt=bookingReceipt(job.provider,raw,job.calendar_id,{...input,timeZone:'UTC',requestId:job.id},expectedId);
  await requireMembership(env,actor,OPERATORS);
  if(job.authorization_stamp!==await connectionAuthorizationStamp(env,actor,job.grant_id,job.provider,read))return {status:'uncertain'};
  await recordBooking(env,actor,job,receipt);
  return {status:'applied'};
 }catch{return {status:'uncertain'};}
}
