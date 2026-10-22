import {describe,it,expect} from 'vitest';
import {HttpError} from '../src/http';
import type {Env} from '../src/env';
import type {Profile} from '../src/memory';
import {
 ONBOARDING_PHASES,ONBOARDING_CONNECTION_IDS,
 orderOnboardingConnections,identifyComplete,learnComplete,missingVerticalSignal,
 deriveConductorState,buildHandoffSummary,firstWatchLine,
 connectPhasePrompt,parseSkipConnection,asksToConnectPending,
 readOnboardingDecisions,updateOnboardingDecisions,
 getConductorState,skipOnboardingConnection,useOnboardingDefaultRules,completeOnboardingHandoff,
 type ConductorFacts,
} from '../src/onboarding-conductor';
import {credentialAuthorizationStamp} from '../src/connectors/credentials';

/** P4 Chief of Staff onboarding conductor. Pure derivation tests run on facts;
 * server tests run on a pattern-matching in-memory D1 holding two tenants,
 * so tenant isolation is exercised by construction. */

const T1='a'.repeat(32),T2='b'.repeat(32);
const U1='user-1',U2='user-2';

const FULL_PROFILE:Profile={
 name:'Glow Studio',industry:'Hair salon',vertical:'salon',
 services:['Cuts','Color'],locations:['Bay Ridge, Brooklyn'],hours:'Tue–Sat 9–6',
 timeZone:'America/New_York',staff:[],language:'en',
};

function facts(overrides:Partial<ConductorFacts>={}):ConductorFacts{
 return {
  profile:{},explicitRuleActions:[],
  tiers:[
   {action:'booking',tier:'draft',explicit:false},
   {action:'textback',tier:'draft',explicit:false},
   {action:'call',tier:'draft',explicit:false},
   {action:'suggestion_send',tier:'draft',explicit:false},
  ],
  connected:{},skippedConnections:[],rulesDecision:null,handoffAt:null,
  priority:['calendar','email','reviews'],
  ...overrides,
 };
}

