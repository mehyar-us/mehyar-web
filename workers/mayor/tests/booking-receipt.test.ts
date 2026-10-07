import {describe,it,expect} from 'vitest';
import {bookingReceipt} from '../src/connectors/booking-receipt';
const input={title:'Consultation',start:'2026-10-01T13:00:00Z',end:'2026-10-01T13:30:00Z',timeZone:'America/New_York',requestId:'request-1',attendees:['guest@example.test']};
describe('provider booking confirmation',()=>{
 it('requires Google to return the intended event, times, title and recipients',()=>{
  const event={id:'expected',etag:'etag',summary:input.title,status:'confirmed',start:{dateTime:input.start},end:{dateTime:input.end},attendees:[{email:'GUEST@example.test'}]};
  expect(bookingReceipt('google',event,'calendar',input,'expected').state).toBe('applied');
  for(const change of [{id:'other'},{etag:''},{summary:'Different'},{status:'cancelled'},{start:{dateTime:input.end}},{attendees:[]},{attendees:[{email:'other@example.test'}]}])expect(()=>bookingReceipt('google',{...event,...change},'calendar',input,'expected')).toThrow();
 });
 it('requires Microsoft transaction identity and UTC response times',()=>{
  const event={id:'event',transactionId:input.requestId,'@odata.etag':'etag',subject:input.title,isCancelled:false,start:{dateTime:input.start.replace('Z',''),timeZone:'UTC'},end:{dateTime:input.end.replace('Z',''),timeZone:'UTC'},attendees:[{emailAddress:{address:input.attendees[0]}}]};
  expect(bookingReceipt('microsoft',event,'calendar',input).state).toBe('applied');
  for(const change of [{transactionId:'different'},{transactionId:undefined},{isCancelled:true},{subject:'Different'},{start:{dateTime:input.start,timeZone:'Eastern Standard Time'}},{attendees:[]}])expect(()=>bookingReceipt('microsoft',{...event,...change},'calendar',input)).toThrow();
 });
});
