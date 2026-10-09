import {describe,it,expect,vi,beforeEach} from 'vitest';

/* Crew 4 (Agent 4): vertical detector params, ROI labels, connector priority.
 * The crew4 vertical track enriches VerticalProfile with optional detectorParams,
 * kpis, and connectorPriority; these tests pin the ??-fallback behavior so the
 * code works with and without that enrichment. */

// ---- mock ../src/verticals: real module, but verticalProfile reads per-test
// enrichment (detectorParams / kpis / connectorPriority) from mockProfiles ----
const mockProfiles=vi.hoisted(()=>({} as Record<string,any>));
vi.mock('../src/verticals',async()=>{
 const actual=await vi.importActual<typeof import('../src/verticals')>('../src/verticals');
 return {...actual,verticalProfile:(v:string|undefined|null)=>mockProfiles[v as string]??mockProfiles.other};
});

import {
 detectorParamsOf,LAPSED_DAYS,
 detectLapsedRegulars,detectSlowDay,detectUnansweredLeads,detectNoShowRisk,
 type ProactiveContext,
} from '../src/proactive-detectors';
import {roiTileLabels} from '../src/proactive';
import {orderConnectorsByPriority} from '../src/connections';

const TZ='America/New_York';
const NOW=Date.parse('2026-10-12T12:00:00Z'); // Monday 08:00 EDT

beforeEach(()=>{
 for(const k of Object.keys(mockProfiles))delete mockProfiles[k];
 Object.assign(mockProfiles,{
  salon:{vertical:'salon',vocabulary:{customer:'client',booking:'appointment',staff:'stylist',service:'service'}},
  restaurant:{vertical:'restaurant',vocabulary:{customer:'guest',booking:'reservation',staff:'server',service:'table'}},
  plumbing_hvac:{vertical:'plumbing_hvac',vocabulary:{customer:'customer',booking:'job',staff:'technician',service:'service'}},
  dental:{vertical:'dental',vocabulary:{customer:'patient',booking:'visit',staff:'hygienist',service:'treatment'}},
  auto_repair:{vertical:'auto_repair',vocabulary:{customer:'customer',booking:'service appointment',staff:'technician',service:'repair'}},
  other:{vertical:'other',vocabulary:{customer:'customer',booking:'appointment',staff:'team member',service:'service'}},
 });
});

function ctx(vertical:string,policy:ProactiveContext['policy']=null):ProactiveContext{
 return {tenantId:'t1',nowMs:NOW,businessName:'Test Biz',vertical:vertical as any,timeZone:TZ,policy};
}

/** Minimal fake AGENT_DB: canned `all` results + captured bind args (so tests can
 * assert the cutoff/window the detector actually used instead of reimplementing SQL). */
function fakeEnv(allRows:any[]=[]){
 const calls:{sql:string;args:any[]}[]=[];
 const prepare=(sql:string)=>({bind:(...args:any[])=>{calls.push({sql,args});return{
  all:async()=>({results:allRows}),
  first:async()=>null,
  run:async()=>({}),
 };}});
 return {env:{AGENT_DB:{prepare}},calls};
}

