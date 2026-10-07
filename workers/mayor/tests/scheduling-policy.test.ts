import {describe,it,expect} from 'vitest';
import {schedulingPolicySchema,validateSlot,validateCancellation,type SchedulingPolicy} from '../src/scheduling-policy';
const policy:SchedulingPolicy={timeZone:'America/New_York',weeklyHours:[{day:1,startMinute:540,endMinute:1020}],closedDates:[],appointmentTypes:[{name:'Consultation',durationMinutes:30,bufferBeforeMinutes:15,bufferAfterMinutes:15}],staff:[],minimumNoticeMinutes:60,maximumAdvanceDays:60,cancellationNoticeMinutes:1440};
const now=Date.parse('2026-09-20T12:00:00Z');
const slot={start:'2026-09-21T13:15:00Z',end:'2026-09-21T13:45:00Z',appointmentType:'Consultation'};
describe('server-enforced scheduling policy',()=>{
 it('reserves buffers around an eligible slot in business-local hours',()=>{
  expect(validateSlot(policy,slot,now)).toEqual({start:'2026-09-21T13:00:00.000Z',end:'2026-09-21T14:00:00.000Z',timeZone:'America/New_York'});
 });
 it('rejects outside hours, incorrect duration, ambiguous times and closed dates',()=>{
  for(const patch of [{start:'2026-09-21T13:00:00Z',end:'2026-09-21T13:30:00Z'},{end:'2026-09-21T14:00:00Z'},{start:'2026-09-21T09:15:00'},{appointmentType:'Invented'}])expect(()=>validateSlot(policy,{...slot,...patch},now)).toThrow();
  expect(()=>validateSlot({...policy,closedDates:['2026-09-21']},slot,now)).toThrow();
 });
 it('checks notice and staff eligibility and hours',()=>{
  expect(()=>validateSlot(policy,slot,Date.parse(slot.start)-59000)).toThrow();
  expect(()=>validateSlot({...policy,maximumAdvanceDays:1},slot,now)).toThrow();
  const staffed={...policy,staff:[{name:'Alex',weeklyHours:[{day:1,startMinute:600,endMinute:1020}],appointmentTypes:['Consultation']}]};
  expect(()=>validateSlot(staffed,slot,now)).toThrow();
  expect(()=>validateSlot(staffed,{...slot,staff:'Alex'},now)).toThrow();
  expect(()=>validateSlot(staffed,{...slot,start:'2026-09-21T14:15:00Z',end:'2026-09-21T14:45:00Z',staff:'Alex'},now)).not.toThrow();
 });
 it('handles both repeated autumn hours and spring-forward by absolute duration',()=>{
  const sunday={...policy,weeklyHours:[{day:0,startMinute:60,endMinute:240}],appointmentTypes:[{...policy.appointmentTypes[0],bufferBeforeMinutes:0,bufferAfterMinutes:0}]};
  for(const hour of ['05','06'])expect(()=>validateSlot(sunday,{...slot,start:`2026-11-01T${hour}:15:00Z`,end:`2026-11-01T${hour}:45:00Z`},Date.parse('2026-10-31T00:00:00Z'))).not.toThrow();
  expect(()=>validateSlot(sunday,{...slot,start:'2026-03-08T06:45:00Z',end:'2026-03-08T07:15:00Z'},Date.parse('2026-03-07T00:00:00Z'))).not.toThrow();
 });
 it('rejects invalid policy references, overlaps and dates; enforces cancellation notice',()=>{
  expect(schedulingPolicySchema.safeParse({...policy,closedDates:['2026-02-30']}).success).toBe(false);
  expect(schedulingPolicySchema.safeParse({...policy,weeklyHours:[...policy.weeklyHours,...policy.weeklyHours]}).success).toBe(false);
  expect(schedulingPolicySchema.safeParse({...policy,staff:[{name:'Alex',weeklyHours:[],appointmentTypes:['Invented']}]}).success).toBe(false);
  expect(()=>validateCancellation(policy,slot.start,now)).not.toThrow();
  expect(()=>validateCancellation(policy,slot.start,Date.parse(slot.start)-60000)).toThrow();
 });
});
