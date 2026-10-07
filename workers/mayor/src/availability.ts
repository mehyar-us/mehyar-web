import {calendarClient,calendarOperations} from './connectors/calendar-provider';
import {z} from 'zod';
import type {Actor,Env} from './env';
import {HttpError} from './http';
import {requireMembership,OPERATORS} from './permissions';
import {readSchedulingPolicy,createSlotValidator,type SchedulingPolicy,type Slot} from './scheduling-policy';
import {selectedCalendar} from './calendars';
import {connectionAuthorizationStamp,connectorCredential} from './connectors/credentials';
import {GoogleCalendarClient,GOOGLE_CALENDAR_OPERATIONS} from './connectors/google-calendar';
import {MicrosoftCalendarClient,MICROSOFT_CALENDAR_OPERATIONS} from './connectors/microsoft-calendar';

const instant=z.iso.datetime({offset:true}).refine(value=>Date.parse(value)%60000===0,'Use minute-aligned times with an explicit offset.');
export const availabilitySchema=z.object({start:instant,end:instant,appointmentType:z.string().min(1).max(160),staff:z.string().min(1).max(160).optional(),limit:z.number().int().min(1).max(10).default(5)}).strict()
 .refine(input=>Date.parse(input.end)>Date.parse(input.start)&&Date.parse(input.end)-Date.parse(input.start)<=7*86400000,'Search a window of at most seven days.');
type Search=z.infer<typeof availabilitySchema>;
type Busy={start:string;end:string};
const fail=(code:string,message:string)=>new HttpError(409,code,message);
function configuredType(policy:SchedulingPolicy,input:Search){
 const type=policy.appointmentTypes.find(t=>t.name===input.appointmentType);
 if(!type)throw fail('unknown_appointment_type','Choose a configured appointment type.');
 const staff=policy.staff.find(s=>s.name===input.staff);
 if(policy.staff.length&&(!staff||!staff.appointmentTypes.includes(type.name))||!policy.staff.length&&input.staff)
  throw fail('invalid_staff','Choose a configured staff member for this appointment type.');
 return type;
}
/** Candidate starts follow a 15-minute grid anchored to the requested start. */
export function availableSlots(policy:SchedulingPolicy,raw:Search,busy:Busy[],now=Date.now()){
 const input=availabilitySchema.parse(raw),type=configuredType(policy,input),validate=createSlotValidator(policy,now);
 const blocked=busy.map(b=>({start:Date.parse(b.start),end:Date.parse(b.end)}));
 if(blocked.some(b=>!Number.isFinite(b.start)||!Number.isFinite(b.end)||b.end<=b.start))throw fail('availability_invalid','The calendar returned invalid availability.');
 const slots:Slot[]=[];
 for(let start=Date.parse(input.start);start+type.durationMinutes*60000<=Date.parse(input.end);start+=15*60000){
  const slot={start:new Date(start).toISOString(),end:new Date(start+type.durationMinutes*60000).toISOString(),appointmentType:type.name,...(input.staff?{staff:input.staff}:{})};
  let reserved:ReturnType<typeof validate>;
  try{reserved=validate(slot);}catch(error){
   if(error instanceof HttpError&&['outside_hours','closed_date','notice_rule'].includes(error.code))continue;
   throw error;
  }
  const reservedStart=Date.parse(reserved.start),reservedEnd=Date.parse(reserved.end);
  if(blocked.some(b=>b.start<reservedEnd&&b.end>reservedStart))continue;
  slots.push(slot);if(slots.length===input.limit)break;
 }
 return slots;
}

export async function findAvailability(env:Env,actor:Actor,raw:Search,transport:typeof fetch=fetch){
 const input=availabilitySchema.parse(raw);
 await requireMembership(env,actor,OPERATORS);
 const [{policy,revision},selection]=await Promise.all([readSchedulingPolicy(env,actor),selectedCalendar(env,actor)]);
 if(!policy)throw fail('policy_required','First confirm your scheduling rules.');
 if(!selection?.available)throw fail('calendar_required','First connect and choose a scheduling calendar.');
 const type=configuredType(policy,input);
 const op=calendarOperations(selection.provider).availability;
 const stamp=await connectionAuthorizationStamp(env,actor,selection.grantId,selection.provider,op);
 const deadline=AbortSignal.timeout(15000);
 const bounded=((url:RequestInfo|URL,init?:RequestInit)=>transport(url,{...init,signal:AbortSignal.any([deadline,...(init?.signal?[init.signal]:[])])})) as typeof fetch;
 const auth=await connectorCredential(env,actor,selection.grantId,selection.provider,op,bounded);
 const client=calendarClient(selection.provider,auth,{fetch:bounded});
 const window={start:new Date(Date.parse(input.start)-type.bufferBeforeMinutes*60000).toISOString(),end:new Date(Date.parse(input.end)+type.bufferAfterMinutes*60000).toISOString(),timeZone:policy.timeZone};
 const busy:Busy[]=[];let cursor:string|undefined;const seen=new Set<string>();
 for(let page=0;page<20;page++){
  const result=await client.listAvailability(selection.calendar.id,window,cursor);
  busy.push(...result.busy);
  if(busy.length>2000)throw fail('availability_incomplete','Search a smaller date range.');
  if(result.complete)break;
  cursor=result.nextCursor;
  if(!cursor||seen.has(cursor)||page===19)throw fail('availability_incomplete','The calendar could not be fully checked.');
  seen.add(cursor);
 }
 // Include unresolved app reservations even when the provider does not yet show them.
 const held=await env.AGENT_DB.prepare(`SELECT reserved_start AS start,reserved_end AS end FROM mayor_appointment_jobs
 WHERE tenant_id=? AND provider=? AND calendar_id=? AND reservation_active=1 AND state IN ('running','uncertain','applied')
 AND reserved_start<? AND reserved_end>? LIMIT 2001`).bind(actor.tenantId,selection.provider,selection.calendar.id,window.end,window.start).all<Busy>();
 if(held.results.length>2000)throw fail('availability_incomplete','Search a smaller date range.');
 busy.push(...held.results);
 await requireMembership(env,actor,OPERATORS);
 const [latest,current]=await Promise.all([readSchedulingPolicy(env,actor),selectedCalendar(env,actor)]);
 if(latest.revision!==revision)throw fail('policy_changed','Scheduling rules changed. Search again.');
 if(!current?.available||current.provider!==selection.provider||current.grantId!==selection.grantId||current.calendar.id!==selection.calendar.id||stamp!==await connectionAuthorizationStamp(env,actor,selection.grantId,selection.provider,op))
  throw fail('connection_changed','Your calendar connection changed. Search again.');
 const checkedAt=new Date().toISOString();
 const formatter=new Intl.DateTimeFormat('en-US',{timeZone:policy.timeZone,year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'shortOffset'});
 return {slots:availableSlots(policy,input,busy).map(slot=>({...slot,localStart:formatter.format(new Date(slot.start)),localEnd:formatter.format(new Date(slot.end))})),timeZone:policy.timeZone,calendarName:selection.calendar.name,checkedAt,held:false,stepMinutes:15,
  message:'These are suggestions, not reservations. Confirm a booking to recheck current availability. An empty list means no matching start on this 15-minute search grid.'};
}