describe('detector params vary by vertical',()=>{
 it('lapsed_regular: salon lapsed 56 vs dental 180 (fallbacks)',async()=>{
  const {env}=fakeEnv([{id:'c1',name:'A',phone:'+17185550001',last_start:'2026-01-01T00:00:00Z'}]);
  const r1=await detectLapsedRegulars(env as any,ctx('salon'));
  expect(r1).toHaveLength(1);
  expect(r1[0].payload.cutoffDays).toBe(56);
  const r2=await detectLapsedRegulars(env as any,ctx('dental'));
  expect(r2).toHaveLength(1);
  expect(r2[0].payload.cutoffDays).toBe(180);
 });
 it('LAPSED_DAYS is the single fallback source (no forked copies)',()=>{
  expect(LAPSED_DAYS).toEqual({salon:56,restaurant:60,plumbing_hvac:180,dental:180,auto_repair:180,pet_grooming:70,med_spa:120,other:90});
  expect(detectorParamsOf('salon' as any)).toEqual({});
 });
 it('profile detectorParams override the fallbacks',async()=>{
  mockProfiles.salon.detectorParams={lapsedRegularDays:70,rebookingCycleDays:42};
  mockProfiles.dental.detectorParams={lapsedRegularDays:180,rebookingCycleDays:180};
  const {env}=fakeEnv([{id:'c1',name:'A',phone:'+17185550001',last_start:'2026-01-01T00:00:00Z'}]);
  const r1=await detectLapsedRegulars(env as any,ctx('salon'));
  expect(r1[0].payload.cutoffDays).toBe(70);
  const r2=await detectLapsedRegulars(env as any,ctx('dental'));
  expect(r2[0].payload.cutoffDays).toBe(180);
 });
 it('rebookingCycleDays lands in the lapsed_regular payload when defined (salon 42, dental 180)',async()=>{
  mockProfiles.salon.detectorParams={rebookingCycleDays:42};
  mockProfiles.dental.detectorParams={rebookingCycleDays:180};
  const {env}=fakeEnv([{id:'c1',name:'A',phone:'+17185550001',last_start:'2026-01-01T00:00:00Z'}]);
  const r1=await detectLapsedRegulars(env as any,ctx('salon'));
  expect(r1[0].payload.rebookingCycleDays).toBe(42);
  const r2=await detectLapsedRegulars(env as any,ctx('dental'));
  expect(r2[0].payload.rebookingCycleDays).toBe(180);
  // absent → not present, no invented default
  const {env:env2}=fakeEnv([{id:'c1',name:'A',phone:'+17185550001',last_start:'2026-01-01T00:00:00Z'}]);
  const r3=await detectLapsedRegulars(env2 as any,ctx('restaurant'));
  expect('rebookingCycleDays' in (r3[0].payload as object)).toBe(false);
 });
 it('slow_day uses slowDayMinGapMinutes (90 finds a 100-min gap the 120 default misses)',async()=>{
  const busy=[{reserved_start:'2026-10-13T13:00:00.000Z',reserved_end:'2026-10-13T19:20:00.000Z'}]; // 09:00–15:20 EDT
  const policy={timeZone:TZ,weeklyHours:[{day:2,startMinute:540,endMinute:1020}]} as any; // Tue 09:00–17:00
  mockProfiles.salon.detectorParams={slowDayMinGapMinutes:90};
  const {env}=fakeEnv(busy);
  const r1=await detectSlowDay(env as any,ctx('salon',policy));
  expect(r1).toHaveLength(1);
  expect(r1[0].payload.maxGapMinutes).toBe(100);
  const {env:env2}=fakeEnv(busy);
  const r2=await detectSlowDay(env2 as any,ctx('restaurant',policy));
  expect(r2).toHaveLength(0); // 100 < 120 default
 });
 it('unanswered_lead uses unansweredLeadMinutes for the cutoff',async()=>{
  mockProfiles.salon.detectorParams={unansweredLeadMinutes:30};
  const {env,calls}=fakeEnv([{id:'s1',from_number:'+17185550001',body:'hi',created_at:'2026-10-12T11:00:00Z'}]);
  await detectUnansweredLeads(env as any,ctx('salon'));
  expect(calls[0].args[1]).toBe('2026-10-12T11:30:00.000Z'); // NOW - 30 min
  const {env:env2,calls:calls2}=fakeEnv([]);
  await detectUnansweredLeads(env2 as any,ctx('dental'));
  expect(calls2[0].args[1]).toBe('2026-10-12T10:00:00.000Z'); // NOW - 120 min default
 });
 it('no_show_risk uses noShowLookbackDays for the forward window',async()=>{
  mockProfiles.dental.detectorParams={noShowLookbackDays:7};
  const {env,calls}=fakeEnv([]);
  await detectNoShowRisk(env as any,ctx('dental'));
  expect(calls[0].args[2]).toBe('2026-10-19T12:00:00.000Z'); // NOW + 7 days
  const {env:env2,calls:calls2}=fakeEnv([]);
  await detectNoShowRisk(env2 as any,ctx('salon'));
  expect(calls2[0].args[2]).toBe('2026-10-14T12:00:00.000Z'); // NOW + 2 days default
 });
});

