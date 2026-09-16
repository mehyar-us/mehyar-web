import {describe,it,expect} from 'vitest';
import {monthlyUsageWindow} from '../src/billing/text-access';
describe('subscription monthly allowance windows',()=>{
  it.each([
    ['2026-01-31T09:30:00.000Z','2026-02-28T09:29:59.000Z','2026-01-31T09:30:00.000Z','2026-02-28T09:30:00.000Z'],
    ['2026-01-31T09:30:00.000Z','2026-02-28T09:30:00.000Z','2026-02-28T09:30:00.000Z','2026-03-31T09:30:00.000Z'],
    ['2024-01-31T09:30:00.000Z','2024-02-29T10:00:00.000Z','2024-02-29T09:30:00.000Z','2024-03-31T09:30:00.000Z'],
    ['2025-12-15T12:00:00.000Z','2026-01-01T00:00:00.000Z','2025-12-15T12:00:00.000Z','2026-01-15T12:00:00.000Z'],
  ])('anchors %s at %s without calendar-month resets',(anchor,now,start,end)=>{
    expect(monthlyUsageWindow(anchor,new Date(now))).toEqual({start,end});
  });
  it.each(['not-a-date','2030-01-01T00:00:00.000Z'])('rejects unverified or future anchor %s',anchor=>{
    expect(()=>monthlyUsageWindow(anchor,new Date('2026-09-16T00:00:00.000Z'))).toThrow();
  });
});
