import {describe,it,expect} from 'vitest';
import {weekStartLocalDate,localWeekBoundsUtc,localDayKey} from '../src/proactive-detectors';
import {summarizeMoneyWeek,buildMoneyWeek} from '../src/money-week';
import {fetchMoneyWeek,formatWeekRange} from '../web/proactive-stub';

/* P5 — "Money this week". The honesty contract under test:
 * - dollars exist ONLY as confirmed-bookings × the owner's own average ticket;
 * - no average ticket -> dollar values are null, never a dressed-up $0;
 * - weeks are Monday-start in the BUSINESS-local time zone;
 * - every count is tenant-scoped. */

const NY='America/New_York';

describe('week definition (Monday-start, business-local)',()=>{
 it('a Monday starts its own week',()=>{
  expect(weekStartLocalDate('2026-10-12')).toBe('2026-10-12'); // Monday
  const b=localWeekBoundsUtc('2026-10-12',NY);
  expect(b).toMatchObject({startDate:'2026-10-12',endDate:'2026-10-18'});
 });
 it('a Sunday belongs to the week that started the previous Monday',()=>{
  expect(weekStartLocalDate('2026-10-11')).toBe('2026-10-05'); // Sunday
  expect(weekStartLocalDate('2026-10-18')).toBe('2026-10-12'); // Sunday
 });
 it('mid-week dates map back to Monday',()=>{
  expect(weekStartLocalDate('2026-10-14')).toBe('2026-10-12'); // Wednesday
  expect(weekStartLocalDate('2026-10-17')).toBe('2026-10-12'); // Saturday
 });
 it('bounds the week in UTC for an EDT business',()=>{
  const b=localWeekBoundsUtc('2026-10-14',NY);
  expect(b.start).toBe('2026-10-12T04:00:00.000Z'); // Mon 00:00 EDT
  expect(b.end).toBe('2026-10-19T04:00:00.000Z');   // next Mon 00:00 EDT
 });
 it('spans the DST fall-back as a 169-hour week',()=>{
  const b=localWeekBoundsUtc('2026-10-28',NY); // week of Mon Oct 26 – Sun Nov 1
  expect(b).toMatchObject({startDate:'2026-10-26',endDate:'2026-11-01'});
  expect(b.start).toBe('2026-10-26T04:00:00.000Z'); // EDT
  expect(b.end).toBe('2026-11-02T05:00:00.000Z');   // EST
  expect(Date.parse(b.end)-Date.parse(b.start)).toBe(169*3600000);
 });
 it('crosses the year boundary',()=>{
  const b=localWeekBoundsUtc('2026-12-31',NY); // Thursday
  expect(b).toMatchObject({startDate:'2026-12-28',endDate:'2027-01-03'});
 });
});

describe('summarizeMoneyWeek (pure aggregation)',()=>{
 it('estimates booked value from bookings × the owner-set average ticket',()=>{
  const s=summarizeMoneyWeek(4,3,7500);
  expect(s.thisWeek).toEqual({bookings:4,bookedValueCents:30000});
  expect(s.lastWeek).toEqual({bookings:3,bookedValueCents:22500});
  expect(s.bookingsDelta).toBe(1);
  expect(s.bookedValueDeltaCents).toBe(7500);
 });
 it('reports a negative delta plainly',()=>{
  const s=summarizeMoneyWeek(1,3,7500);
  expect(s.bookingsDelta).toBe(-2);
  expect(s.bookedValueDeltaCents).toBe(-15000);
 });
 it('with no average ticket the dollar values are null — never $0',()=>{
  const s=summarizeMoneyWeek(4,3,null);
  expect(s.thisWeek.bookedValueCents).toBeNull();
  expect(s.lastWeek.bookedValueCents).toBeNull();
  expect(s.bookedValueDeltaCents).toBeNull();
  expect(s.bookingsDelta).toBe(1); // counts are real either way
 });
 it('with a ticket set, zero bookings honestly computes to $0 booked',()=>{
  const s=summarizeMoneyWeek(0,2,7500);
  expect(s.thisWeek.bookedValueCents).toBe(0);
  expect(s.bookedValueDeltaCents).toBe(-15000);
 });
});

/* ---------------- buildMoneyWeek against a fake D1 ---------------- */

