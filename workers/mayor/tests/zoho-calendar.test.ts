import {describe,it,expect,vi} from 'vitest';
import {ZohoCalendarClient,zohoInstant} from '../src/connectors/zoho-calendar';
import {zohoEndpoints} from '../src/auth/zoho-region';
const requestId='12345678-1234-4123-8123-123456789abc';
const input={start:'2026-10-05T14:00:00Z',end:'2026-10-05T14:30:00Z',timeZone:'America/New_York',title:'Consultation',attendees:['guest@example.test'],requestId};
const raw=(override={})=>({uid:'event@zoho.com',caluid:'calendar',etag:'123456789',title:input.title,description:'The Mayor booking reference: '+requestId,role:'organizer',organizer:'owner@example.test',isallday:false,transparency:0,dateandtime:{start:'20261005T100000-0400',end:'20261005T103000-0400',timezone:input.timeZone},attendees:[{email:'guest@example.test',privilege:1},{email:'owner@example.test',privilege:4}],...override});
const auth={accessToken:'synthetic',accountEmail:'owner@example.test',zohoRegion:'us',grantedScopes:['ZohoCalendar.calendar.READ','ZohoCalendar.event.ALL']};
describe('Zoho calendar protocol',()=>{
 it('uses Canada’s documented zohocloud domain',()=>{expect(zohoEndpoints('ca')).toEqual({region:'ca',accounts:'https://accounts.zohocloud.ca',calendar:'https://calendar.zohocloud.ca/api/v1/'});});
 it('uses regional endpoints, native authorization, and validates writable calendars',async()=>{
  const fetcher=vi.fn(async(url:any,init:any)=>{expect(String(url)).toBe('https://calendar.zoho.eu/api/v1/calendars?category=own&showhiddencal=true');expect(init.redirect).toBe('manual');expect(init.headers.authorization).toBe('Zoho-oauthtoken synthetic');return Response.json({calendars:[{uid:'calendar',name:'Appointments',timezone:'Europe/Paris',privilege:'owner'}]});});
  expect((await new ZohoCalendarClient({...auth,zohoRegion:'eu'},{fetch:fetcher as any}).listCalendars()).items[0].canWrite).toBe(true);
  expect(()=>new ZohoCalendarClient({...auth,zohoRegion:'evil.example'})).toThrow();
 });
 it('normalizes explicit offsets and refuses ambiguous local times',()=>{
  expect(Date.parse(zohoInstant('20261005T100000-0400'))).toBe(Date.parse(input.start));
  expect(()=>zohoInstant('20261005T100000')).toThrow();
 });
 it('writes form-encoded event data and verifies the returned appointment',async()=>{
  const fetcher=vi.fn(async(url:any,init:any)=>{expect(String(url)).not.toContain('guest');expect(init.method).toBe('POST');const data=JSON.parse(new URLSearchParams(init.body).get('eventdata')!);expect(data.dateandtime.start).toBe('20261005T140000Z');expect(data.notify_attendee).toBe(1);return Response.json({events:[raw()]});});
  const receipt=await new ZohoCalendarClient(auth,{fetch:fetcher as any}).createAppointment('calendar',input);
  expect(receipt).toMatchObject({provider:'zoho',id:'event@zoho.com',requestId,state:'applied'});expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('refuses mismatched write receipts and never retries writes',async()=>{
  const fetcher=vi.fn(async()=>Response.json({events:[raw({title:'Different'})]}));
  await expect(new ZohoCalendarClient(auth,{fetch:fetcher as any}).createAppointment('calendar',input)).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('blocks all-day events and expands recurrence queries',async()=>{
  const fetcher=vi.fn(async(url:any)=>{const target=new URL(url);expect(target.searchParams.get('byinstance')).toBe('true');return Response.json({events:[raw({isallday:true,dateandtime:{start:'20261005',end:'20261006'}})]});});
  const result=await new ZohoCalendarClient(auth,{fetch:fetcher as any}).listAvailability('calendar',input);
  expect(result.busy).toEqual([{id:'event@zoho.com',start:input.start,end:input.end}]);
 });
 it('rejects missing availability data instead of declaring the calendar free',async()=>{
  const client=new ZohoCalendarClient(auth,{fetch:async()=>Response.json({error:{code:'INVALID_TOKEN'}})});
  await expect(client.listAvailability('calendar',input)).rejects.toThrow();
 });
 it('reschedules only a verified single event with the native etag and availability check',async()=>{
  let reads=0;
  const fetcher=vi.fn(async(url:any,init:any)=>{
   if(init.method==='PUT'){expect(init.headers.etag).toBe('123456789');const data=JSON.parse(new URLSearchParams(init.body).get('eventdata')!);expect(data.etag).toBe('123456789');expect(data.title).toBeUndefined();return Response.json({events:[raw()]});}
   reads++;return Response.json({events:String(url).includes('?')?[]:[raw()]});
  });
  expect((await new ZohoCalendarClient(auth,{fetch:fetcher as any}).rescheduleAppointment('calendar','event@zoho.com','123456789',input)).state).toBe('applied');expect(reads).toBe(2);
 });
 it('refuses recurring event cancellation before dispatch',async()=>{
  const fetcher=vi.fn(async()=>Response.json({events:[raw({rrule:'FREQ=DAILY'})]}));
  await expect(new ZohoCalendarClient(auth,{fetch:fetcher as any}).cancelAppointment('calendar','event@zoho.com','123456789','UTC')).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('accepts only a matching deletion receipt',async()=>{
  const fetcher=vi.fn(async(_url:any,init:any)=>Response.json({events:init.method==='DELETE'?[{uid:'event@zoho.com',caluid:'calendar',estatus:'deleted'}]:[raw()]}));
  expect((await new ZohoCalendarClient(auth,{fetch:fetcher as any}).cancelAppointment('calendar','event@zoho.com','123456789','UTC')).state).toBe('applied');
 });
 it('reconciles creation only with one exact booking reference',async()=>{
  const fetcher=vi.fn(async()=>Response.json({events:[raw(),raw({uid:'other',description:'Other booking'})]}));
  expect((await new ZohoCalendarClient(auth,{fetch:fetcher as any}).findCreatedAppointment('calendar',requestId,input)).id).toBe('event@zoho.com');
  await expect(new ZohoCalendarClient(auth,{fetch:async()=>Response.json({events:[raw(),raw({uid:'duplicate'})]})}).findCreatedAppointment('calendar',requestId,input)).rejects.toThrow();
 });
});
