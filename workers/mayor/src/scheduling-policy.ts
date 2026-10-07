import {z} from 'zod';
import type {Actor,Env} from './env';
import {OPERATORS,requireMembership} from './permissions';
import {HttpError} from './http';

const zone=z.string().max(100).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}}).describe('IANA time zone identifier. Translate a clear location such as New York to America/New_York. Ask a short location question only when ambiguous; never ask the user to supply technical notation.');
const minute=z.number().int().min(0).max(1440);
const period=z.object({day:z.number().int().min(0).max(6),startMinute:minute,endMinute:minute}).strict().refine(p=>p.startMinute<p.endMinute,'Hours must end after they start; split overnight hours across days.');
const hours=z.array(period).max(42).refine(periods=>periods.every((p,i)=>!periods.slice(i+1).some(q=>p.day===q.day&&p.startMinute<q.endMinute&&q.startMinute<p.endMinute)),'Hours must not overlap.');
const name=z.string().trim().min(1).max(160);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().startsWith(v));
export const schedulingPolicySchema=z.object({
 timeZone:zone,
 weeklyHours:hours,
 closedDates:z.array(date).max(366),
 appointmentTypes:z.array(z.object({name,durationMinutes:z.number().int().min(5).max(480),bufferBeforeMinutes:z.number().int().min(0).max(240),bufferAfterMinutes:z.number().int().min(0).max(240)}).strict()).min(1).max(30),
 staff:z.array(z.object({name,weeklyHours:hours,appointmentTypes:z.array(name).min(1).max(30)}).strict()).max(50),
 minimumNoticeMinutes:z.number().int().min(0).max(525600),
 maximumAdvanceDays:z.number().int().min(1).max(730),
 cancellationNoticeMinutes:z.number().int().min(0).max(525600),
}).strict().superRefine((policy,ctx)=>{
 const unique=(values:string[])=>new Set(values.map(v=>v.toLowerCase())).size===values.length;
 if(!unique(policy.appointmentTypes.map(t=>t.name))||!unique(policy.staff.map(s=>s.name)))ctx.addIssue({code:'custom',message:'Names must be unique.'});
 if(policy.staff.some(s=>s.appointmentTypes.some(t=>!policy.appointmentTypes.some(type=>type.name===t))))ctx.addIssue({code:'custom',message:'Staff must reference a configured appointment type.'});
});
export type SchedulingPolicy=z.infer<typeof schedulingPolicySchema>;
export async function readSchedulingPolicy(env:Env,actor:Actor){
 await requireMembership(env,actor);
 const row=await env.AGENT_DB.prepare("SELECT value_json,revision FROM mayor_memory WHERE tenant_id=? AND field='scheduling_policy'").bind(actor.tenantId).first<{value_json:string;revision:number}>();
 // Access can change while D1 is reading; discard data for a revoked reader.
 await requireMembership(env,actor);
 return {policy:row?schedulingPolicySchema.parse(JSON.parse(row.value_json)):null,revision:row?.revision??0};
}
export async function confirmSchedulingPolicy(env:Env,actor:Actor,input:SchedulingPolicy,revision:number,setupRevision?:number){
 await requireMembership(env,actor,OPERATORS);
 const policy=schedulingPolicySchema.parse(input),now=new Date().toISOString();
 const permitted="EXISTS(SELECT 1 FROM agent_memberships m JOIN agent_tenants t ON t.id=m.tenant_id WHERE m.tenant_id=? AND m.user_id=? AND m.status='active' AND t.status='active' AND m.role IN ('owner','manager') AND (m.expires_at IS NULL OR m.expires_at>?))";
 // Separate insert/update avoids resurrecting a deleted record from a stale revision.
 const statement=revision===0
  ?env.AGENT_DB.prepare(`INSERT OR IGNORE INTO mayor_memory(tenant_id,field,value_json,source_kind,confirmed_by,confirmed_at,revision,updated_at) SELECT ?,'scheduling_policy',?,'owner_conversation',?,?,1,? WHERE (? IS NULL OR EXISTS(SELECT 1 FROM mayor_memory WHERE tenant_id=? AND field='scheduling_setup' AND revision=?)) AND ${permitted}`).bind(actor.tenantId,JSON.stringify(policy),actor.userId,now,now,setupRevision??null,actor.tenantId,setupRevision??null,actor.tenantId,actor.userId,now)
  :env.AGENT_DB.prepare(`UPDATE mayor_memory SET value_json=?,confirmed_by=?,confirmed_at=?,revision=revision+1,updated_at=? WHERE tenant_id=? AND field='scheduling_policy' AND revision=? AND ${permitted}`).bind(JSON.stringify(policy),actor.userId,now,now,actor.tenantId,revision,actor.tenantId,actor.userId,now);
 const results=await env.AGENT_DB.batch([statement,env.AGENT_DB.prepare("INSERT INTO mayor_audit(id,tenant_id,actor_id,event,resource_id,created_at) SELECT ?,?,?,'scheduling_policy.confirmed',?,? WHERE changes()=1").bind(crypto.randomUUID(),actor.tenantId,actor.userId,String(revision+1),now)]);
 if(results[0].meta.changes!==1)throw new HttpError(409,'policy_changed','Your scheduling rules changed. Review them again before saving.');
 return {policy,revision:revision+1};
}

