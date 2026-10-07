import {it,expect} from 'vitest';
import {availableSlots,availabilitySchema} from '../src/availability';
import {validateSlot,type SchedulingPolicy} from '../src/scheduling-policy';
const policy:SchedulingPolicy={timeZone:'America/New_York',weeklyHours:[{day:1,startMinute:540,endMinute:720}],closedDates:[],appointmentTypes:[{name:'Visit',durationMinutes:30,bufferBeforeMinutes:15,bufferAfterMinutes:15}],staff:[],minimumNoticeMinutes:0,maximumAdvanceDays:60,cancellationNoticeMinutes:0};
const now=Date.parse('2026-09-20T12:00:00Z');
const input={start:'2026-09-21T13:00:00Z',end:'2026-09-21T16:00:00Z',appointmentType:'Visit',limit:10};
it('returns only slots fitting business hours, buffers, busy periods and result limit',()=>{
 const result=availableSlots(policy,{...input,limit:2},[{start:'2026-09-21T13:30:00Z',end:'2026-09-21T14:00:00Z'}],now);
 expect(result.map(s=>s.start)).toEqual(['2026-09-21T14:15:00.000Z','2026-09-21T14:30:00.000Z']);
 for(const slot of result)expect(()=>validateSlot(policy,slot,now)).not.toThrow();
});
it('enforces closed dates, staff hours and notice without inventing missing staff',()=>{
 expect(availableSlots({...policy,closedDates:['2026-09-21']},input,[],now)).toEqual([]);
 const staffed={...policy,staff:[{name:'Alex',weeklyHours:[{day:1,startMinute:600,endMinute:660}],appointmentTypes:['Visit']}]};
 expect(()=>availableSlots(staffed,input,[],now)).toThrow('staff');
 expect(availableSlots(staffed,{...input,staff:'Alex'},[],now).map(s=>s.start)).toEqual(['2026-09-21T14:15:00.000Z']);
 expect(availableSlots({...policy,minimumNoticeMinutes:120},input,[],Date.parse('2026-09-21T14:00:00Z'))).toEqual([]);
});
it('preserves both repeated autumn-hour offsets and never invents spring-gap times',()=>{
 const sunday={...policy,weeklyHours:[{day:0,startMinute:60,endMinute:240}],appointmentTypes:[{...policy.appointmentTypes[0],bufferBeforeMinutes:0,bufferAfterMinutes:0}]};
 const autumn=availableSlots(sunday,{...input,start:'2026-11-01T05:00:00Z',end:'2026-11-01T07:00:00Z'},[],Date.parse('2026-10-31T00:00:00Z'));
 expect(autumn.map(s=>s.start)).toContain('2026-11-01T05:15:00.000Z');
 expect(autumn.map(s=>s.start)).toContain('2026-11-01T06:15:00.000Z');
 const spring=availableSlots(sunday,{...input,start:'2026-03-08T06:00:00Z',end:'2026-03-08T08:00:00Z'},[],Date.parse('2026-03-07T00:00:00Z'));
 for(const slot of spring){expect(()=>validateSlot(sunday,slot,Date.parse('2026-03-07T00:00:00Z'))).not.toThrow();expect(new Intl.DateTimeFormat('en-US',{timeZone:sunday.timeZone,hour:'numeric',hourCycle:'h23'}).format(new Date(slot.start))).not.toBe('02');}
});
it('fails closed on malformed busy ranges and rejects unbounded or ambiguous searches',()=>{
 for(const busy of [[{start:'bad',end:input.end}],[{start:input.end,end:input.start}]])expect(()=>availableSlots(policy,input,busy,now)).toThrow('invalid availability');
 for(const patch of [{start:'2026-09-21T09:00:00'},{end:'2026-10-21T16:00:00Z'},{limit:100},{end:input.start}])expect(availabilitySchema.safeParse({...input,...patch}).success).toBe(false);
});
