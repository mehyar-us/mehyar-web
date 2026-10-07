import {z} from 'zod';
import {zohoEndpoints} from '../auth/zoho-region';
import {ProviderHTTP,appointmentInput,query,segment,windowInput,requireEtag} from './http';
import {ConnectorError,type ConnectorAuth,type ClientOptions,type Operation,type Calendar,type Page,type TimeWindow,type AppointmentInput,type AppointmentReceipt} from './types';
import {bookingReceipt} from './booking-receipt';
import {requireReschedulable,rescheduleInput,rescheduleReceipt,type RescheduleInput} from './reschedule';
import {requireRescheduleAvailability} from './reschedule-availability';
const read=['ZohoCalendar.event.READ','ZohoCalendar.event.ALL'],write=['ZohoCalendar.event.ALL'];
export const ZOHO_CALENDAR_OPERATIONS={
 list:{name:'zoho.calendar.list',effect:'read',scopes:[['ZohoCalendar.calendar.READ','ZohoCalendar.calendar.ALL']]},
 read:{name:'zoho.calendar.read',effect:'read',scopes:[read]},
 availability:{name:'zoho.calendar.availability',effect:'read',scopes:[read]},
 create:{name:'zoho.calendar.create',effect:'write',scopes:[write]},
 update:{name:'zoho.calendar.update',effect:'write',scopes:[write]},
 cancel:{name:'zoho.calendar.cancel',effect:'write',scopes:[write]},
} as const satisfies Record<string,Operation>;
const fail=(effect:'read'|'write'='read')=>new ConnectorError(effect==='read'?'invalid_response':'ambiguous_write','zoho.calendar');
const basic=(value:string)=>new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
export function zohoInstant(value:string){
 const match=/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z|[+-]\d{4})$/.exec(value);
 if(!match)throw fail();
 const offset=match[7]==='Z'?'Z':match[7].slice(0,3)+':'+match[7].slice(3);
 const result=`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${offset}`;
 if(!Number.isFinite(Date.parse(result)))throw fail();return result;
}
const eventSchema=z.object({uid:z.string().min(1),caluid:z.string().optional(),etag:z.union([z.string(),z.number().int()]).optional(),
 title:z.string().optional(),description:z.string().optional(),estatus:z.string().optional(),role:z.string().optional(),isallday:z.boolean().optional(),
 organizer:z.string().optional(),attendees:z.array(z.object({email:z.string(),privilege:z.number().optional()})).optional(),
 dateandtime:z.object({start:z.string(),end:z.string(),timezone:z.string().optional()}).optional(),
 rrule:z.string().optional(),repeat:z.array(z.unknown()).optional(),recurrenceid:z.union([z.string(),z.number()]).optional(),transparency:z.number().optional()});