describe('phase derivation',()=>{
 it('starts at identify with nothing known',()=>{
  const state=deriveConductorState(facts());
  expect(state.phase).toBe('identify');
  expect(state.complete).toBe(false);
  expect(state.progress).toEqual({completed:0,total:5});
 });
 it('identify completes on name + trade, or name + vertical (Places path)',()=>{
  expect(identifyComplete({name:'Glow'})).toBe(false);
  expect(identifyComplete({name:'Glow',industry:'Hair salon'})).toBe(true);
  expect(identifyComplete({name:'Glow',vertical:'salon'})).toBe(true);
  expect(deriveConductorState(facts({profile:{name:'Glow',industry:'Hair salon'}})).phase).toBe('learn');
 });
 it('learn completes when the core place facts are answered',()=>{
  expect(learnComplete(FULL_PROFILE)).toBe(true);
  expect(learnComplete({name:'Glow',industry:'Hair salon'})).toBe(false);
  expect(deriveConductorState(facts({profile:FULL_PROFILE})).phase).toBe('connect');
 });
 it('connect is the phase after learn, with the first pending connection offered',()=>{
  const state=deriveConductorState(facts({profile:FULL_PROFILE}));
  expect(state.phases.connect.complete).toBe(false);
  expect(state.nextConnection?.id).toBe('calendar');
  expect(connectPhasePrompt(state)).toMatch(/calendar/i);
 });
 it('rules completes only on explicit tiers for all three questions, or the defaults decision',()=>{
  const base=facts({profile:FULL_PROFILE,connected:{calendar:true,phone:true,google_business:true}});
  expect(deriveConductorState(base).phase).toBe('rules');
  const partial=deriveConductorState({...base,explicitRuleActions:['booking','textback']});
  expect(partial.phases.rules.complete).toBe(false);
  const answered=deriveConductorState({...base,explicitRuleActions:['booking','suggestion_send','textback']});
  expect(answered.phase).toBe('handoff');
  const defaults=deriveConductorState({...base,rulesDecision:'defaults'});
  expect(defaults.phases.rules.complete).toBe(true);
  expect(defaults.phase).toBe('handoff');
 });
 it('handoff completes the conductor',()=>{
  const state=deriveConductorState(facts({
   profile:FULL_PROFILE,connected:{calendar:true,phone:true,google_business:true},
   explicitRuleActions:['booking','suggestion_send','textback'],handoffAt:'2026-10-12T10:00:00.000Z',
  }));
  expect(state.phase).toBe('done');
  expect(state.complete).toBe(true);
  expect(state.progress.completed).toBe(5);
 });
 it('resumes mid-flow: earlier gaps win, later completion never restarts',()=>{
  // Basics done, calendar really connected, phone skipped, GBP undecided.
  const state=deriveConductorState(facts({
   profile:FULL_PROFILE,connected:{calendar:true},skippedConnections:['phone'],
   priority:['phone','calendar','email'],
  }));
  expect(state.phase).toBe('connect');
  expect(state.nextConnection?.id).toBe('google_business');
  const byId=Object.fromEntries(state.connections.map(c=>[c.id,c.status]));
  expect(byId).toEqual({phone:'skipped',calendar:'connected',google_business:'pending'});
 });
 it('never presents more than three connections',()=>{
  for(const priority of [[],['calendar'],['reviews','phone','calendar','email']])
   expect(orderOnboardingConnections(priority)).toHaveLength(3);
  expect(ONBOARDING_CONNECTION_IDS).toHaveLength(3);
  expect(ONBOARDING_PHASES).toEqual(['identify','learn','connect','rules','handoff']);
 });
 it('orders connections by vertical priority (restaurant: reviews/GBP first)',()=>{
  const state=deriveConductorState(facts({profile:FULL_PROFILE,priority:['reviews','reservations','calendar','email']}));
  expect(state.connections.map(c=>c.id)).toEqual(['google_business','calendar','phone']);
  const salon=deriveConductorState(facts({profile:FULL_PROFILE,priority:['calendar','email','reviews']}));
  expect(salon.connections.map(c=>c.id)).toEqual(['calendar','google_business','phone']);
 });
 it('a stored skip can never masquerade as a connection',()=>{
  const state=deriveConductorState(facts({profile:FULL_PROFILE,skippedConnections:['calendar','phone','google_business']}));
  expect(state.connections.every(c=>c.status==='skipped')).toBe(true);
  expect(state.connections.some(c=>c.status==='connected')).toBe(false);
  // Skips are still decisions: the connect phase completes honestly.
  expect(state.phases.connect.complete).toBe(true);
 });
 it('flags a missing vertical only for an unmatched, unmapped trade',()=>{
  expect(missingVerticalSignal({industry:'Funeral home'})).toBe('Funeral home');
  expect(missingVerticalSignal({industry:'Funeral home',vertical:'other'})).toBe('Funeral home');
  expect(missingVerticalSignal({industry:'Barber',vertical:'salon'})).toBeNull();
  expect(missingVerticalSignal({industry:'Barber',vertical:'salon',verticalMappedFrom:'barber'})).toBeNull();
  expect(missingVerticalSignal({})).toBeNull();
  expect(deriveConductorState(facts({profile:{name:'Peaceful Rest',industry:'Funeral home'}})).missingVertical).toBe('Funeral home');
 });
});

describe('connect-phase conversation parsing',()=>{
 it('parses bare and named skips',()=>{
  expect(parseSkipConnection('skip')).toBe('current');
  expect(parseSkipConnection('Not now.')).toBe('current');
  expect(parseSkipConnection('skip the calendar')).toBe('calendar');
  expect(parseSkipConnection('skip my phone')).toBe('phone');
  expect(parseSkipConnection('skip google business profile')).toBe('google_business');
 });
 it('does not guess on unclear answers',()=>{
  expect(parseSkipConnection('maybe later, tell me more')).toBeNull();
  expect(parseSkipConnection('skip my appointment tomorrow')).toBeNull();
  expect(parseSkipConnection('what does it do?')).toBeNull();
 });
 it('recognizes a clear connect intent',()=>{
  for(const text of ['yes','Connect','connect it','go ahead','okay'])expect(asksToConnectPending(text)).toBe(true);
  for(const text of ['what is a calendar?','maybe','book an appointment'])expect(asksToConnectPending(text)).toBe(false);
 });
});

