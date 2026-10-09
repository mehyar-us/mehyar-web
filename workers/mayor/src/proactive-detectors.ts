import type {Env} from './env';
import {verticalProfile,textbackTemplateFor,type Vertical,type VerticalProfile} from './verticals';
import {renderTextback,esFollowupCard,esAgoText,resolveLanguage,type Language} from './i18n';
import {schedulingPolicySchema,type SchedulingPolicy} from './scheduling-policy';

/** Crew 3 proactive engine: detectors.
 * Pure time helpers + DB-backed detectors. Detectors never send anything;
 * they only record open detections, idempotent on (tenant_id, detector, dedupe_key).
 * Surfacing (notifications, cards, nudges) lives in proactive.ts. */

export type DetectorName='slow_day'|'lapsed_regular'|'unanswered_lead'|'no_show_risk'|'missed_call_followup';

export interface ProactiveContext{
 tenantId:string;
 nowMs:number;
 businessName:string;
 vertical:Vertical;
 timeZone:string;
 policy:SchedulingPolicy|null;
 /** Owner-chosen customer-facing language. Unset (e.g. older callers/tests) means English. */
 language:Language;
 /** Customer-facing register from the business profile. Unset (e.g. older
  * callers/tests) means the friendly default. */
 tone?:string;
}

export interface NewDetection{
 detector:DetectorName;
 dedupeKey:string;
 payload:Record<string,unknown>;
}

export interface DetectionRow{
 id:string;tenant_id:string;detector:DetectorName;detected_at:string;
 payload_json:string;state:string;dedupe_key:string;
}

/** Days without a booking after which a customer counts as lapsed, per vertical.
 * This table is the fallback source of truth for lapsed_regular: detectors read
 * the vertical profile's detectorParams first and fall back here — never a
 * second hardcoded copy. */
export const LAPSED_DAYS:Record<Vertical,number>={
 salon:56,restaurant:60,plumbing_hvac:180,dental:180,auto_repair:180,pet_grooming:70,med_spa:120,other:90,
};

/** Optional per-vertical detector tuning. Enriched on the vertical profile by the
 * crew4 vertical track; every field is optional. Detectors read these via
 * detectorParamsOf() and fall back to the hardcoded defaults when absent. */
export interface DetectorParams{
 lapsedRegularDays?:number;
 rebookingCycleDays?:number;
 slowDayMinGapMinutes?:number;
 unansweredLeadMinutes?:number;
 noShowLookbackDays?:number;
 afterHoursStart?:number;
 afterHoursEnd?:number;
}

/** Detector params for a vertical: the profile's detectorParams win when present,
 * otherwise an empty object so callers fall back to the per-detector defaults. */
export function detectorParamsOf(vertical:Vertical):DetectorParams{
 const p=verticalProfile(vertical) as VerticalProfile & {detectorParams?:DetectorParams};
 return p.detectorParams??{};
}

const WEEKDAY_NUM:Record<string,number>={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};

/** Local calendar parts for an instant in a business time zone. Pure. */
export function localParts(ms:number,timeZone:string){
 const dtf=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'});
 const parts=Object.fromEntries(dtf.formatToParts(ms).map(p=>[p.type,p.value]));
 return {date:`${parts.year}-${parts.month}-${parts.day}`,hour:Number(parts.hour),minute:Number(parts.minute),weekday:parts.weekday};
}

/** Human "x min ago" for card bodies. Pure. */
export function agoText(ms:number,nowMs:number){
 const mins=Math.max(1,Math.round((nowMs-ms)/60000));
 return mins<60?`${mins} min ago`:`${Math.round(mins/60)}h ago`;
}

/** Quiet hours: 21:00–08:00 business-local. Pure. */
export function inQuietHours(ms:number,timeZone:string){
 const {hour}=localParts(ms,timeZone);
 return hour>=21||hour<8;
}

/** Local YYYY-MM-DD day key for nudge counting. Pure. */
export function localDayKey(ms:number,timeZone:string){
 return localParts(ms,timeZone).date;
}

