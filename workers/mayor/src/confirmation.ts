import type {Profile} from './memory';
import type {SchedulingPolicy} from './scheduling-policy';

export function guardedSpeech(provider:{synthesize(text:string,signal?:AbortSignal):Promise<ArrayBuffer|null>},invalidate:()=>void){
 return {async synthesize(text:string,signal?:AbortSignal){
  try{const audio=await provider.synthesize(text,signal);if(!audio?.byteLength)invalidate();return audio;}
  catch(error){invalidate();throw error;}
 }};
}

const label=(value:string)=>value.replace(/([A-Z])/g,' $1').toLowerCase();
const list=(values:string[])=>values.length?values.join('; '):'none';
const clock=(minute:number)=>`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const hours=(periods:SchedulingPolicy['weeklyHours'])=>list(periods.map(p=>`${days[p.day]} ${clock(p.startMinute)} to ${clock(p.endMinute)}`));
export function profileReadback(patch:Profile,sourceUrl?:string){
 return `${sourceUrl?`From ${new URL(sourceUrl).hostname}, please verify: `:'Please verify: '}${Object.entries(patch).map(([key,value])=>`${label(key)}: ${Array.isArray(value)?list(value):value}`).join('. ')}. Say “yes, that is correct” to save these business details, or tell me what to correct.`;
}
export function policyReadback(policy:SchedulingPolicy,previous:SchedulingPolicy|null){
 const details:Record<keyof SchedulingPolicy,string>={
  timeZone:`time zone ${policy.timeZone}`,
  weeklyHours:`business hours ${hours(policy.weeklyHours)}`,
  closedDates:`closed dates ${list(policy.closedDates)}`,
  appointmentTypes:`appointment types ${list(policy.appointmentTypes.map(t=>`${t.name}, ${t.durationMinutes} minutes, buffer ${t.bufferBeforeMinutes} minutes before and ${t.bufferAfterMinutes} minutes after`))}`,
  staff:`staff ${list(policy.staff.map(s=>`${s.name}, appointments ${list(s.appointmentTypes)}, hours ${hours(s.weeklyHours)}`))}`,
  minimumNoticeMinutes:`minimum booking notice ${policy.minimumNoticeMinutes} minutes`,
  maximumAdvanceDays:`book up to ${policy.maximumAdvanceDays} days ahead`,
  cancellationNoticeMinutes:`cancellation notice ${policy.cancellationNoticeMinutes} minutes`,
 };
 const changed=(Object.keys(details) as (keyof SchedulingPolicy)[]).filter(key=>!previous||JSON.stringify(policy[key])!==JSON.stringify(previous[key]));
 return `Please verify these scheduling ${previous?'changes':'rules'}: ${changed.map(key=>details[key]).join('. ')||'no changes'}. ${previous?'All other rules stay as confirmed. ':''}Say yes to save, or tell me what to correct.`;
}
type Appointment={title:string;appointmentType:string;staff?:string;start:string;end:string;attendees:string[]};
function when(instant:string,zone:string){return new Intl.DateTimeFormat('en-US',{timeZone:zone,dateStyle:'full',timeStyle:'long'}).format(new Date(instant));}
function appointmentDetails(input:Appointment,zone:string){
 return `${input.title}, type ${input.appointmentType}${input.staff?`, with ${input.staff}`:''}, from ${when(input.start,zone)} to ${when(input.end,zone)}, time zone ${zone}. Invitees: ${list(input.attendees)}`;
}
type CustomerContact={name:string;email:string|null;phone:string|null};
function customerDetails(customer?:CustomerContact|null){return customer?` Linked customer: ${customer.name}. Email: ${customer.email??'not provided'}. Phone: ${customer.phone??'not provided'}. Linking this record does not add an invitee.`:'';}
export function bookingReadback(proposal:{input:Appointment;calendarName:string;timeZone:string;customer?:CustomerContact|null}){
 return `Please confirm booking ${appointmentDetails(proposal.input,proposal.timeZone)}. Calendar: ${proposal.calendarName}.${customerDetails(proposal.customer)} Say yes to book, or tell me what to correct.`;
}
export function changeReadback(proposal:{kind:string;before:Appointment;after:Appointment;timeZone:string;customer?:CustomerContact|null}){
 return proposal.kind==='cancel'?`Please confirm cancelling ${appointmentDetails(proposal.before,proposal.timeZone)}.${customerDetails(proposal.customer)} Say yes to cancel, or tell me what to correct.`:
  `Please confirm rescheduling ${appointmentDetails(proposal.before,proposal.timeZone)}. New time: ${when(proposal.after.start,proposal.timeZone)} to ${when(proposal.after.end,proposal.timeZone)}.${customerDetails(proposal.customer)} Say yes to reschedule, or tell me what to correct.`;
}

/** Keep normal speech streaming, but supply proposal readback from server-held data.
 * A failed/aborted stream must never arm a confirmation.
 */
export async function* confirmationStream(input:AsyncIterable<string>,readback:()=>string|undefined,valid:()=>boolean,arm:()=>void,clear:()=>void){
 let completed=false;
 try{
  for await(const text of input){if(!valid())return;if(!readback())yield text;}
  if(!valid())return;
  const exact=readback();
  if(exact){yield exact;if(!valid())return;arm();}
  completed=true;
 }finally{if(!completed)clear();}
}
