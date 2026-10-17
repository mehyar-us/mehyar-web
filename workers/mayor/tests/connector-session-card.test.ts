import {describe,it,expect} from 'vitest';
import {sessionCard,ensureSessionCard,sessionCardFor,type SessionCardView} from '../src/connector-session-card';
import {startConnectorSession,failConnectorSession} from '../src/connector-engine';
import {spaViewForPath} from '../src/public-routes';

/* One Connector P3 (2026-10-15): the conversation renderer. The view-model
 * mapping is pure and pinned here for every state × method; the ensure flow
 * runs against the same in-memory shim style as the engine tests: one live
 * attempt per service, reused across detections, and a failed verify renders
 * as the next method's card (the walk-down made visible). */

const view=(patch:Partial<SessionCardView>):SessionCardView=>({
 id:'11111111-1111-4111-8111-111111111111',service:'square',name:'Square',source:'builtin',
 state:'offered',method:{kind:'api_key',oneClick:false,capture:{label:'Square API key',hint:'In Square, open Apps > API and create a key.'},apiBase:'https://connect.squareup.com'},
 methodIndex:0,methodsTotal:2,failureKind:null,connectionId:null,
 unlocks:'See your Square sales in The Mayor.',platformGate:null,firstAttempt:false,...patch,
});

describe('sessionCard view-model',()=>{
 it('renders an api_key session as a credential card carrying the session id',()=>{
  const card=sessionCard(view({}));
  expect(card.kind).toBe('credential');
  expect(card.sessionId).toBe(view({}).id);
  expect(card.sessionState).toBe('offered');
  expect(card.endpoint).toBe('https://connect.squareup.com');
  expect(card.guide?.steps[0]).toContain('create a key');
  expect(card.actions.map(a=>a.id)).toContain('enter_key');
  expect(card.body).toContain('never appears in this chat');
 });
 it('renders a one-click oauth session as an oauth card',()=>{
  const card=sessionCard(view({method:{kind:'oauth',provider:'google',oneClick:true}}));
  expect(card.kind).toBe('oauth');
  expect(card.actions[0]).toMatchObject({id:'connect_oauth',provider:'google'});
  expect(card.body).toContain('One tap');
 });
 it('renders an unconfigured oauth session honestly instead of offering a dead button',()=>{
  const card=sessionCard(view({method:{kind:'oauth',provider:'google',oneClick:false}}));
  expect(card.kind).toBe('status');
  expect(card.actions.map(a=>a.id)).not.toContain('connect_oauth');
  expect(card.body).toContain('not set up');
 });
 it('renders an assisted session as a guide card with a confirm action',()=>{
  const card=sessionCard(view({method:{kind:'assisted',oneClick:false,steps:['Open Booksy','Tap export'],note:'Takes a day.'}}));
  expect(card.kind).toBe('guide');
  expect(card.guide?.steps).toHaveLength(2);
  expect(card.actions.map(a=>a.id)).toContain('confirm_done');
 });
 it('labels a first attempt on a learned platform',()=>{
  const card=sessionCard(view({firstAttempt:true,source:'learned'}));
  expect(card.body.startsWith('First time connecting Square')).toBe(true);
 });
 it('appends the platform gate note verbatim',()=>{
  const card=sessionCard(view({platformGate:'Posting is paused while the app review runs.'}));
  expect(card.body).toContain('Note: Posting is paused while the app review runs.');
 });
 it('renders connected and gave_up as status cards with plain words',()=>{
  const ok=sessionCard(view({state:'connected'}));
  expect(ok.kind).toBe('status');expect(ok.title).toContain('is connected');
  const no=sessionCard(view({state:'gave_up',failureKind:'bad_credential'}));
  expect(no.kind).toBe('status');expect(no.body).toContain('was rejected');
  const checking=sessionCard(view({state:'verifying'}));
  expect(checking.title).toContain('Checking');
 });
 it('never carries a secret-shaped value in any state',()=>{
  for(const state of ['offered','capturing','verifying','connected','gave_up'] as const){
   const card=sessionCard(view({state}));
   expect(JSON.stringify(card)).not.toMatch(/sk_live|apiKeyValue|secretValue/);
   expect(Object.keys(card)).not.toContain('secret');
  }
 });
 it('carries the phone handoff only on actionable cards when an origin is given',()=>{
  const origin='https://mayor.mehyar.us';
  const live=sessionCard(view({}),origin);
  expect(live.handoffUrl).toBe(`${origin}/connect/${live.sessionId}`);
  expect(live.actions.map(a=>a.id)).toContain('phone_handoff');
  const done=sessionCard(view({state:'connected'}),origin);
  expect(done.handoffUrl).toBeUndefined();
  expect(done.actions.map(a=>a.id)).not.toContain('phone_handoff');
  const noOrigin=sessionCard(view({}));
  expect(noOrigin.handoffUrl).toBeUndefined();
 });
});

describe('phone handoff deep link',()=>{
 const sid='11111111-1111-4111-8111-111111111111';
 it('routes /connect/<uuid> to the chat view',()=>{
  expect(spaViewForPath(`/connect/${sid}`)).toBe('chat');
 });
 it('does not treat malformed connect paths as app views',()=>{
  expect(spaViewForPath('/connect/')).toBeNull();
  expect(spaViewForPath('/connect/not-a-uuid')).toBeNull();
  expect(spaViewForPath(`/connect/${sid}/extra`)).toBeNull();
  expect(spaViewForPath('/connectors')).toBe('connections');
 });
});

