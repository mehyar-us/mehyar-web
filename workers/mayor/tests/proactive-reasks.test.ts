import {describe,it,expect} from 'vitest';
import type {Env} from '../src/env';
import type {ProactiveContext} from '../src/proactive-detectors';
import type {SchedulingPolicy} from '../src/scheduling-policy';
import {
 REASK_COOLDOWN_DAYS,reaskDedupeKey,withinReaskCooldown,hoursMissing,
 tenantPhoneConnected,recentMissedCall,evaluateDayOneReasks,runDayOneReasks,
} from '../src/proactive-reasks';
import {surfaceGate,notifyOwners,logNudge} from '../src/proactive';

/** P7 day-one re-asks. Server tests run on a pattern-matching in-memory D1
 * holding two tenants, with the REAL proactive surface (surfaceGate /
 * notifyOwners / logNudge from proactive.ts) injected — so quiet hours and
 * the 3/day nudge cap are exercised, not stubbed. */

const T1='a'.repeat(32),T2='b'.repeat(32);
const TZ='America/New_York';
const NOW=Date.parse('2026-10-08T16:00:00Z'); // Thu 12:00 EDT — outside quiet hours
const QUIET=Date.parse('2026-10-09T02:00:00Z'); // Thu 22:00 EDT — quiet hours

function ctx(tenantId:string,overrides:Partial<ProactiveContext>={}):ProactiveContext{
 return {tenantId,nowMs:NOW,businessName:'Glow Studio',vertical:'salon',timeZone:TZ,policy:null,language:'en',...overrides};
}
const policyWithHours={timeZone:TZ,weeklyHours:[{day:4,startMinute:540,endMinute:1020}]} as unknown as SchedulingPolicy;
const policyEmptyHours={timeZone:TZ,weeklyHours:[]} as unknown as SchedulingPolicy;

interface Store{
 phone:Array<{tenant_id:string;status:string;selected_number:string|null}>;
 missed:Array<{tenant_id:string;occurred_at:string}>;
 profiles:Map<string,Record<string,unknown>>;
 notifications:Array<{tenant_id:string;user_id:string;kind:string;dedupe_key:string;created_at:string}>;
 nudgeLog:Array<{tenant_id:string;kind:string;day_key:string}>;
 owners:Map<string,string[]>;
}
function mockServer(){
 const store:Store={phone:[],missed:[],profiles:new Map(),notifications:[],nudgeLog:[],owners:new Map([[T1,['owner-1']],[T2,['owner-2']]])};
 const db={
  prepare(sql:string){
   let bound:unknown[]=[];
   const stmt={
    bind(...args:unknown[]){bound=args;return stmt;},
    async first(){
     if(sql.includes('MAX(created_at)')&&sql.includes('mayor_notifications')){
      const rows=store.notifications.filter(n=>n.tenant_id===bound[0]&&n.kind===bound[1]);
      return {last_at:rows.length?rows.map(r=>r.created_at).sort().at(-1)!:null};
     }
     if(sql.includes('FROM mayor_phone_connections')){
      const ok=store.phone.some(r=>r.tenant_id===bound[0]&&r.status==='authorized'&&!!r.selected_number);
      return ok?{ok:1}:null;
     }
     if(sql.includes('FROM mayor_missed_calls')){
      const ok=store.missed.some(r=>r.tenant_id===bound[0]&&r.occurred_at>=(bound[1] as string));
      return ok?{ok:1}:null;
     }
     if(sql.includes('FROM mayor_memory')){
      const profile=store.profiles.get(String(bound[0]));
      return profile?{value_json:JSON.stringify(profile)}:null;
     }
     if(sql.includes('COUNT(*) AS n FROM mayor_nudge_log')){
      return {n:store.nudgeLog.filter(r=>r.tenant_id===bound[0]&&r.day_key===bound[1]).length};
     }
     return null;
    },
    async all(){
     if(sql.includes('FROM agent_memberships'))
      return {results:(store.owners.get(String(bound[0]))??[]).map(user_id=>({user_id}))};
     return {results:[]};
    },
    async run(){
     if(sql.startsWith('INSERT INTO mayor_notifications')){
      // notifyOwners bind order: uuid, tenant, user, dedupe, kind, now, now, tenant, user, dedupe, tenant.
      const [,tenant,user,dedupe,kind,now]=bound as [string,string,string,string,string,string];
      if(store.owners.has(tenant)&&!store.notifications.some(n=>n.tenant_id===tenant&&n.user_id===user&&n.dedupe_key===dedupe))
       store.notifications.push({tenant_id:tenant,user_id:user,kind,dedupe_key:dedupe,created_at:now});
      return {meta:{changes:1}};
     }
     if(sql.startsWith('INSERT INTO mayor_nudge_log')){
      const [,tenant,kind,day_key]=bound as [string,string,string,string];
      store.nudgeLog.push({tenant_id:tenant,kind,day_key});
      return {meta:{changes:1}};
     }
     return {meta:{changes:0}};
    },
   };
   return stmt;
  },
  async batch(stmts:Array<{run():Promise<unknown>}>){const out=[];for(const s of stmts)out.push(await s.run());return out;},
 } as unknown as Env['AGENT_DB'];
 return {env:{AGENT_DB:db} as unknown as Env,store};
}
const surface={gate:surfaceGate,notify:notifyOwners,log:logNudge};
/** Tenant with a named profile WITH hours, so only the phone check can fire. */
function baseTenant(store:Store,tenant:string){
 store.profiles.set(tenant,{name:'Glow Studio',hours:'Tue–Sat 9–6'});
}