function localTime(instant:number,formatter:Intl.DateTimeFormat){
 const parts=formatter.formatToParts(instant);
 const value=(type:string)=>parts.find(p=>p.type===type)!.value;
 const day=`${value('year')}-${value('month')}-${value('day')}`;
 return {date:day,day:new Date(day+'T00:00:00Z').getUTCDay(),minute:Number(value('hour'))*60+Number(value('minute'))};
}
function reject(code:string,message:string):never{throw new HttpError(409,code,message);}
export type Slot={start:string;end:string;appointmentType:string;staff?:string};
/** Evaluate absolute instants in business-local time. No guessed local-time offset. */
export function validateSlot(policy:SchedulingPolicy,slot:Slot,now=Date.now()){
 return createSlotValidator(policy,now)(slot);
}
/** Reuse local minute conversions when searching many slots in one bounded window. */
export function createSlotValidator(policy:SchedulingPolicy,now=Date.now()){
 const formatter=new Intl.DateTimeFormat('en-US',{timeZone:policy.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const minutes=new Map<number,ReturnType<typeof localTime>>();
 return (slot:Slot)=>{
 const instant=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.000)?(?:Z|[+-]\d{2}:\d{2})$/;
 const start=Date.parse(slot.start),end=Date.parse(slot.end);
 if(!instant.test(slot.start)||!instant.test(slot.end)||!Number.isFinite(start)||!Number.isFinite(end)||end<=start)reject('invalid_time','Use exact dates and minute-aligned times with an explicit UTC offset.');
 const type=policy.appointmentTypes.find(t=>t.name===slot.appointmentType);
 if(!type)reject('unknown_appointment_type','Choose a configured appointment type.');
 if(end-start!==type.durationMinutes*60000)reject('invalid_duration','Use the configured appointment duration.');
 if(start<now+policy.minimumNoticeMinutes*60000||start>now+policy.maximumAdvanceDays*86400000)reject('notice_rule','This time is outside the booking notice window.');
 const staff=slot.staff?policy.staff.find(s=>s.name===slot.staff):undefined;
 if((policy.staff.length&&!staff)||(!policy.staff.length&&slot.staff)||staff&&!staff.appointmentTypes.includes(type.name))reject('invalid_staff','Choose an available staff member for this appointment type.');
 const reservedStart=start-type.bufferBeforeMinutes*60000,reservedEnd=end+type.bufferAfterMinutes*60000;
 // Check each occupied minute, including buffers and both sides of DST changes.
 for(let time=reservedStart;time<reservedEnd;time+=60000){
  let local=minutes.get(time);
  if(!local){local=localTime(time,formatter);minutes.set(time,local);}
  if(policy.closedDates.includes(local.date))reject('closed_date','The business is closed on this date.');
  const within=(periods:SchedulingPolicy['weeklyHours'])=>periods.some(p=>p.day===local.day&&p.startMinute<=local.minute&&p.endMinute>local.minute);
  if(!within(policy.weeklyHours)||staff&&!within(staff.weeklyHours))reject('outside_hours','The appointment and its buffers must fit business and staff hours.');
 }
 return {start:new Date(reservedStart).toISOString(),end:new Date(reservedEnd).toISOString(),timeZone:policy.timeZone};
 };
}
export function validateCancellation(policy:SchedulingPolicy,start:string,now=Date.now()){
 const time=Date.parse(start);
 if(!Number.isFinite(time)||time-now<policy.cancellationNoticeMinutes*60000)reject('cancellation_notice','This appointment needs a human review because it is inside the cancellation notice period.');
}