const TENANT='a'.repeat(32),TENANT2='b'.repeat(32),USER='user-1';
function fakeDb(){
 const sessions:any[]=[],events:any[]=[],learned:any[]=[];
 const roles:Record<string,string>={[`${TENANT}:${USER}`]:'owner',[`${TENANT2}:${USER}`]:'owner'};
 const handlers=(sql:string,args:any[])=>({
  first:async()=>{
   if(sql.includes('agent_memberships')){const role=roles[`${args[0]}:${args[1]}`];return role?{tenant_id:args[0],user_id:args[1],role,status:'active',expires_at:null}:null;}
   if(sql.includes('mayor_connector_sessions'))return sessions.find(s=>s.id===args[0]&&s.tenant_id===args[1])??null;
   if(sql.includes('connector_recipes'))return learned.find(r=>r.service===args[0])??null;
   return null;},
  all:async()=>{
   if(sql.includes('connector_recipes'))return {results:learned};
   if(sql.includes('mayor_connector_sessions'))return {results:sessions.filter(s=>s.tenant_id===args[0])};
   return {results:[]};},
  run:async()=>{
   if(sql.startsWith('INSERT INTO mayor_connector_sessions')){sessions.push({id:args[0],tenant_id:args[1],service:args[2],method_index:args[3],method_kind:args[4],state:args[5],failure_kind:args[6],connection_id:args[7],created_at:args[8],updated_at:args[9]});return {success:true,meta:{changes:1}};}
   if(sql.startsWith('UPDATE mayor_connector_sessions')){const s=sessions.find(s=>s.id===args[6]&&s.tenant_id===args[7]);if(s)Object.assign(s,{method_index:args[0],method_kind:args[1],state:args[2],failure_kind:args[3],connection_id:args[4],updated_at:args[5]});return {success:true,meta:{changes:1}};}
   return {success:true,meta:{changes:1}};}
 });
 const db={prepare:(sql:string)=>({bind:(...args:any[])=>handlers(sql,args),...handlers(sql,[])})};
 return {db:db as never,sessions,events,learned};
}
const KEY=btoa(String.fromCharCode(...Array.from({length:32},()=>3)));
const envOf=(db:never)=>({AGENT_DB:db,APP_ORIGIN:'https://mayor.mehyar.us',TOKEN_ENCRYPTION_KEY:KEY,BETTER_AUTH_SECRET:'test-secret-value'}) as never;
const actor={tenantId:TENANT,userId:USER};

describe('ensureSessionCard',()=>{
 it('starts a session and reuses the open attempt for the same service',async()=>{
  const {db,sessions}=fakeDb();const env=envOf(db);
  const first=await ensureSessionCard(env,actor,'square');
  expect(first?.card.kind).toBe('credential');
  expect(sessions).toHaveLength(1);
  const second=await ensureSessionCard(env,actor,'square');
  expect(second?.card.sessionId).toBe(first?.card.sessionId);
  expect(sessions).toHaveLength(1);
 });
 it('renders the walk-down: after a failed api_key attempt the card is the assisted guide',async()=>{
  const {db}=fakeDb();const env=envOf(db);
  const started=await startConnectorSession(env,actor,{service:'square'});
  await failConnectorSession(env,actor,started.id,{kind:'bad_credential'});
  const event=await sessionCardFor(env,actor,started.id);
  expect(event.card.kind).toBe('guide');
  expect(event.card.actions.map(a=>a.id)).toContain('confirm_done');
 });
 it('keeps sessions tenant-isolated through the card route helper',async()=>{
  const {db}=fakeDb();const env=envOf(db);
  const started=await startConnectorSession(env,actor,{service:'square'});
  await expect(sessionCardFor(env,{tenantId:TENANT2,userId:USER},started.id)).rejects.toThrow();
 });
});

describe('door 1: the oauth card carries the capabilities verify will check',()=>{
 it('google calendar+email recipe requests calendar_manage and gmail_read',()=>{
  const card=sessionCard(view({capabilities:['calendar','email'],method:{kind:'oauth',provider:'google',oneClick:true}}));
  expect(card.actions[0]).toMatchObject({id:'connect_oauth',provider:'google',capabilities:['calendar_manage','gmail_read']});
 });
 it('microsoft gets calendar_manage only — gmail_read is not in its catalog',()=>{
  const card=sessionCard(view({capabilities:['calendar','email'],method:{kind:'oauth',provider:'microsoft',oneClick:true}}));
  expect(card.actions[0]).toMatchObject({id:'connect_oauth',provider:'microsoft',capabilities:['calendar_manage']});
 });
 it('zoho calendar recipe requests calendar_manage',()=>{
  const card=sessionCard(view({capabilities:['calendar'],method:{kind:'oauth',provider:'zoho',oneClick:true}}));
  expect(card.actions[0]).toMatchObject({id:'connect_oauth',provider:'zoho',capabilities:['calendar_manage']});
 });
 it('unknown semantic tags are dropped, never invented into scopes',()=>{
  const card=sessionCard(view({capabilities:['payments','social'],method:{kind:'oauth',provider:'google',oneClick:true}}));
  expect(card.actions[0]).toMatchObject({id:'connect_oauth',capabilities:[]});
 });
});
