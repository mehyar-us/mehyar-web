import {it,expect} from 'vitest';
import {checkScheduleSchema,nextCheckRun} from '../src/check-schedule';
const schedule={timeZone:'America/New_York',frequency:'daily' as const,hour:8,minute:0};
it('preserves local time across daylight saving changes',()=>{
 expect(nextCheckRun(schedule,Date.parse('2026-03-07T14:00:00Z')).at).toBe('2026-03-08T12:00:00.000Z');
 expect(nextCheckRun(schedule,Date.parse('2026-10-31T14:00:00Z')).at).toBe('2026-11-01T13:00:00.000Z');
});
it('skips weekends and a nonexistent local clock time',()=>{
 expect(nextCheckRun({...schedule,frequency:'weekdays'},Date.parse('2026-09-25T13:00:00Z')).at).toBe('2026-09-28T12:00:00.000Z');
 expect(nextCheckRun({...schedule,hour:2,minute:30},Date.parse('2026-03-08T05:00:00Z')).at).toBe('2026-03-09T06:30:00.000Z');
});
it('does not run twice on a repeated local date and coalesces missed days',()=>{
 expect(nextCheckRun({...schedule,hour:1,minute:30},Date.parse('2026-11-01T05:30:00Z'),'2026-11-01').at).toBe('2026-11-02T06:30:00.000Z');
 expect(nextCheckRun(schedule,Date.parse('2026-09-28T15:00:00Z'),'2026-09-20').at).toBe('2026-09-29T12:00:00.000Z');
});
it('rejects invalid zones and unsupported minute precision',()=>{
 expect(()=>checkScheduleSchema.parse({...schedule,timeZone:'Mars'})).toThrow();
 expect(()=>checkScheduleSchema.parse({...schedule,minute:3})).toThrow();
});