interface FakeAppt{tenant_id:string;state:string;reserved_start:string}
interface FakeTenant{profile:Record<string,unknown>;avgTicketCents:number|null;role:string|null}

function fakeEnv(tenants:Record<string,FakeTenant>,appointments:FakeAppt[]){
 const prepare=(sql:string)=>({bind:(...args:any[])=>({
  first:async()=>{
   if(sql.includes('agent_memberships')){
    const t=tenants[args[0] as string];
    if(!t||!t.role)return null;
    return {tenant_id:args[0],user_id:args[1],role:t.role,status:'active',expires_at:null};
   }
   if(sql.includes("field='profile'")){
    const t=tenants[args[0] as string];
    return t?{value_json:JSON.stringify(t.profile)}:null;
   }
   if(sql.includes("field='scheduling_policy'"))return null;
   if(sql.includes("field='roi_config'")){
    const t=tenants[args[0] as string];
    return t&&t.avgTicketCents!=null?{value_json:JSON.stringify({avgTicketCents:t.avgTicketCents})}:null;
   }
   if(sql.includes('mayor_appointments')&&sql.includes('COUNT(*)')){
    const [tenantId,start,end]=args as [string,string,string];
    const n=appointments.filter(a=>a.tenant_id===tenantId&&a.state==='confirmed'
     &&a.reserved_start>=start&&a.reserved_start<end).length;
    return {n};
   }
   return null;
  },
  all:async()=>({results:[]}),
  run:async()=>({meta:{changes:0}}),
 })});
 return {AGENT_DB:{prepare,batch:async()=>[]}} as any;
}

const NOW=Date.parse('2026-10-12T12:00:00Z'); // Monday 08:00 EDT
const salon=(over:Partial<FakeTenant>={}):FakeTenant=>({
 profile:{name:'Test Salon',vertical:'salon',timeZone:NY},avgTicketCents:7500,role:'owner',...over,
});