describe('pure helpers',()=>{
 it('hours are missing only when neither profile text nor policy carries them',()=>{
  expect(hoursMissing(undefined,null)).toBe(true);
  expect(hoursMissing('',null)).toBe(true);
  expect(hoursMissing('   ',policyEmptyHours)).toBe(true); // empty weeklyHours = closed every day
  expect(hoursMissing('Tue–Sat 9–6',null)).toBe(false);
  expect(hoursMissing(undefined,policyWithHours)).toBe(false);
  expect(hoursMissing('Tue–Sat 9–6',policyEmptyHours)).toBe(false);
 });
 it('cooldown is 30 days and the dedupe key is a monthly bucket',()=>{
  expect(REASK_COOLDOWN_DAYS).toBe(30);
  expect(withinReaskCooldown(null,NOW)).toBe(false);
  expect(withinReaskCooldown(new Date(NOW-10*86400000).toISOString(),NOW)).toBe(true);
  expect(withinReaskCooldown(new Date(NOW-31*86400000).toISOString(),NOW)).toBe(false);
  expect(reaskDedupeKey('phone_connect_reask',NOW,TZ)).toBe('phone_connect_reask:2026-10');
 });
});

describe('evidence + connection ground truth',()=>{
 it('phone counts as connected only when authorized with a number selected',async()=>{
  const {env,store}=mockServer();
  expect(await tenantPhoneConnected(env.AGENT_DB,T1)).toBe(false);
  store.phone.push({tenant_id:T1,status:'authorized',selected_number:null});
  expect(await tenantPhoneConnected(env.AGENT_DB,T1)).toBe(false);
  store.phone.push({tenant_id:T1,status:'revoked',selected_number:'+15551234567'});
  expect(await tenantPhoneConnected(env.AGENT_DB,T1)).toBe(false);
  store.phone.push({tenant_id:T1,status:'authorized',selected_number:'+15551234567'});
  expect(await tenantPhoneConnected(env.AGENT_DB,T1)).toBe(true);
  // Tenant isolation: T2 still has nothing.
  expect(await tenantPhoneConnected(env.AGENT_DB,T2)).toBe(false);
 });
 it('missed-call evidence must be inside the 30-day window and tenant-scoped',async()=>{
  const {env,store}=mockServer();
  const since=new Date(NOW-30*86400000).toISOString();
  store.missed.push({tenant_id:T2,occurred_at:new Date(NOW-3600000).toISOString()});
  store.missed.push({tenant_id:T1,occurred_at:new Date(NOW-40*86400000).toISOString()}); // stale
  expect(await recentMissedCall(env.AGENT_DB,T1,since)).toBe(false);
  expect(await recentMissedCall(env.AGENT_DB,T2,since)).toBe(true);
 });
});

describe('phone connect re-ask (items 1+2)',()=>{
 it('fires once with real evidence + missing phone, through the real gates',async()=>{
  const {env,store}=mockServer();baseTenant(store,T1);
  store.missed.push({tenant_id:T1,occurred_at:new Date(NOW-3600000).toISOString()});
  const result=await runDayOneReasks(env,ctx(T1),surface);
  expect(result).toEqual({fired:1,kinds:['phone_connect_reask']});
  expect(store.notifications).toHaveLength(1);
  expect(store.notifications[0]).toMatchObject({tenant_id:T1,kind:'phone_connect_reask',dedupe_key:'phone_connect_reask:2026-10'});
  // Counts against the daily nudge cap like any suggestion.
  expect(store.nudgeLog).toEqual([{tenant_id:T1,kind:'suggestion',day_key:'2026-10-08'}]);
 });
 it('never fires when the phone is connected — the followup detector owns that path',async()=>{
  const {env,store}=mockServer();baseTenant(store,T1);
  store.phone.push({tenant_id:T1,status:'authorized',selected_number:'+15551234567'});
  store.missed.push({tenant_id:T1,occurred_at:new Date(NOW-3600000).toISOString()});
  expect(await runDayOneReasks(env,ctx(T1),surface)).toEqual({fired:0,kinds:[]});
  expect(store.notifications).toHaveLength(0);
 });
 it('never fires without evidence — no missed call, no claim',async()=>{
  const {env,store}=mockServer();baseTenant(store,T1);
  expect(await evaluateDayOneReasks(env,ctx(T1))).toEqual([]);
 });
 it('does not nag: a second cycle inside the cooldown stays silent',async()=>{
  const {env,store}=mockServer();baseTenant(store,T1);
  store.missed.push({tenant_id:T1,occurred_at:new Date(NOW-3600000).toISOString()});
  await runDayOneReasks(env,ctx(T1),surface);
  const again=await runDayOneReasks(env,ctx(T1),surface);
  expect(again.fired).toBe(0);
  expect(store.notifications).toHaveLength(1);
 });
 it('cooldown blocks a re-fire even across a month boundary, then expires',async()=>{
  const {env,store}=mockServer();baseTenant(store,T1);
  store.missed.push({tenant_id:T1,occurred_at:new Date(NOW-3600000).toISOString()});
  // Fired Sep 20 (previous bucket, 18 days ago): the monthly key alone would
  // allow October — the 30-day created-at cooldown must still block it.
  store.notifications.push({tenant_id:T1,user_id:'owner-1',kind:'phone_connect_reask',dedupe_key:'phone_connect_reask:2026-09',created_at:'2026-09-20T16:00:00.000Z'});
  expect(await evaluateDayOneReasks(env,ctx(T1))).toEqual([]);
  // Fired 40 days ago: cooldown expired, the re-ask may fire again.
  store.notifications[0].created_at='2026-08-29T16:00:00.000Z';
  const candidates=await evaluateDayOneReasks(env,ctx(T1));
  expect(candidates.map(c=>c.kind)).toEqual(['phone_connect_reask']);
 });
});