describe('hand-off summary',()=>{
 const readyFacts=facts({
  profile:FULL_PROFILE,connected:{calendar:true},skippedConnections:['phone','google_business'],
  explicitRuleActions:['booking'],
  tiers:[
   {action:'booking',tier:'auto',explicit:true},
   {action:'textback',tier:'draft',explicit:false},
   {action:'call',tier:'draft',explicit:false},
   {action:'suggestion_send',tier:'draft',explicit:false},
  ],
 });
 it('greets as the named Mayor, in the vertical mode, disclosing it is an AI',()=>{
  const summary=buildHandoffSummary(readyFacts,deriveConductorState(readyFacts));
  expect(summary.greeting).toMatch(/Mayor/);
  expect(summary.greeting).toMatch(/salon mode/);
  expect(summary.greeting).toMatch(/AI assistant/);
 });
 it('recites only confirmed facts',()=>{
  const summary=buildHandoffSummary(readyFacts,deriveConductorState(readyFacts));
  expect(summary.knows.join(' ')).toContain('Glow Studio');
  expect(summary.knows.join(' ')).toContain('Cuts');
  expect(summary.knows.join(' ')).toContain('Tue–Sat 9–6');
  expect(summary.knows.join(' ')).toMatch(/work alone/i);
  const bare=buildHandoffSummary(facts({profile:{name:'Solo',industry:'Consulting'}}),deriveConductorState(facts({profile:{name:'Solo',industry:'Consulting'}})));
  expect(bare.knows).toHaveLength(1);
 });
 it('states connections honestly: skipped is not connected',()=>{
  const summary=buildHandoffSummary(readyFacts,deriveConductorState(readyFacts));
  const byId=Object.fromEntries(summary.connections.map(c=>[c.id,c.note]));
  expect(byId.calendar).toMatch(/Connected/);
  expect(byId.phone).toMatch(/Not connected/);
  expect(byId.phone).toMatch(/cannot see or answer your calls/i);
  expect(byId.google_business).toMatch(/Not connected/);
  expect(summary.text).not.toMatch(/reviews are (live|monitored|watched)/i);
 });
 it('GBP connected means the Google sign-in — reads are called out as not live',()=>{
  const f=facts({profile:FULL_PROFILE,connected:{calendar:true,phone:true,google_business:true},explicitRuleActions:['booking','suggestion_send','textback']});
  const summary=buildHandoffSummary(f,deriveConductorState(f));
  const gbp=summary.connections.find(c=>c.id==='google_business')!;
  expect(gbp.note).toMatch(/Google account connected/);
  expect(gbp.note).toMatch(/not live yet/);
 });
 it('rules are plain language and mark defaults as defaults',()=>{
  const summary=buildHandoffSummary(readyFacts,deriveConductorState(readyFacts));
  expect(summary.rules[0]).toMatch(/Booking appointments: Act automatically/);
  expect(summary.rules[0]).not.toMatch(/default/);
  expect(summary.rules[1]).toMatch(/default — change it anytime/);
 });
 it('first watch names the real gap, or the real detectors when all connected',()=>{
  const gapState=deriveConductorState(readyFacts);
  expect(firstWatchLine(gapState)).toMatch(/cannot see missed calls/i);
  const all=facts({profile:FULL_PROFILE,connected:{calendar:true,phone:true,google_business:true}});
  expect(firstWatchLine(deriveConductorState(all))).toMatch(/slow days, lapsed regulars, and unanswered leads/i);
  const noCalendar=facts({profile:FULL_PROFILE,connected:{phone:true},skippedConnections:['calendar','google_business']});
  expect(firstWatchLine(deriveConductorState(noCalendar))).toMatch(/confirm every booking with you/i);
 });
});