describe('buildMoneyWeek',()=>{
 const appointments:FakeAppt[]=[
  // tenant-a this week (Mon Oct 12 – Sun Oct 18): 3 confirmed
  {tenant_id:'a'.repeat(32),state:'confirmed',reserved_start:'2026-10-12T04:00:00.000Z'}, // exact week start counts
  {tenant_id:'a'.repeat(32),state:'confirmed',reserved_start:'2026-10-14T15:00:00.000Z'},
  {tenant_id:'a'.repeat(32),state:'confirmed',reserved_start:'2026-10-18T20:00:00.000Z'},
  {tenant_id:'a'.repeat(32),state:'cancelled',reserved_start:'2026-10-15T15:00:00.000Z'}, // not confirmed — excluded
  // tenant-a last week: 2 confirmed
  {tenant_id:'a'.repeat(32),state:'confirmed',reserved_start:'2026-10-06T15:00:00.000Z'},
  {tenant_id:'a'.repeat(32),state:'confirmed',reserved_start:'2026-10-11T15:00:00.000Z'},
  // next week's first instant — belongs to neither window
  {tenant_id:'a'.repeat(32),state:'confirmed',reserved_start:'2026-10-19T04:00:00.000Z'},
  // another tenant's bookings in the same windows — must never leak in
  {tenant_id:'b'.repeat(32),state:'confirmed',reserved_start:'2026-10-13T15:00:00.000Z'},
  {tenant_id:'b'.repeat(32),state:'confirmed',reserved_start:'2026-10-14T15:00:00.000Z'},
 ];

 it('computes estimated booked value from real confirmed bookings only',async()=>{
  const env=fakeEnv({['a'.repeat(32)]:salon()},appointments);
  const r=await buildMoneyWeek(env,{tenantId:'a'.repeat(32),userId:'u1'},NOW);
  expect(r.weekStart).toBe('2026-10-12');
  expect(r.weekEnd).toBe('2026-10-18');
  expect(r.lastWeekStart).toBe('2026-10-05');
  expect(r.thisWeek).toEqual({bookings:3,bookedValueCents:22500});
  expect(r.lastWeek).toEqual({bookings:2,bookedValueCents:15000});
  expect(r.bookingsDelta).toBe(1);
  expect(r.bookedValueDeltaCents).toBe(7500);
  expect(r.valueBasis).toBe('average_ticket_estimate');
  expect(r.avgTicketConfigured).toBe(true);
  expect(r.bookingNoun).toBe('appointments');
 });

 it('tenant isolation: the other tenant sees only its own bookings',async()=>{
  const env=fakeEnv({['b'.repeat(32)]:salon()},appointments);
  const r=await buildMoneyWeek(env,{tenantId:'b'.repeat(32),userId:'u2'},NOW);
  expect(r.thisWeek.bookings).toBe(2);
  expect(r.lastWeek.bookings).toBe(0);
 });

 it('no average ticket: counts stay real, dollars stay null',async()=>{
  const env=fakeEnv({['a'.repeat(32)]:salon({avgTicketCents:null})},appointments);
  const r=await buildMoneyWeek(env,{tenantId:'a'.repeat(32),userId:'u1'},NOW);
  expect(r.thisWeek).toEqual({bookings:3,bookedValueCents:null});
  expect(r.lastWeek).toEqual({bookings:2,bookedValueCents:null});
  expect(r.bookedValueDeltaCents).toBeNull();
  expect(r.valueBasis).toBe('not_configured');
  expect(r.avgTicketConfigured).toBe(false);
 });

 it('empty tenant with a ticket: zero bookings, $0 booked, no invented figure',async()=>{
  const env=fakeEnv({['c'.repeat(32)]:salon()},appointments);
  const r=await buildMoneyWeek(env,{tenantId:'c'.repeat(32),userId:'u3'},NOW);
  expect(r.thisWeek).toEqual({bookings:0,bookedValueCents:0});
  expect(r.lastWeek).toEqual({bookings:0,bookedValueCents:0});
 });

 it('uses the business-local week: Sunday night in Los Angeles is last week in New York terms',async()=>{
  const la=salon({profile:{name:'LA Salon',vertical:'salon',timeZone:'America/Los_Angeles'}});
  const env=fakeEnv({['a'.repeat(32)]:la},appointments);
  // Mon 2026-10-12 06:30 UTC = Sun Oct 11 23:30 PDT — the LA week is Oct 5–11.
  const r=await buildMoneyWeek(env,{tenantId:'a'.repeat(32),userId:'u1'},Date.parse('2026-10-12T06:30:00Z'));
  expect(r.weekStart).toBe('2026-10-05');
  expect(r.weekEnd).toBe('2026-10-11');
  expect(r.timeZone).toBe('America/Los_Angeles');
  expect(localDayKey(Date.parse('2026-10-12T06:30:00Z'),'America/Los_Angeles')).toBe('2026-10-11');
 });

 it('gates to operators: staff cannot read the money card',async()=>{
  const env=fakeEnv({['a'.repeat(32)]:salon({role:'staff'})},appointments);
  await expect(buildMoneyWeek(env,{tenantId:'a'.repeat(32),userId:'u1'},NOW))
   .rejects.toMatchObject({status:403});
 });

 it('unknown workspace is a 404, not an empty card',async()=>{
  const env=fakeEnv({},appointments);
  await expect(buildMoneyWeek(env,{tenantId:'a'.repeat(32),userId:'u1'},NOW))
   .rejects.toMatchObject({status:404});
 });
});

describe('money-week web adapter',()=>{
 const notFound=()=>Object.assign(new Error('This service could not finish.'),{code:'not_found'});
 it('resolves null (honest empty state) when the route is not live',async()=>{
  const api=async()=>{throw notFound();};
  await expect(fetchMoneyWeek(api,'tenant')).resolves.toBeNull();
 });
 it('passes real contract data through untouched',async()=>{
  const data={weekStart:'2026-10-12',thisWeek:{bookings:3,bookedValueCents:22500}};
  const api=async()=>data;
  await expect(fetchMoneyWeek(api,'tenant')).resolves.toBe(data);
 });
 it('formats the week range for the card header',()=>{
  expect(formatWeekRange('2026-10-12','2026-10-18')).toBe('Mon, Oct 12 – Sun, Oct 18');
  expect(formatWeekRange('2026-12-28','2027-01-03')).toBe('Mon, Dec 28 – Sun, Jan 3');
 });
});
