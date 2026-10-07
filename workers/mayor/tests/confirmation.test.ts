import {it,expect} from 'vitest';
import {confirmationStream,guardedSpeech,profileReadback,policyReadback,bookingReadback,changeReadback} from '../src/confirmation';
import type {SchedulingPolicy} from '../src/scheduling-policy';

it('streams ordinary speech but uses server readback once a proposal exists',async()=>{
 let readback:string|undefined,armed=false,cleared=false;const output:string[]=[];
 async function* model(){yield 'Let me check. ';readback='Exact proposed details. Say yes to confirm.';yield 'Incorrect model summary';}
 for await(const text of confirmationStream(model(),()=>readback,()=>true,()=>{armed=true;},()=>{cleared=true;}))output.push(text);
 expect(output).toEqual(['Let me check. ','Exact proposed details. Say yes to confirm.']);expect(armed).toBe(true);expect(cleared).toBe(false);
});
it('never arms a proposal after a failed or interrupted stream',async()=>{
 let armed=false,cleared=false;
 async function* failed(){yield 'One moment';throw new Error('model failure');}
 await expect((async()=>{for await(const _ of confirmationStream(failed(),()=> 'readback',()=>true,()=>{armed=true;},()=>{cleared=true;})){} })()).rejects.toThrow('model failure');
 expect(armed).toBe(false);expect(cleared).toBe(true);
 let valid=true;cleared=false;
 async function* interrupted(){yield 'One moment';valid=false;yield 'late model response';}
 for await(const _ of confirmationStream(interrupted(),()=> 'readback',()=>valid,()=>{armed=true;},()=>{cleared=true;})){}
 expect(armed).toBe(false);expect(cleared).toBe(true);
});
it('does not arm when the consumer stops or interrupts during the exact readback',async()=>{
 let valid=true,armed=false,cleared=false;
 async function* model(){}
 const stream=confirmationStream(model(),()=> 'Exact details',()=>valid,()=>{armed=true;},()=>{cleared=true;});
 expect((await stream.next()).value).toBe('Exact details');expect(armed).toBe(false);
 valid=false;await stream.next();expect(armed).toBe(false);expect(cleared).toBe(true);
 cleared=false;valid=true;
 const stopped=confirmationStream(model(),()=> 'Exact details',()=>valid,()=>{armed=true;},()=>{cleared=true;});
 await stopped.next();await stopped.return();expect(armed).toBe(false);expect(cleared).toBe(true);
});
it('invalidates confirmation when speech synthesis throws or yields no audio',async()=>{
 let invalidated=0;
 const broken=guardedSpeech({synthesize:async()=>{throw new Error('TTS unavailable');}},()=>{invalidated++;});
 await expect(broken.synthesize('Readback')).rejects.toThrow();expect(invalidated).toBe(1);
 const silent=guardedSpeech({synthesize:async()=>null},()=>{invalidated++;});
 expect(await silent.synthesize('Readback')).toBeNull();expect(invalidated).toBe(2);
 const working=guardedSpeech({synthesize:async()=>new ArrayBuffer(10)},()=>{invalidated++;});
 expect((await working.synthesize('Readback'))?.byteLength).toBe(10);expect(invalidated).toBe(2);
});
it('reads profile sources and all changed scheduling parameters without silently truncating',()=>{
 expect(profileReadback({services:['consulting'],hours:'Monday 9 to 5'},'https://business.com/about')).toContain('From business.com');
 const policy:SchedulingPolicy={timeZone:'America/New_York',weeklyHours:[{day:1,startMinute:540,endMinute:1020}],closedDates:[],appointmentTypes:[{name:'Visit',durationMinutes:30,bufferBeforeMinutes:5,bufferAfterMinutes:10}],staff:[],minimumNoticeMinutes:60,maximumAdvanceDays:30,cancellationNoticeMinutes:120};
 const text=policyReadback(policy,null);
 for(const detail of ['America/New_York','Monday 09:00 to 17:00','30 minutes','5 minutes before','10 minutes after','60 minutes','30 days','120 minutes','staff none'])expect(text).toContain(detail);
 const changed=policyReadback({...policy,cancellationNoticeMinutes:180},policy);expect(changed).toContain('180 minutes');expect(changed).toContain('All other rules stay');expect(changed).not.toContain('Monday');
});
it('reads both old and new appointment dates, invitees, staff, and timezone',()=>{
 const input={title:'Consultation',appointmentType:'Visit',staff:'Alex',start:'2026-10-05T13:00:00Z',end:'2026-10-05T13:30:00Z',attendees:['customer@example.com']};
 const booking=bookingReadback({input,calendarName:'Appointments',timeZone:'America/New_York'});
 for(const detail of ['Consultation','Visit','Alex','October 5','9:00:00','9:30:00','customer@example.com','Appointments','America/New_York'])expect(booking).toContain(detail);
 const changed=changeReadback({kind:'reschedule',before:input,after:{...input,start:'2026-10-06T13:00:00Z',end:'2026-10-06T13:30:00Z'},timeZone:'America/New_York'});
 expect(changed).toContain('October 5');expect(changed).toContain('October 6');expect(changed).toContain('Say yes to reschedule');
 expect(changeReadback({kind:'cancel',before:input,after:input,timeZone:'America/New_York'})).toContain('Say yes to cancel');
});