describe('hours check (item 3, profile-side only)',()=>{
 it('fires when a named business has no hours anywhere',async()=>{
  const {env,store}=mockServer();
  store.profiles.set(T1,{name:'Glow Studio'}); // no hours, no missed calls
  const result=await runDayOneReasks(env,ctx(T1),surface);
  expect(result).toEqual({fired:1,kinds:['profile_hours_missing']});
  expect(store.notifications[0]).toMatchObject({kind:'profile_hours_missing',dedupe_key:'profile_hours_missing:2026-10'});
 });
 it('fires when a policy exists but its weekly hours are empty',async()=>{
  const {env,store}=mockServer();
  store.profiles.set(T1,{name:'Glow Studio'});
  const candidates=await evaluateDayOneReasks(env,ctx(T1,{policy:policyEmptyHours}));
  expect(candidates.map(c=>c.kind)).toEqual(['profile_hours_missing']);
 });
 it('stays silent when hours are set — in profile text or in the policy',async()=>{
  const {env,store}=mockServer();baseTenant(store,T1);
  expect(await evaluateDayOneReasks(env,ctx(T1))).toEqual([]);
  store.profiles.set(T1,{name:'Glow Studio'}); // text gone, policy carries hours
  expect(await evaluateDayOneReasks(env,ctx(T1,{policy:policyWithHours}))).toEqual([]);
 });
 it('stays silent for a tenant with no profile yet (onboarding owns that nudge)',async()=>{
  const {env}=mockServer();
  expect(await evaluateDayOneReasks(env,ctx(T1))).toEqual([]);
 });
});

describe('gates are respected (shared surfaceGate)',()=>{
 it('quiet hours: nothing fires, nothing is logged',async()=>{
  const {env,store}=mockServer();baseTenant(store,T1);
  store.profiles.set(T1,{name:'Glow Studio'}); // hours candidate too
  store.missed.push({tenant_id:T1,occurred_at:new Date(QUIET-3600000).toISOString()});
  const result=await runDayOneReasks(env,ctx(T1,{nowMs:QUIET}),surface);
  expect(result.fired).toBe(0);
  expect(store.notifications).toHaveLength(0);
  expect(store.nudgeLog).toHaveLength(0);
 });
 it('daily cap: a full cap blocks re-asks entirely',async()=>{
  const {env,store}=mockServer();baseTenant(store,T1);
  store.missed.push({tenant_id:T1,occurred_at:new Date(NOW-3600000).toISOString()});
  for(let i=0;i<3;i++)store.nudgeLog.push({tenant_id:T1,kind:'suggestion',day_key:'2026-10-08'});
  const result=await runDayOneReasks(env,ctx(T1),surface);
  expect(result.fired).toBe(0);
  expect(store.notifications).toHaveLength(0);
 });
 it('daily cap: re-asks share the cap with cards — one slot left, one fires',async()=>{
  const {env,store}=mockServer();
  store.profiles.set(T1,{name:'Glow Studio'}); // hours candidate
  store.missed.push({tenant_id:T1,occurred_at:new Date(NOW-3600000).toISOString()}); // phone candidate
  for(let i=0;i<2;i++)store.nudgeLog.push({tenant_id:T1,kind:'suggestion',day_key:'2026-10-08'});
  const result=await runDayOneReasks(env,ctx(T1),surface);
  expect(result.fired).toBe(1);
  expect(store.nudgeLog).toHaveLength(3);
 });
 it('tenant isolation: evidence under another tenant never fires here',async()=>{
  const {env,store}=mockServer();baseTenant(store,T1);baseTenant(store,T2);
  store.missed.push({tenant_id:T2,occurred_at:new Date(NOW-3600000).toISOString()});
  expect((await runDayOneReasks(env,ctx(T1),surface)).fired).toBe(0);
  expect((await runDayOneReasks(env,ctx(T2),surface)).fired).toBe(1);
  expect(store.notifications.every(n=>n.tenant_id===T2)).toBe(true);
 });
});