/** Shift a YYYY-MM-DD date by whole days. Pure. */
export function shiftLocalDate(date:string,days:number){
 const [y,m,d]=date.split('-').map(Number);
 const t=new Date(Date.UTC(y,m-1,d)+days*86400000);
 return `${t.getUTCFullYear()}-${String(t.getUTCMonth()+1).padStart(2,'0')}-${String(t.getUTCDate()).padStart(2,'0')}`;
}

/** Offset (local minus UTC) in ms for an instant, via the formatToParts trick. */
export function tzOffsetMs(timeZone:string,utcMs:number){
 const dtf=new Intl.DateTimeFormat('en-US',{timeZone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
 const parts=Object.fromEntries(dtf.formatToParts(utcMs).map(p=>[p.type,p.value]));
 return Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second)-utcMs;
}

/** UTC ISO bounds for a local YYYY-MM-DD day (DST-safe). Pure. */
export function localDayBoundsUtc(date:string,timeZone:string){
 const [y,m,d]=date.split('-').map(Number);
 const startLocal=Date.UTC(y,m-1,d),endLocal=startLocal+86400000;
 return {
  start:new Date(startLocal-tzOffsetMs(timeZone,startLocal)).toISOString(),
  end:new Date(endLocal-tzOffsetMs(timeZone,endLocal)).toISOString(),
 };
}

/** UTC ISO bounds for a local YYYY-MM month. Pure. */
export function monthBoundsUtc(year:number,month:number,timeZone:string){
 const startLocal=Date.UTC(year,month-1,1),endLocal=Date.UTC(year,month,1);
 return {
  start:new Date(startLocal-tzOffsetMs(timeZone,startLocal)).toISOString(),
  end:new Date(endLocal-tzOffsetMs(timeZone,endLocal)).toISOString(),
 };
}

export interface DayGap{start:string;end:string;minutes:number}
/** Gaps inside open periods given busy intervals. Pure. */
export function dayGaps(periods:{startMinute:number;endMinute:number}[],busy:{start:string;end:string}[],date:string,timeZone:string):DayGap[]{
 const dayStartMs=Date.parse(localDayBoundsUtc(date,timeZone).start);
 const open=periods.map(p=>({start:dayStartMs+p.startMinute*60000,end:dayStartMs+p.endMinute*60000}));
 const busyMs=busy.map(b=>({start:Date.parse(b.start),end:Date.parse(b.end)}))
  .filter(b=>Number.isFinite(b.start)&&Number.isFinite(b.end)&&b.end>b.start)
  .sort((a,b)=>a.start-b.start);
 const gaps:DayGap[]=[];
 for(const o of open){
  let cursor=o.start;
  for(const b of busyMs){
   if(b.end<=cursor||b.start>=o.end)continue;
   if(b.start>cursor)gaps.push({start:new Date(cursor).toISOString(),end:new Date(b.start).toISOString(),minutes:Math.round((b.start-cursor)/60000)});
   cursor=Math.max(cursor,b.end);
  }
  if(cursor<o.end)gaps.push({start:new Date(cursor).toISOString(),end:new Date(o.end).toISOString(),minutes:Math.round((o.end-cursor)/60000)});
 }
 return gaps;
}

/** Scheduled context reads the tenant profile directly — no user session exists. */
export async function loadProactiveContext(env:Env,tenantId:string,nowMs=Date.now()):Promise<ProactiveContext>{
 const mem=await env.AGENT_DB.prepare("SELECT value_json FROM mayor_memory WHERE tenant_id=? AND field='profile'").bind(tenantId).first<{value_json:string}>();
 const profile=mem?JSON.parse(mem.value_json) as {name?:string;vertical?:string;timeZone?:string;language?:unknown;tone?:string}:{ };
 const polRow=await env.AGENT_DB.prepare("SELECT value_json FROM mayor_memory WHERE tenant_id=? AND field='scheduling_policy'").bind(tenantId).first<{value_json:string}>();
 const policy=polRow?schedulingPolicySchema.parse(JSON.parse(polRow.value_json)):null;
 return {
  tenantId,nowMs,
  businessName:typeof profile.name==='string'&&profile.name.trim()?profile.name.trim():'your business',
  vertical:verticalProfile(profile.vertical).vertical,
  tone:typeof profile.tone==='string'?profile.tone:'friendly',
  timeZone:policy?.timeZone??(typeof profile.timeZone==='string'?profile.timeZone:'America/New_York'),
  policy,
  language:resolveLanguage(profile.language),
 };
}

export interface LapsedCustomer{id:string;name:string;phone:string;lastStart:string}
/** Customers with a phone whose most recent booking is older than the vertical's lapsed window.
 * Pass an explicit lapsedDays to override the vertical default (used by detectLapsedRegulars
 * after it resolves the profile's detectorParams). */
export async function lapsedCustomers(env:Env,tenantId:string,vertical:Vertical,nowMs:number,limit=25,lapsedDays?:number):Promise<LapsedCustomer[]>{
 const cutoff=new Date(nowMs-(lapsedDays??LAPSED_DAYS[vertical])*86400000).toISOString();
 const rows=await env.AGENT_DB.prepare(`SELECT c.id,c.name,c.phone,MAX(j.reserved_start) AS last_start
  FROM mayor_customers c
  JOIN mayor_appointment_customers ac ON ac.customer_id=c.id AND ac.tenant_id=c.tenant_id
  JOIN mayor_appointment_jobs j ON j.id=ac.booking_id AND j.tenant_id=c.tenant_id
  WHERE c.tenant_id=? AND c.phone IS NOT NULL
  GROUP BY c.id HAVING last_start<? ORDER BY last_start ASC LIMIT ?`)
  .bind(tenantId,cutoff,Math.min(limit,25)).all<{id:string;name:string;phone:string;last_start:string}>();
 return rows.results.map(r=>({id:r.id,name:r.name,phone:r.phone,lastStart:r.last_start}));
}

/** Missed calls with no text-back 15+ minutes after the miss (catches engine gaps). */
export async function detectMissedCallFollowup(env:Env,ctx:ProactiveContext):Promise<NewDetection[]>{
 const cutoff=new Date(ctx.nowMs-15*60000).toISOString();
 const rows=await env.AGENT_DB.prepare(`SELECT mc.id,mc.caller_number,mc.occurred_at FROM mayor_missed_calls mc
  WHERE mc.tenant_id=? AND mc.status='missed' AND mc.textback_sent_at IS NULL AND mc.occurred_at<=?
  AND NOT EXISTS(SELECT 1 FROM mayor_sms_log s WHERE s.tenant_id=mc.tenant_id AND s.direction='outbound'
   AND s.to_number=mc.caller_number AND s.created_at>=mc.occurred_at)`)
  .bind(ctx.tenantId,cutoff).all<{id:string;caller_number:string;occurred_at:string}>();
 return rows.results.map(r=>({detector:'missed_call_followup' as const,dedupeKey:`mc:${r.id}`,
  payload:{missedCallId:r.id,callerNumber:r.caller_number,occurredAt:r.occurred_at}}));
}

/** Tomorrow has a large open gap vs the scheduling policy's weekly hours.
 * The minimum gap comes from the vertical's detectorParams.slowDayMinGapMinutes (default 120). */
export async function detectSlowDay(env:Env,ctx:ProactiveContext):Promise<NewDetection[]>{
 if(!ctx.policy)return [];
 const minGapMinutes=detectorParamsOf(ctx.vertical).slowDayMinGapMinutes??120;
 const tomorrow=shiftLocalDate(localDayKey(ctx.nowMs,ctx.timeZone),1);
 const weekday=WEEKDAY_NUM[localParts(ctx.nowMs+86400000,ctx.timeZone).weekday]??-1;
 const periods=ctx.policy.weeklyHours.filter(p=>p.day===weekday);
 if(!periods.length)return [];
 const bounds=localDayBoundsUtc(tomorrow,ctx.timeZone);
 const rows=await env.AGENT_DB.prepare(`SELECT j.reserved_start,j.reserved_end FROM mayor_appointments a
  JOIN mayor_appointment_jobs j ON j.id=a.id
  WHERE a.tenant_id=? AND a.state='confirmed' AND j.reserved_start>=? AND j.reserved_start<?`)
  .bind(ctx.tenantId,bounds.start,bounds.end).all<{reserved_start:string;reserved_end:string}>();
 const gaps=dayGaps(periods,rows.results.map(r=>({start:r.reserved_start,end:r.reserved_end})),tomorrow,ctx.timeZone)
  .filter(g=>g.minutes>=minGapMinutes);
 if(!gaps.length)return [];
 return [{detector:'slow_day' as const,dedupeKey:`day:${tomorrow}`,
  payload:{date:tomorrow,gaps,maxGapMinutes:Math.max(...gaps.map(g=>g.minutes))}}];
}

/** Lapsed regulars per the vertical's rebooking window (detectorParams.lapsedRegularDays,
 * falling back to LAPSED_DAYS). When the vertical defines rebookingCycleDays, it is
 * included in the payload so downstream copy can name the expected cycle. One detection per day max. */
export async function detectLapsedRegulars(env:Env,ctx:ProactiveContext):Promise<NewDetection[]>{
 const params=detectorParamsOf(ctx.vertical);
 const lapsedDays=params.lapsedRegularDays??LAPSED_DAYS[ctx.vertical];
 const customers=await lapsedCustomers(env,ctx.tenantId,ctx.vertical,ctx.nowMs,25,lapsedDays);
 if(!customers.length)return [];
 return [{detector:'lapsed_regular' as const,dedupeKey:`day:${localDayKey(ctx.nowMs,ctx.timeZone)}`,
  payload:{cutoffDays:lapsedDays,count:customers.length,customers,
   ...(params.rebookingCycleDays!=null?{rebookingCycleDays:params.rebookingCycleDays}:{})}}];
}

/** Inbound SMS with no outbound reply within the vertical's window
 * (detectorParams.unansweredLeadMinutes, default 120). */
export async function detectUnansweredLeads(env:Env,ctx:ProactiveContext):Promise<NewDetection[]>{
 const unansweredMinutes=detectorParamsOf(ctx.vertical).unansweredLeadMinutes??120;
 const cutoff=new Date(ctx.nowMs-unansweredMinutes*60000).toISOString();
 const rows=await env.AGENT_DB.prepare(`SELECT s.id,s.from_number,s.body,s.created_at FROM mayor_sms_log s
  WHERE s.tenant_id=? AND s.direction='inbound' AND s.created_at<=?
  AND NOT EXISTS(SELECT 1 FROM mayor_sms_log o WHERE o.tenant_id=s.tenant_id AND o.direction='outbound'
   AND o.to_number=s.from_number AND o.created_at>s.created_at)
  LIMIT 10`).bind(ctx.tenantId,cutoff).all<{id:string;from_number:string;body:string;created_at:string}>();
 return rows.results.map(r=>({detector:'unanswered_lead' as const,dedupeKey:`sms:${r.id}`,
  payload:{smsId:r.id,fromNumber:r.from_number,body:r.body.slice(0,160),receivedAt:r.created_at}}));
}

/** Confirmed appointments in the upcoming window (detectorParams.noShowLookbackDays,
 * default 2) for customers with a recorded no-show and no reminder sent. no_show
 * events are recorded via recordNoShow (proactive.ts); until a flow marks
 * no-shows, this detector stays quiet — honestly. */
export async function detectNoShowRisk(env:Env,ctx:ProactiveContext):Promise<NewDetection[]>{
 const lookbackDays=detectorParamsOf(ctx.vertical).noShowLookbackDays??2;
 const start=new Date(ctx.nowMs).toISOString(),end=new Date(ctx.nowMs+lookbackDays*86400000).toISOString();
 const rows=await env.AGENT_DB.prepare(`SELECT j.id AS booking_id,j.reserved_start,ac.customer_id,c.name AS customer_name,c.phone AS customer_phone
  FROM mayor_appointments a
  JOIN mayor_appointment_jobs j ON j.id=a.id
  JOIN mayor_appointment_customers ac ON ac.booking_id=j.id AND ac.tenant_id=j.tenant_id
  JOIN mayor_customers c ON c.id=ac.customer_id AND c.tenant_id=j.tenant_id
  WHERE a.tenant_id=? AND a.state='confirmed' AND j.reserved_start>? AND j.reserved_start<=?
  AND c.phone IS NOT NULL
  AND EXISTS(SELECT 1 FROM mayor_roi_events e WHERE e.tenant_id=a.tenant_id AND e.kind='no_show'
   AND json_extract(e.meta_json,'$.customer_id')=ac.customer_id)
  AND NOT EXISTS(SELECT 1 FROM mayor_appointment_reminders r WHERE r.tenant_id=a.tenant_id
   AND r.booking_id=j.id AND r.reminder_sent_at IS NOT NULL)`)
  .bind(ctx.tenantId,start,end).all<{booking_id:string;reserved_start:string;customer_id:string;customer_name:string;customer_phone:string}>();
 return rows.results.map(r=>({detector:'no_show_risk' as const,dedupeKey:`booking:${r.booking_id}`,
  payload:{bookingId:r.booking_id,startsAt:r.reserved_start,customerId:r.customer_id,customerName:r.customer_name,customerPhone:r.customer_phone}}));
}

/** Run all detectors; insert open detections idempotently.
 * A detection is "new" only when no open/surfaced row exists for its dedupe key. */
export async function runDetectors(env:Env,tenantId:string,nowMs=Date.now()):Promise<{context:ProactiveContext;created:DetectionRow[]}>{
 const ctx=await loadProactiveContext(env,tenantId,nowMs);
 const found=(await Promise.all([
  detectMissedCallFollowup(env,ctx),
  detectSlowDay(env,ctx),
  detectLapsedRegulars(env,ctx),
  detectUnansweredLeads(env,ctx),
  detectNoShowRisk(env,ctx),
 ])).flat();
 const created:DetectionRow[]=[];
 const now=new Date(nowMs).toISOString();
 for(const d of found){
  const row=await env.AGENT_DB.prepare(`INSERT INTO mayor_proactive_detections(id,tenant_id,detector,detected_at,payload_json,state,dedupe_key)
   SELECT ?,?,?,?,?,'open',?
   WHERE NOT EXISTS(SELECT 1 FROM mayor_proactive_detections
    WHERE tenant_id=? AND detector=? AND dedupe_key=? AND state IN ('open','surfaced'))
   RETURNING *`).bind(crypto.randomUUID(),tenantId,d.detector,now,JSON.stringify(d.payload),d.dedupeKey,
   tenantId,d.detector,d.dedupeKey).first<DetectionRow>();
  if(row)created.push(row);
 }
 return {context:ctx,created};
}

/* ---------------- record-time follow-up cards ---------------- */

export interface FollowupCardCopy{
 title:string;body:string;
 draft:{message:string;audience:string;audienceCount:number;
  recipients:{name:string;phone:string}[];meta:Record<string,string>};
}

/** Card copy for a missed call that never got a text-back. Shared by the
 * record-time path below and proactive.ts's detector-driven card builder,
 * so both produce the identical prepared action. */
export function buildFollowupCardCopy(
 ctx:ProactiveContext,
 payload:{missedCallId:string;callerNumber:string;occurredAt:string},
):FollowupCardCopy{
 const v=verticalProfile(ctx.vertical);
 if(ctx.language==='es'){
  const copy=esFollowupCard(payload.callerNumber,esAgoText(Date.parse(payload.occurredAt),ctx.nowMs));
  return {
   title:copy.title,
   body:copy.body,
   draft:{message:renderTextback(ctx.vertical,'es',ctx.businessName),
    audience:'llamada perdida',audienceCount:1,
    recipients:[{name:'',phone:payload.callerNumber}],meta:{missedCallId:payload.missedCallId}},
  };
 }
 return {
  title:'Missed call needs a text-back',
  body:`A call from ${payload.callerNumber} ${agoText(Date.parse(payload.occurredAt),ctx.nowMs)} never got a text-back — send it now?`,
  draft:{message:textbackTemplateFor(v,ctx.tone).replace('{business}',ctx.businessName),
   audience:'missed caller',audienceCount:1,
   recipients:[{name:'',phone:payload.callerNumber}],meta:{missedCallId:payload.missedCallId}},
 };
}

/** Create the missed-call follow-up suggestion card the moment the call is
 * recorded — the missed call IS the nudge, so the owner gets a prepared
 * [Send] [Edit] [Dismiss] action immediately instead of waiting up to 20
 * minutes for the 15-minute backstop detector. Idempotent per missed call:
 * never duplicates an existing card and never recreates one the owner
 * already decided (sent/dismissed). */
export async function ensureMissedCallFollowupCard(
 env:Env,ctx:ProactiveContext,
 call:{id:string;callerNumber:string;occurredAt:string},
):Promise<{cardId:string;created:boolean}>{
 const dedupeKey=`mc:${call.id}`;
 const prior=await env.AGENT_DB.prepare(
  `SELECT c.id FROM mayor_suggestion_cards c
   JOIN mayor_proactive_detections d ON d.id=c.detection_id
   WHERE d.tenant_id=? AND d.detector='missed_call_followup' AND d.dedupe_key=? LIMIT 1`)
  .bind(ctx.tenantId,dedupeKey).first<{id:string}>();
 if(prior)return {cardId:prior.id,created:false};
 const now=new Date(ctx.nowMs).toISOString();
 const detection=await env.AGENT_DB.prepare(
  `INSERT INTO mayor_proactive_detections(id,tenant_id,detector,detected_at,payload_json,state,dedupe_key)
   SELECT ?,?,?,?,?,'open',?
   WHERE NOT EXISTS(SELECT 1 FROM mayor_proactive_detections
    WHERE tenant_id=? AND detector='missed_call_followup' AND dedupe_key=? AND state IN ('open','surfaced'))
   RETURNING *`).bind(
   crypto.randomUUID(),ctx.tenantId,'missed_call_followup',now,
   JSON.stringify({missedCallId:call.id,callerNumber:call.callerNumber,occurredAt:call.occurredAt}),
   dedupeKey,ctx.tenantId,dedupeKey).first<DetectionRow>();
 if(!detection)return {cardId:'',created:false};
 const copy=buildFollowupCardCopy(ctx,{missedCallId:call.id,callerNumber:call.callerNumber,occurredAt:call.occurredAt});
 const cardId=crypto.randomUUID();
 await env.AGENT_DB.prepare(
  `INSERT INTO mayor_suggestion_cards(id,tenant_id,detection_id,kind,title,body,draft_json,state,created_at)
   VALUES(?,?,?,?,?,?,?,'pending',?)`)
  .bind(cardId,ctx.tenantId,detection.id,'followup',copy.title,copy.body,JSON.stringify(copy.draft),now).run();
 return {cardId,created:true};
}

/** Mark pending follow-up cards for a missed call as sent once a text-back
 * goes out through ANY path (card Send, manual text-back, instant engine),
 * so a handled call never leaves a stale suggestion behind. */
export async function resolveMissedCallFollowupCards(env:Env,tenantId:string,missedCallId:string){
 const now=new Date().toISOString(),dedupeKey=`mc:${missedCallId}`;
 await env.AGENT_DB.batch([
  env.AGENT_DB.prepare(
   `UPDATE mayor_suggestion_cards SET state='sent',decided_at=?,
    result_json=json_object('resolved_by','textback_sent')
    WHERE tenant_id=? AND state IN ('pending','edited') AND detection_id IN
    (SELECT id FROM mayor_proactive_detections
     WHERE tenant_id=? AND detector='missed_call_followup' AND dedupe_key=?)`)
   .bind(now,tenantId,tenantId,dedupeKey),
  env.AGENT_DB.prepare(
   `UPDATE mayor_proactive_detections SET state='resolved'
    WHERE tenant_id=? AND detector='missed_call_followup' AND dedupe_key=? AND state IN ('open','surfaced')`)
   .bind(tenantId,dedupeKey),
 ]);
}