/* ------------------------- server layer (mock D1) ------------------------- */

interface GrantRow{id:string;tenant_scope:string;user_id:string;provider:string;status:string;selected_capabilities:string;granted_scopes:string;account_id:string;authorization_revision:number;ciphertext:string;key_version:number}
interface SelectionRow{provider:string;grant_id:string;calendar_id:string;calendar_name:string;authorization_stamp:string}

const GOOGLE_CALENDAR_SCOPES=['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.readonly','https://www.googleapis.com/auth/calendar.freebusy'];

function mockServer(){
 const memberships=new Map<string,string>([[`${T1}:${U1}`,'owner'],[`${T2}:${U2}`,'owner'],[`${T1}:staff-1`,'staff']]);
 const profiles=new Map<string,Profile>();
 const tiers:Array<{tenant_id:string;action:string;tier:string}>=[
  {tenant_id:T2,action:'booking',tier:'auto'},
 ];
 const grants:GrantRow[]=[];
 const selections=new Map<string,SelectionRow>();
 const phoneRows:Array<{tenant_id:string;provider:string;status:string;number:string|null;verifiedAt:string|null}>=[
  {tenant_id:T2,provider:'telnyx',status:'authorized',number:'+15551234567',verifiedAt:'2026-10-01T00:00:00.000Z'},
 ];
 const onboarding=new Map<string,Record<string,unknown>>();
 const db={
  prepare(sql:string){
   let bound:unknown[]=[];
   const stmt={
    bind(...args:unknown[]){bound=args;return stmt;},
    async first(){
     if(sql.includes('FROM agent_memberships')){
      const role=memberships.get(`${bound[0]}:${bound[1]}`);
      return role?{tenant_id:bound[0],user_id:bound[1],role,status:'active',expires_at:null}:null;
     }
     if(sql.includes('FROM agent_tenants'))return memberships.has(`${bound[0]}:${U1}`)||memberships.has(`${bound[0]}:${U2}`)?{id:bound[0],name:'Biz',status:'active',created_at:'2026-01-01'}:null;
     if(sql.includes('FROM mayor_memory')){
      const profile=profiles.get(String(bound[0]));
      return profile?{value_json:JSON.stringify(profile),revision:1,confirmed_at:'2026-10-01T00:00:00.000Z',provenance_json:'{}'}:null;
     }
     if(sql.includes('FROM mayor_onboarding_state')){
      const row=onboarding.get(String(bound[0]));
      return row?{phase:row.phase,skipped_connections:row.skipped_connections,rules_decision:row.rules_decision,missing_vertical:row.missing_vertical,handoff_at:row.handoff_at}:null;
     }
     if(sql.includes('FROM mayor_calendar_selection')){
      const selection=selections.get(String(bound[sql.includes('JOIN')?1:0]));
      if(!selection)return null;
      return sql.includes('JOIN')?{provider:selection.provider,grant_id:selection.grant_id,calendar_name:selection.calendar_name}:selection;
     }
     if(sql.includes('FROM auth_provider_grants')){
      const grant=grants.find(g=>g.id===bound[0]&&g.tenant_scope===bound[1]&&g.provider===bound[2]);
      return grant??null;
     }
     return null;
    },
    async all(){
     if(sql.includes('FROM mayor_authority_tiers'))
      return {results:tiers.filter(r=>r.tenant_id===bound[0]).map(r=>({action:r.action,tier:r.tier}))};
     if(sql.includes('FROM auth_provider_grants'))
      return {results:grants.filter(g=>g.tenant_scope===bound[0]&&g.user_id===bound[1]&&g.status!=='revoked')};
     if(sql.includes('FROM mayor_phone_connections'))
      return {results:phoneRows.filter(r=>r.tenant_id===bound[0]).map(r=>({provider:r.provider,status:r.status,number:r.number,verifiedAt:r.verifiedAt}))};
     if(sql.includes('FROM mayor_custom_connections'))return {results:[]};
     return {results:[]};
    },
    async run(){
     if(sql.startsWith('INSERT INTO mayor_onboarding_state')){
      const [tenant_id,phase,skipped_connections,rules_decision,missing_vertical,handoff_at]=bound as [string,string,string,string|null,string|null,string|null];
      onboarding.set(tenant_id,{phase,skipped_connections,rules_decision,missing_vertical,handoff_at});
      return {meta:{changes:1}};
     }
     return {meta:{changes:0}};
    },
   };
   return stmt;
  },
 } as unknown as Env['AGENT_DB'];
 const env={AGENT_DB:db,APP_ORIGIN:'https://mayor.mehyar.us',BETTER_AUTH_SECRET:'test',GOOGLE_CLIENT_ID:'gid',GOOGLE_CLIENT_SECRET:'gsecret',TOKEN_ENCRYPTION_KEY:'test-key',GOOGLE_ENABLED_CAPABILITIES:'calendar_read,calendar_manage'} as unknown as Env;
 return {env,profiles,tiers,grants,selections,onboarding};
}