/** Normalized to the existing strict timed-event contract; provider metadata stays untrusted. */
function normalized(raw:unknown,calendarId:string){
 const item=eventSchema.parse(raw);if(item.caluid&&item.caluid!==calendarId)throw fail();
 if(item.estatus==='deleted')return {id:item.uid,status:'cancelled',etag:String(item.etag??'')};
 if(!item.dateandtime||item.isallday===undefined||!item.etag)throw fail();
 const time=(value:string)=>item.isallday?{date:value.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3')}:{dateTime:zohoInstant(value),timeZone:item.dateandtime!.timezone};
 return {id:item.uid,etag:String(item.etag),status:'confirmed',summary:item.title,
  organizer:{self:item.role==='organizer'},eventType:'default',start:time(item.dateandtime.start),end:time(item.dateandtime.end),
  ...(item.rrule||item.repeat?.length?{recurrence:[item.rrule??'recurring']}:{}),...(item.recurrenceid!==undefined?{recurringEventId:String(item.recurrenceid)}:{}),
  attendees:(item.attendees??[]).filter(a=>!(a.privilege===4&&a.email.toLowerCase()===item.organizer?.toLowerCase())).map(a=>({email:a.email})),
  mayorRequestId:item.description?.match(/(?:^|\n)The Mayor booking reference: ([0-9a-f-]{36})(?:\n|$)/)?.[1],transparency:item.transparency===1?'transparent':'opaque'};
}
function events(raw:unknown){return z.object({events:z.array(eventSchema).max(5000)}).parse(raw).events;}
export class ZohoCalendarClient{
 private readonly http:ProviderHTTP;
 constructor(auth:ConnectorAuth,options?:ClientOptions){this.http=new ProviderHTTP(auth,zohoEndpoints(auth.zohoRegion).calendar,options,'Zoho-oauthtoken');}
 async listCalendars(cursor?:string):Promise<Page<Calendar>>{
  if(cursor)throw new ConnectorError('invalid_input','zoho.calendar.cursor');
  const raw=await this.http.request<unknown>(ZOHO_CALENDAR_OPERATIONS.list,'calendars?category=own&showhiddencal=true');
  const parsed=z.object({calendars:z.array(z.object({uid:z.string().min(1),name:z.string(),timezone:z.string().optional(),privilege:z.string()})).max(1000)}).parse(raw);
  return {items:parsed.calendars.map(c=>({id:c.uid,name:c.name,timeZone:c.timezone,canWrite:c.privilege==='owner'}))};
 }
 async readAppointment(calendarId:string,eventId:string){
  const rows=events(await this.http.request(ZOHO_CALENDAR_OPERATIONS.read,`calendars/${segment(calendarId)}/events/${segment(eventId)}`));
  if(rows.length!==1||rows[0].uid!==eventId)throw fail();return normalized(rows[0],calendarId);
 }
 private async ranged(calendarId:string,window:TimeWindow){
  windowInput(window);if(Date.parse(window.end)-Date.parse(window.start)>31*86400000)throw new ConnectorError('invalid_input','zoho.calendar.range');
  return events(await this.http.request(ZOHO_CALENDAR_OPERATIONS.read,query(`calendars/${segment(calendarId)}/events`,{range:JSON.stringify({start:basic(window.start),end:basic(window.end)}),byinstance:'true',timezone:'UTC'})));
 }
 async listBusyAppointments(calendarId:string,window:TimeWindow,cursor?:string){
  if(cursor)throw new ConnectorError('invalid_input','zoho.calendar.cursor');
  const rows=await this.ranged(calendarId,window);
  return {items:rows.filter(e=>e.estatus!=='deleted'&&e.transparency!==1).map(e=>{
   if(!e.dateandtime||e.isallday===undefined)throw fail();
   const start=e.isallday?window.start:zohoInstant(e.dateandtime.start),end=e.isallday?window.end:zohoInstant(e.dateandtime.end);
   if(Date.parse(end)<=Date.parse(start))throw fail();return {id:e.uid,start,end};
  })};
 }
 async listAvailability(calendarId:string,window:TimeWindow,cursor?:string){return {busy:(await this.listBusyAppointments(calendarId,window,cursor)).items,complete:true,nextCursor:undefined};}
 private async write(operation:Operation,path:string,data:unknown,etag?:string){
  return this.http.request<unknown>(operation,path,{method:operation===ZOHO_CALENDAR_OPERATIONS.create?'POST':'PUT',
   headers:{'content-type':'application/x-www-form-urlencoded',...(etag?{etag:requireEtag(etag)}:{})},raw:new URLSearchParams({eventdata:JSON.stringify(data)}).toString()});
 }
 async createAppointment(calendarId:string,input:AppointmentInput):Promise<AppointmentReceipt>{
  appointmentInput(input);
  const description=(input.description?input.description+'\n\n':'')+'The Mayor booking reference: '+input.requestId;
  if(description.length>10000)throw new ConnectorError('invalid_input','zoho.calendar.description');
  const rows=events(await this.write(ZOHO_CALENDAR_OPERATIONS.create,`calendars/${segment(calendarId)}/events`,{
   title:input.title,description,isallday:false,dateandtime:{start:basic(input.start),end:basic(input.end),timezone:input.timeZone},
   attendees:input.attendees.map(email=>({email,permission:1})),notify_attendee:1}));
  if(rows.length!==1)throw fail('write');
  return bookingReceipt('zoho',normalized(rows[0],calendarId),calendarId,input);
 }
 async findCreatedAppointment(calendarId:string,requestId:string,window:TimeWindow){
  const matches=(await this.ranged(calendarId,window)).map(e=>normalized(e,calendarId)).filter(e=>'mayorRequestId' in e&&e.mayorRequestId===requestId);
  if(matches.length!==1)throw fail();return matches[0];
 }
 async rescheduleAppointment(calendarId:string,eventId:string,etag:string,input:RescheduleInput):Promise<AppointmentReceipt>{
  this.http.authorize(ZOHO_CALENDAR_OPERATIONS.update);rescheduleInput(input,etag);
  requireReschedulable('zoho',await this.readAppointment(calendarId,eventId),eventId,etag);
  await requireRescheduleAvailability(this,calendarId,eventId,input);
  const rows=events(await this.write(ZOHO_CALENDAR_OPERATIONS.update,`calendars/${segment(calendarId)}/events/${segment(eventId)}`,
   {uid:eventId,etag,dateandtime:{start:basic(input.start),end:basic(input.end),timezone:input.timeZone},notify_attendee:1},etag));
  if(rows.length!==1)throw fail('write');return rescheduleReceipt('zoho',normalized(rows[0],calendarId),calendarId,eventId,input);
 }
 async cancelAppointment(calendarId:string,eventId:string,etag:string,timeZone:string):Promise<AppointmentReceipt>{
  this.http.authorize(ZOHO_CALENDAR_OPERATIONS.cancel);
  requireReschedulable('zoho',await this.readAppointment(calendarId,eventId),eventId,etag);
  const rows=events(await this.http.request(ZOHO_CALENDAR_OPERATIONS.cancel,`calendars/${segment(calendarId)}/events/${segment(eventId)}`,{method:'DELETE',headers:{etag:requireEtag(etag)}}));
  if(rows.length!==1||rows[0].uid!==eventId||rows[0].estatus!=='deleted'||rows[0].caluid!==calendarId)throw fail('write');
  return {provider:'zoho',id:eventId,calendarId,etag,timeZone,state:'applied'};
 }
}
