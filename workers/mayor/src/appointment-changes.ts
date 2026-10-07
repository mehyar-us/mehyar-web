import {calendarClient,calendarOperations} from './connectors/calendar-provider';
import {z} from 'zod';
import type {Actor,Env} from './env';
import {HttpError} from './http';
import {OPERATORS,requireMembership} from './permissions';
import {bookingSchema} from './appointments';
import {readSchedulingPolicy,validateSlot,validateCancellation} from './scheduling-policy';
import {connectorCredential,connectionAuthorizationStamp} from './connectors/credentials';
import {GoogleCalendarClient,GOOGLE_CALENDAR_OPERATIONS} from './connectors/google-calendar';
import {MicrosoftCalendarClient,MICROSOFT_CALENDAR_OPERATIONS} from './connectors/microsoft-calendar';
import {bookingReceipt} from './connectors/booking-receipt';
import {requireReschedulable} from './connectors/reschedule';
import {requireRescheduleAvailability} from './connectors/reschedule-availability';
import type {Provider} from './connectors/types';
import {appointmentCustomer,requireAppointmentCustomerVersion} from './appointment-customers';
import {readCustomer} from './customers';
import {assertPhoneChangeAuthority} from './phone-change-authorization';

export const changeSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('cancel'),appointmentId:z.uuid()}).strict(),
 z.object({kind:z.literal('reschedule'),appointmentId:z.uuid(),start:z.string().max(40),end:z.string().max(40)}).strict(),
]);
type Appointment={id:string;provider:Provider;calendar_id:string;event_id:string;input_json:string;state:string;grant_id:string;authorization_stamp:string;reserved_start:string;reserved_end:string};
type Change={id:string;appointment_id:string;kind:'reschedule'|'cancel';state:string;expected_etag:string;before_json:string;after_json:string;policy_revision:number;authorization_stamp:string;old_start:string;old_end:string;new_start:string;new_end:string;expires_at:string;customer_revision:number|null};
function fail(code:string,message:string):never{throw new HttpError(409,code,message);}
async function recordChange(env:Env,actor:Actor,change:Change,etag:string|null){
 const now=new Date().toISOString();
 // changes() gates every following statement, so concurrent recovery is idempotent.
 await env.AGENT_DB.batch([
  env.AGENT_DB.prepare("UPDATE mayor_appointment_changes SET state='applied',updated_at=? WHERE id=? AND state IN ('running','uncertain')").bind(now,change.id),
  env.AGENT_DB.prepare('UPDATE mayor_appointments SET input_json=?,state=?,etag=?,updated_at=? WHERE id=? AND changes()=1').bind(change.after_json,change.kind==='cancel'?'cancelled':'confirmed',etag,now,change.appointment_id),
  env.AGENT_DB.prepare('UPDATE mayor_appointment_jobs SET input_json=?,reserved_start=?,reserved_end=?,reservation_active=?,updated_at=? WHERE id=? AND changes()=1').bind(change.after_json,change.new_start,change.new_end,change.kind==='cancel'?0:1,now,change.appointment_id),
  env.AGENT_DB.prepare("INSERT INTO mayor_audit(id,tenant_id,actor_id,event,resource_id,created_at) SELECT ?,?,COALESCE((SELECT 'phone:'||call_id FROM mayor_phone_changes WHERE change_id=?),?),?,?,? WHERE changes()=1").bind(crypto.randomUUID(),actor.tenantId,change.id,actor.userId,`appointment.${change.kind}`,change.id,now),
 ]);
}
async function appointment(env:Env,actor:Actor,id:string){
 await requireMembership(env,actor,OPERATORS);
 const row=await env.AGENT_DB.prepare(`SELECT a.*,j.grant_id,j.authorization_stamp,j.reserved_start,j.reserved_end FROM mayor_appointments a
 JOIN mayor_appointment_jobs j ON j.id=a.id WHERE a.id=? AND a.tenant_id=?`).bind(id,actor.tenantId).first<Appointment>();
 if(!row)throw new HttpError(404,'appointment_unavailable','This appointment is unavailable.');
 return row;
}
function operation(provider:Provider,kind:'reschedule'|'cancel'){
 const operations=calendarOperations(provider);
 return kind==='cancel'?operations.cancel:operations.update;
}
async function connection(env:Env,actor:Actor,row:Appointment,kind:'reschedule'|'cancel',transport:typeof fetch){
 const op=operation(row.provider,kind);
 const stamp=await connectionAuthorizationStamp(env,actor,row.grant_id,row.provider,op);
 if(stamp!==row.authorization_stamp)fail('connection_changed','The original calendar permissions changed. Review the connection first.');
 const auth=await connectorCredential(env,actor,row.grant_id,row.provider,op,transport);
 return {stamp,client:calendarClient(row.provider,auth,{fetch:transport})};
}
function verifyCurrent(row:Appointment,raw:unknown){
 const input=bookingSchema.parse(JSON.parse(row.input_json));
 const receipt=bookingReceipt(row.provider,raw,row.calendar_id,{...input,timeZone:'UTC',requestId:row.id},row.event_id);
 requireReschedulable(row.provider,raw,row.event_id,receipt.etag!);
 return receipt;
}
export async function listAppointments(env:Env,actor:Actor,customerId?:string){
 await requireMembership(env,actor,OPERATORS);
 if(customerId)await readCustomer(env,actor,z.uuid().parse(customerId));
 const rows=await env.AGENT_DB.prepare(`SELECT a.id,a.input_json,a.state,c.state AS pending,c.id AS change_id,
 r.state AS recovery_state,r.attempts,r.next_attempt_at,ac.customer_id,cu.name AS customer_name
 FROM mayor_appointments a
 LEFT JOIN mayor_appointment_changes c ON c.appointment_id=a.id AND c.state IN ('running','uncertain')
 LEFT JOIN mayor_recovery_attempts r ON r.kind='change' AND r.request_id=c.id
 LEFT JOIN mayor_appointment_customers ac ON ac.booking_id=a.id AND ac.tenant_id=a.tenant_id
 LEFT JOIN mayor_customers cu ON cu.id=ac.customer_id AND cu.tenant_id=a.tenant_id
 WHERE a.tenant_id=? AND (? IS NULL OR ac.customer_id=?) ORDER BY a.updated_at DESC LIMIT 30`).bind(actor.tenantId,customerId??null,customerId??null).all<{id:string;input_json:string;state:string;pending:string|null;change_id:string|null;recovery_state:string|null;attempts:number|null;next_attempt_at:number|null;customer_id:string|null;customer_name:string|null}>();
 // Discard fetched appointment data if access changed during the query.
 await requireMembership(env,actor,OPERATORS);
 return rows.results.map(row=>({id:row.id,input:bookingSchema.parse(JSON.parse(row.input_json)),status:row.pending??row.state,pendingChangeId:row.change_id,
  customer:row.customer_id?{id:row.customer_id,name:row.customer_name,identityVerified:false}:null,
  recovery:row.recovery_state?{status:row.recovery_state,attempts:row.attempts,nextCheckAt:row.recovery_state==='pending'?new Date(row.next_attempt_at!).toISOString():null}:null}));
}
export async function proposeAppointmentChange(env:Env,actor:Actor,input:z.infer<typeof changeSchema>,transport:typeof fetch=fetch){
 input=changeSchema.parse(input);
 const row=await appointment(env,actor,input.appointmentId);
 const customer=await appointmentCustomer(env,actor,row.id);
 if(row.state!=='confirmed')fail('appointment_not_active','This appointment is not active.');
 const {policy,revision}=await readSchedulingPolicy(env,actor);
 if(!policy)fail('policy_required','Confirm scheduling rules first.');
 const before=bookingSchema.parse(JSON.parse(row.input_json));
 validateCancellation(policy,before.start);
 const after=input.kind==='reschedule'?{...before,start:input.start,end:input.end}:before;
 const reserved=input.kind==='reschedule'?validateSlot(policy,after):{start:row.reserved_start,end:row.reserved_end};
 const {client,stamp}=await connection(env,actor,row,input.kind,transport);
 const receipt=verifyCurrent(row,await client.readAppointment(row.calendar_id,row.event_id));
 const id=crypto.randomUUID(),now=new Date().toISOString(),expiresAt=new Date(Date.now()+120000).toISOString();
 await env.AGENT_DB.prepare(`INSERT INTO mayor_appointment_changes(id,tenant_id,actor_id,appointment_id,kind,state,expected_etag,before_json,after_json,policy_revision,authorization_stamp,old_start,old_end,new_start,new_end,expires_at,created_at,updated_at,customer_revision)
 VALUES(?,?,?,?,?,'proposed',?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,actor.tenantId,actor.userId,row.id,input.kind,receipt.etag!,JSON.stringify(before),JSON.stringify(after),revision,stamp,row.reserved_start,row.reserved_end,reserved.start,reserved.end,expiresAt,now,now,customer?.revision??null).run();
 return {id,kind:input.kind,status:'awaiting_confirmation',before,after,customer,timeZone:policy.timeZone,expiresAt};
}
/** Called only by the separate confirmation turn, never as a model tool. */
export async function confirmAppointmentChange(env:Env,actor:Actor,id:string,transport:typeof fetch=fetch,beforeDispatch?:()=>Promise<void>){
 await assertPhoneChangeAuthority(env,actor,id);
 await requireMembership(env,actor,OPERATORS);
 const change=await env.AGENT_DB.prepare('SELECT * FROM mayor_appointment_changes WHERE id=? AND tenant_id=? AND actor_id=?').bind(id,actor.tenantId,actor.userId).first<Change>();
 if(!change)throw new HttpError(404,'change_unavailable','This appointment change is unavailable.');
 if(change.state!=='proposed')return {status:change.state,kind:change.kind};
 if(change.expires_at<=new Date().toISOString())fail('confirmation_expired','Review the appointment change again.');
 const row=await appointment(env,actor,change.appointment_id);
 await requireAppointmentCustomerVersion(env,actor,row.id,change.customer_revision);
 if(row.state!=='confirmed'||row.input_json!==change.before_json)fail('appointment_changed','The appointment changed. Review it again.');
 const {policy,revision}=await readSchedulingPolicy(env,actor);
 if(!policy||revision!==change.policy_revision)fail('policy_changed','Scheduling rules changed. Review this request again.');
 const before=bookingSchema.parse(JSON.parse(change.before_json)),after=bookingSchema.parse(JSON.parse(change.after_json));
 validateCancellation(policy,before.start);
 if(change.kind==='reschedule')validateSlot(policy,after);
 const {client,stamp}=await connection(env,actor,row,change.kind,transport);
 if(stamp!==change.authorization_stamp)fail('connection_changed','Calendar permissions changed.');
 let acquired=false;
 try{const result=await env.AGENT_DB.prepare("UPDATE mayor_appointment_changes SET state='running',updated_at=? WHERE id=? AND state='proposed'").bind(new Date().toISOString(),id).run();acquired=result.meta.changes===1;}catch{fail('change_in_progress','Another change is already being checked for this appointment.');}
 if(!acquired)fail('change_in_progress','This request is already being processed.');
 let dispatched=false,reserved=false;
 try{
  const locked=await appointment(env,actor,row.id);
  if(locked.state!=='confirmed'||locked.input_json!==change.before_json||locked.reserved_start!==change.old_start||locked.reserved_end!==change.old_end)fail('appointment_changed','The appointment changed while this request was waiting.');
  const expandedStart=change.old_start<change.new_start?change.old_start:change.new_start;
  const expandedEnd=change.old_end>change.new_end?change.old_end:change.new_end;
  const reservation=await env.AGENT_DB.prepare(`UPDATE mayor_appointment_jobs SET reserved_start=?,reserved_end=? WHERE id=?
   AND (?='cancel' OR NOT EXISTS(SELECT 1 FROM mayor_appointment_jobs other WHERE other.tenant_id=? AND other.provider=? AND other.calendar_id=? AND other.id!=?
    AND other.reservation_active=1 AND other.state IN ('running','uncertain','applied') AND other.reserved_start<? AND other.reserved_end>?))`)
   .bind(expandedStart,expandedEnd,row.id,change.kind,actor.tenantId,row.provider,row.calendar_id,row.id,change.new_end,change.new_start).run();
  if(reservation.meta.changes!==1)fail('appointment_conflict','Another request holds the new time.');
  reserved=true;
  const current=verifyCurrent(row,await client.readAppointment(row.calendar_id,row.event_id));
  if(current.etag!==change.expected_etag)fail('appointment_changed','The provider appointment changed. Review it again.');
  if(change.kind==='reschedule')await requireRescheduleAvailability(client,row.calendar_id,row.event_id,{start:change.new_start,end:change.new_end,timeZone:policy.timeZone});
  await requireMembership(env,actor,OPERATORS);
  if((await readSchedulingPolicy(env,actor)).revision!==revision||await connectionAuthorizationStamp(env,actor,row.grant_id,row.provider,operation(row.provider,change.kind))!==stamp)fail('authorization_changed','Rules or calendar permissions changed.');
  validateCancellation(policy,before.start);
  if(change.kind==='reschedule')validateSlot(policy,after);
  await requireAppointmentCustomerVersion(env,actor,row.id,change.customer_revision);
  await assertPhoneChangeAuthority(env,actor,id);
  await beforeDispatch?.();
  dispatched=true;
  const receipt=change.kind==='cancel'?await client.cancelAppointment(row.calendar_id,row.event_id,change.expected_etag,policy.timeZone)
   :await client.rescheduleAppointment(row.calendar_id,row.event_id,change.expected_etag,{start:after.start,end:after.end,timeZone:policy.timeZone,requestId:id});
  await recordChange(env,actor,change,receipt.etag??null);
  return {status:'applied',kind:change.kind};
 }catch{
  const status=dispatched?'uncertain':'rejected';
  const statements=[env.AGENT_DB.prepare('UPDATE mayor_appointment_changes SET state=?,updated_at=? WHERE id=?').bind(status,new Date().toISOString(),id)];
  if(!dispatched&&reserved)statements.unshift(env.AGENT_DB.prepare('UPDATE mayor_appointment_jobs SET reserved_start=?,reserved_end=? WHERE id=?').bind(change.old_start,change.old_end,row.id));
  await env.AGENT_DB.batch(statements);
  return {status,kind:change.kind};
 }
}

/** Observes desired provider state only; never repeats PATCH or DELETE. */
export async function reconcileAppointmentChange(env:Env,actor:Actor,id:string,transport:typeof fetch=fetch){
 await requireMembership(env,actor,OPERATORS);
 const change=await env.AGENT_DB.prepare('SELECT * FROM mayor_appointment_changes WHERE id=? AND tenant_id=? AND actor_id=?').bind(id,actor.tenantId,actor.userId).first<Change>();
 if(!change)throw new HttpError(404,'change_unavailable','This appointment change is unavailable.');
 if(!['running','uncertain'].includes(change.state))return {status:change.state,kind:change.kind};
 const row=await appointment(env,actor,change.appointment_id);
 const {client,stamp}=await connection(env,actor,row,change.kind,transport);
 if(stamp!==change.authorization_stamp)fail('connection_changed','The original calendar authorization changed.');
 try{
  const raw=await client.readAppointment(row.calendar_id,row.event_id);
  let etag:string|null=null;
  if(change.kind==='reschedule'){
   const input=bookingSchema.parse(JSON.parse(change.after_json));
   etag=bookingReceipt(row.provider,raw,row.calendar_id,{...input,timeZone:'UTC',requestId:row.id},row.event_id).etag??null;
  }else{
   const event=raw as unknown as Record<string,unknown>;
   // A missing event (404) might also mean lost access. Require positive cancellation evidence.
   if(event.id!==row.event_id||(row.provider!=='microsoft'?event.status!=='cancelled':event.isCancelled!==true))return {status:'uncertain',kind:change.kind};
  }
  await requireMembership(env,actor,OPERATORS);
  if(await connectionAuthorizationStamp(env,actor,row.grant_id,row.provider,operation(row.provider,change.kind))!==stamp)return {status:'uncertain',kind:change.kind};
  await recordChange(env,actor,change,etag);
  return {status:'applied',kind:change.kind};
 }catch{return {status:'uncertain',kind:change.kind};}
}