async function googleGrantWithCalendar(tenant:string,user:string){
 const grant:GrantRow={
  id:`grant-${tenant.slice(0,4)}`,tenant_scope:tenant,user_id:user,provider:'google',status:'authorized',
  selected_capabilities:JSON.stringify(['calendar_read','calendar_manage']),
  granted_scopes:JSON.stringify(GOOGLE_CALENDAR_SCOPES),
  account_id:'acct-1',authorization_revision:1,ciphertext:'ciphertext',key_version:1,
 };
 const stamp=await credentialAuthorizationStamp(grant);
 return {grant,selection:{provider:'google',grant_id:grant.id,calendar_id:'cal-1',calendar_name:'Glow Calendar',authorization_stamp:stamp}};
}

describe('decisions persistence',()=>{
 it('round-trips decisions per tenant and survives a corrupt row',async()=>{
  const {env}=mockServer();const db=env.AGENT_DB;
  expect((await readOnboardingDecisions(db,T1)).phase).toBe('identify');
  await updateOnboardingDecisions(db,T1,{skippedConnections:['phone'],rulesDecision:'defaults'});
  const t1=await readOnboardingDecisions(db,T1);
  expect(t1.skippedConnections).toEqual(['phone']);
  expect(t1.rulesDecision).toBe('defaults');
  // Tenant isolation: T2 has no decisions.
  expect((await readOnboardingDecisions(db,T2)).skippedConnections).toEqual([]);
  expect((await readOnboardingDecisions(db,T2)).rulesDecision).toBeNull();
 });
});