describe('ROI labels are vertical-aware',()=>{
 it('bookings tile noun follows the vertical (appointments vs reservations vs jobs vs visits)',()=>{
  expect(roiTileLabels('salon' as any).bookingsByMayor).toBe('Appointments booked by Mayor');
  expect(roiTileLabels('restaurant' as any).bookingsByMayor).toBe('Reservations booked by Mayor');
  expect(roiTileLabels('plumbing_hvac' as any).bookingsByMayor).toBe('Jobs booked by Mayor');
  expect(roiTileLabels('dental' as any).bookingsByMayor).toBe('Visits booked by Mayor');
  expect(roiTileLabels('auto_repair' as any).bookingsByMayor).toBe('Service appointments booked by Mayor');
  expect(roiTileLabels('other' as any).bookingsByMayor).toBe('Appointments booked by Mayor');
 });
 it('keeps the existing tile labels by default',()=>{
  const labels=roiTileLabels('salon' as any);
  expect(labels).toMatchObject({
   recoveredRevenue:'Recovered revenue',
   missedCallsRecovered:'Missed calls recovered',
   avgResponseTime:'Avg response time',
   noShowRate:'No-show rate',
  });
 });
 it('uses the vertical kpis labels where they map to existing tiles',()=>{
  mockProfiles.salon.kpis=[
   {key:'recovered_revenue',label:'Revenue won back',hint:''},
   {key:'appointments_booked',label:'Clients rebooked by Mayor',hint:''},
  ];
  const labels=roiTileLabels('salon' as any);
  expect(labels.recoveredRevenue).toBe('Revenue won back');
  expect(labels.bookingsByMayor).toBe('Clients rebooked by Mayor');
  // unmapped tiles keep their defaults — no new metrics invented
  expect(labels.noShowRate).toBe('No-show rate');
 });
});

describe('connector ordering follows connectorPriority',()=>{
 it('plumbing_hvac puts phone first',()=>{
  expect(orderConnectorsByPriority('plumbing_hvac' as any,['email','phone','calendar'])).toEqual(['phone','calendar','email']);
 });
 it('salon puts calendar first',()=>{
  expect(orderConnectorsByPriority('salon' as any,['facebook','google','microsoft','zoho']))
   .toEqual(['google','microsoft','zoho','facebook']);
 });
 it('restaurant puts reviews first',()=>{
  expect(orderConnectorsByPriority('restaurant' as any,['google','facebook','microsoft']))
   .toEqual(['facebook','google','microsoft']);
 });
 it('connectors not in the list keep their current relative order at the end',()=>{
  // plumbing_hvac fallback has no 'reviews': facebook stays last, relative order preserved
  expect(orderConnectorsByPriority('plumbing_hvac' as any,['facebook','google','zoho']))
   .toEqual(['google','zoho','facebook']);
 });
 it('other vertical keeps today\'s order unchanged',()=>{
  const ids=['facebook','google','zoho','microsoft'];
  expect(orderConnectorsByPriority('other' as any,ids)).toEqual(ids);
 });
 it('a profile connectorPriority wins over the fallback',()=>{
  mockProfiles.salon.connectorPriority=['zoho','google'];
  expect(orderConnectorsByPriority('salon' as any,['google','microsoft','zoho']))
   .toEqual(['zoho','google','microsoft']);
 });
});
