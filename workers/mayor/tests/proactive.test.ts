import {describe,it,expect} from 'vitest';
import {
 inQuietHours,localDayKey,localParts,shiftLocalDate,localDayBoundsUtc,monthBoundsUtc,
 dayGaps,LAPSED_DAYS,tzOffsetMs,
} from '../src/proactive-detectors';

const TZ='America/New_York';

describe('quiet hours',()=>{
 it('is quiet at 21:00 local',()=>{expect(inQuietHours(Date.parse('2026-10-09T01:00:00Z'),TZ)).toBe(true);}); // Oct 8 21:00 EDT
 it('is quiet at 03:00 local',()=>{expect(inQuietHours(Date.parse('2026-10-08T07:00:00Z'),TZ)).toBe(true);});
 it('is not quiet at 08:00 local',()=>{expect(inQuietHours(Date.parse('2026-10-08T12:00:00Z'),TZ)).toBe(false);});
 it('is not quiet at 20:59 local',()=>{expect(inQuietHours(Date.parse('2026-10-09T00:59:00Z'),TZ)).toBe(false);});
 it('is quiet at 07:59 local',()=>{expect(inQuietHours(Date.parse('2026-10-08T11:59:00Z'),TZ)).toBe(true);});
});

describe('local day keys',()=>{
 it('keys the nudge day in business-local time',()=>{
  expect(localDayKey(Date.parse('2026-10-08T03:00:00Z'),TZ)).toBe('2026-10-07'); // Oct 7 23:00 EDT
  expect(localDayKey(Date.parse('2026-10-08T12:00:00Z'),TZ)).toBe('2026-10-08');
 });
 it('shifts local dates across month boundaries',()=>{
  expect(shiftLocalDate('2026-10-08',1)).toBe('2026-10-09');
  expect(shiftLocalDate('2026-10-01',-1)).toBe('2026-09-30');
  expect(shiftLocalDate('2026-10-08',-7)).toBe('2026-10-01');
 });
 it('bounds a local day in UTC',()=>{
  const b=localDayBoundsUtc('2026-10-08',TZ);
  expect(b.start).toBe('2026-10-08T04:00:00.000Z'); // EDT = UTC-4
  expect(b.end).toBe('2026-10-09T04:00:00.000Z');
 });
 it('bounds a local month in UTC',()=>{
  const b=monthBoundsUtc(2026,10,TZ);
  expect(b.start).toBe('2026-10-01T04:00:00.000Z');
  expect(b.end).toBe('2026-11-01T04:00:00.000Z'); // EST = UTC-5 after Nov 1
 });
 it('reports the EDT offset in October',()=>{
  expect(tzOffsetMs(TZ,Date.parse('2026-10-08T12:00:00Z'))).toBe(-4*3600000);
 });
});

describe('day gaps',()=>{
 const periods=[{startMinute:540,endMinute:1020}]; // 09:00–17:00
 it('finds gaps around a midday booking',()=>{
  const gaps=dayGaps(periods,[{start:'2026-10-09T14:00:00.000Z',end:'2026-10-09T16:00:00.000Z'}],'2026-10-09',TZ);
  expect(gaps).toHaveLength(2);
  expect(gaps[0].minutes).toBe(60);
  expect(gaps[1].minutes).toBe(300);
 });
 it('returns the whole day when nothing is booked',()=>{
  const gaps=dayGaps(periods,[],'2026-10-09',TZ);
  expect(gaps).toHaveLength(1);
  expect(gaps[0].minutes).toBe(480);
 });
 it('merges overlapping bookings',()=>{
  const gaps=dayGaps(periods,[
   {start:'2026-10-09T13:00:00.000Z',end:'2026-10-09T15:00:00.000Z'},
   {start:'2026-10-09T14:00:00.000Z',end:'2026-10-09T16:00:00.000Z'},
  ],'2026-10-09',TZ);
  // Open 09:00–17:00 EDT; bookings cover 09:00–12:00 EDT → one 300-min afternoon gap.
  expect(gaps.map(g=>g.minutes)).toEqual([300]);
 });
 it('returns no gaps on a closed day',()=>{
  expect(dayGaps([],[{start:'2026-10-09T14:00:00.000Z',end:'2026-10-09T15:00:00.000Z'}],'2026-10-09',TZ)).toEqual([]);
 });
});

describe('lapsed windows',()=>{
 it('uses the per-vertical rebooking window',()=>{
  expect(LAPSED_DAYS.salon).toBe(45);
  expect(LAPSED_DAYS.restaurant).toBe(60);
  expect(LAPSED_DAYS.plumbing_hvac).toBe(180);
  expect(LAPSED_DAYS.dental).toBe(190);
  expect(LAPSED_DAYS.auto_repair).toBe(180);
  expect(LAPSED_DAYS.other).toBe(90);
 });
});

describe('localParts',()=>{
 it('reports the local weekday',()=>{
  // 2026-10-08 is a Thursday.
  expect(localParts(Date.parse('2026-10-08T12:00:00Z'),TZ).weekday).toBe('Thu');
 });
});

describe('buildFollowupCardCopy',()=>{
 it('builds the vertical-aware text-back action',async()=>{
  const {buildFollowupCardCopy}=await import('../src/proactive-detectors');
  const ctx={tenantId:'t',nowMs:Date.parse('2026-10-08T12:30:00Z'),businessName:'Test Salon',vertical:'salon' as const,timeZone:TZ,policy:null};
  const copy=buildFollowupCardCopy(ctx,{missedCallId:'mc1',callerNumber:'+17185551212',occurredAt:'2026-10-08T12:00:00Z'});
  expect(copy.title).toBe('Missed call needs a text-back');
  expect(copy.body).toContain('+17185551212');
  expect(copy.body).toContain('30 min ago');
  expect(copy.draft.message).toContain('Test Salon');
  expect(copy.draft.message).toContain('STOP');
  expect(copy.draft.audience).toBe('missed caller');
  expect(copy.draft.audienceCount).toBe(1);
  expect(copy.draft.recipients).toEqual([{name:'',phone:'+17185551212'}]);
  expect(copy.draft.meta).toEqual({missedCallId:'mc1'});
 });
});