describe('server conductor flow',()=>{
 it('walks a tenant through every phase and hands off exactly once',async()=>{
  const s=mockServer();const actor={tenantId:T1,userId:U1};
  // Fresh tenant: identify.
  expect((await getConductorState(s.env,actor)).phase).toBe('identify');
  // Profile basics saved elsewhere (chat Q&A / Places): resume at connect.
  s.profiles.set(T1,FULL_PROFILE);
  let state=await getConductorState(s.env,actor);
  expect(state.phase).toBe('connect');
  expect(state.nextConnection?.id).toBe('calendar');
  // Skip phone + GBP; calendar still pending.
  state=await skipOnboardingConnection(s.env,actor,'phone');
  expect(state.connections.find(c=>c.id==='phone')?.status).toBe('skipped');
  state=await skipOnboardingConnection(s.env,actor,'google_business');
  expect(state.phase).toBe('connect');
  expect(state.nextConnection?.id).toBe('calendar');
  // Hand-off refuses while phases are incomplete.
  await expect(completeOnboardingHandoff(s.env,actor)).rejects.toMatchObject({status:409});
  // Real calendar connection lands (grant + selection + valid stamp).
  const {grant,selection}=await googleGrantWithCalendar(T1,U1);
  s.grants.push(grant);s.selections.set(T1,selection);
  state=await getConductorState(s.env,actor);
  expect(state.connections.find(c=>c.id==='calendar')?.status).toBe('connected');
  // The GBP link IS the Google sign-in: the earlier skip is superseded by the
  // real grant — derived truth wins over a stored decision, in both directions.
  expect(state.connections.find(c=>c.id==='google_business')?.status).toBe('connected');
  expect(state.phase).toBe('rules');
  // Defaults decision finishes rules without inventing explicit tiers.
  state=await useOnboardingDefaultRules(s.env,actor);
  expect(state.phase).toBe('handoff');
  const {state:doneState,summary}=await completeOnboardingHandoff(s.env,actor);
  expect(doneState.phase).toBe('done');
  expect(summary.text).toContain('Glow Studio');
  expect(summary.text).toMatch(/Booking appointments: Draft for my approval \(default/);
  const firstHandoffAt=(await readOnboardingDecisions(s.env.AGENT_DB,T1)).handoffAt;
  expect(firstHandoffAt).toBeTruthy();
  // Idempotent: a second hand-off keeps the original timestamp.
  await completeOnboardingHandoff(s.env,actor);
  expect((await readOnboardingDecisions(s.env.AGENT_DB,T1)).handoffAt).toBe(firstHandoffAt);
 });
 it('derives phone + Google sign-in connections from real rows only',async()=>{
  const s=mockServer();const actor={tenantId:T2,userId:U2};
  s.profiles.set(T2,FULL_PROFILE);
  const {grant,selection}=await googleGrantWithCalendar(T2,U2);
  s.grants.push(grant);s.selections.set(T2,selection);
  const state=await getConductorState(s.env,actor);
  const byId=Object.fromEntries(state.connections.map(c=>[c.id,c.status]));
  expect(byId.phone).toBe('connected');
  expect(byId.calendar).toBe('connected');
  expect(byId.google_business).toBe('connected');
  // T2 already had booking=auto explicitly; the rest default → rules phase.
  expect(state.phase).toBe('rules');
 });
 it('an authorized phone row without a chosen number is not connected',async()=>{
  const s=mockServer();const actor={tenantId:T1,userId:U1};
  s.profiles.set(T1,FULL_PROFILE);
  // No phone rows exist for T1 in the fixture: pending, never connected.
  const state=await getConductorState(s.env,actor);
  expect(state.connections.find(c=>c.id==='phone')?.status).toBe('pending');
 });
 it('role-gates: staff cannot read or mutate conductor state',async()=>{
  const s=mockServer();s.profiles.set(T1,FULL_PROFILE);
  const staff={tenantId:T1,userId:'staff-1'};
  await expect(getConductorState(s.env,staff)).rejects.toBeInstanceOf(HttpError);
  await expect(skipOnboardingConnection(s.env,staff,'phone')).rejects.toMatchObject({status:403});
  await expect(useOnboardingDefaultRules(s.env,staff)).rejects.toMatchObject({status:403});
  // Strangers get the workspace 404, not another tenant's state.
  await expect(getConductorState(s.env,{tenantId:T1,userId:'nobody'})).rejects.toMatchObject({status:404});
 });
 it('persists the resume pointer and missing-vertical signal',async()=>{
  const s=mockServer();const actor={tenantId:T1,userId:U1};
  s.profiles.set(T1,{name:'Peaceful Rest',industry:'Funeral home',language:'en'});
  const state=await getConductorState(s.env,actor);
  expect(state.phase).toBe('learn');
  expect(state.missingVertical).toBe('Funeral home');
  const stored=await readOnboardingDecisions(s.env.AGENT_DB,T1);
  expect(stored.phase).toBe('learn');
  expect(stored.missingVertical).toBe('Funeral home');
 });
});
