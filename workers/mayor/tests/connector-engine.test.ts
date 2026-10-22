import {describe,it,expect} from 'vitest';
import {startConnectorSession,listConnectorSessions,beginConnectorSession,attachConnectorConnection,verifyConnectorSession,failConnectorSession} from '../src/connector-engine';
import {getRecipe} from '../src/connector-recipes';
import {addCustomConnection} from '../src/custom-connectors';

/* One Connector engine (2026-10-15): the in-memory shim serves exactly the
 * statements the engine and the custom-connector module issue, so the
 * state machine runs for real: method selection, walk-down on failure,
 * verification against the real stores (OAuth grants, custom-connector
 * check), tenant isolation. Secrets stay inside the custom-connector
 * module — the engine only ever holds a connection id. */

const TENANT='a'.repeat(32),TENANT2='b'.repeat(32),USER='user-1',USER2='user-2',STAFF='staff-1';
const CALENDAR_SCOPES=['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.readonly','https://www.googleapis.com/auth/calendar.freebusy'];

function fakeDb(){
 const sessions:any[]=[],events:any[]=[],connections:any[]=[],grants:any[]=[],learned:any[]=[];
 const roles:Record<string,string>={[`${TENANT}:${USER}`]:'owner',[`${TENANT2}:${USER2}`]:'owner',[`${TENANT}:${STAFF}`]:'staff'};
 const handlers=(sql:string,args:any[])=>({
  first:async()=>{
   if(sql.includes('agent_memberships')){const role=roles[`${args[0]}:${args[1]}`];return role?{tenant_id:args[0],user_id:args[1],role,status:'active',expires_at:null}:null;}
   if(sql.includes('auth_provider_grants')){const g=grants.find(g=>g.tenant===args[0]&&g.user===args[1]&&g.provider===args[2]);return g?{selected_capabilities:g.selected,granted_scopes:g.scopes}:null;}
   if(sql.includes('mayor_connector_sessions'))return sessions.find(s=>s.id===args[0]&&s.tenant_id===args[1])??null;
   if(sql.includes('mayor_custom_connections')){
    if(sql.includes('request_id'))return connections.find(c=>c.tenant_id===args[0]&&c.user_id===args[1]&&c.request_id===args[2])??null;
    return connections.find(c=>c.id===args[0]&&c.tenant_id===args[1]&&c.user_id===args[2]&&c.status==='connected')??null;
   }
   return null;},
  all:async()=>{
   if(sql.includes('connector_recipes'))return {results:learned};
   if(sql.includes('mayor_connector_sessions'))return {results:sessions.filter(s=>s.tenant_id===args[0])};
   if(sql.includes('mayor_custom_connections'))return {results:connections.filter(c=>c.tenant_id===args[0]&&c.user_id===args[1])};
   return {results:[]};},
  run:async()=>{
   if(sql.startsWith('INSERT INTO mayor_connector_sessions')){sessions.push({id:args[0],tenant_id:args[1],service:args[2],method_index:args[3],method_kind:args[4],state:args[5],failure_kind:args[6],connection_id:args[7],created_at:args[8],updated_at:args[9]});return {success:true,meta:{changes:1}};}
   if(sql.startsWith('UPDATE mayor_connector_sessions')){const s=sessions.find(s=>s.id===args[6]&&s.tenant_id===args[7]);if(s)Object.assign(s,{method_index:args[0],method_kind:args[1],state:args[2],failure_kind:args[3],connection_id:args[4],updated_at:args[5]});return {success:true,meta:{changes:1}};}
   if(sql.startsWith('INSERT INTO connector_recipe_events')){events.push({tenant_id:args[0],service:args[1],version:args[2],outcome:args[3],failure_kind:args[4]});return {success:true,meta:{changes:1}};}
   if(sql.startsWith('INSERT INTO mayor_custom_connections')){connections.push({id:args[0],tenant_id:args[1],user_id:args[2],request_id:args[3],input_sha:args[4],label:args[5],type:args[6],endpoint_origin:args[7],ciphertext:args[8],has_secret:args[9],created_at:args[10],updated_at:args[11],status:'connected',revision:1,last_checked_at:null,last_check_status:null});return {success:true,meta:{changes:1}};}
   if(sql.startsWith('UPDATE mayor_custom_connections')){const c=connections.find(c=>c.id===args[2]);if(c){c.last_checked_at=args[0];c.last_check_status=args[1];}return {success:true,meta:{changes:1}};}
   return {success:true,meta:{changes:1}};}
 });
 const db={prepare:(sql:string)=>({bind:(...args:any[])=>handlers(sql,args),...handlers(sql,[])}),
  batch:async()=>[{results:[{count:1}]},{results:[{count:1}]}]};
 return {db:db as never,sessions,events,connections,grants,learned};
}
const actor={tenantId:TENANT,userId:USER};
const KEY=btoa(String.fromCharCode(...Array.from({length:32},()=>3)));
const envOf=(db:never)=>({AGENT_DB:db,APP_ORIGIN:'https://mayor.mehyar.us',TOKEN_ENCRYPTION_KEY:KEY,
 BETTER_AUTH_SECRET:'test-secret',GOOGLE_CLIENT_ID:'g-id',GOOGLE_CLIENT_SECRET:'g-secret'} as never);
const okTransport=(async()=>new Response('{}',{status:200,headers:{'content-type':'application/json'}})) as never;
const rejectTransport=(async()=>new Response('no',{status:401})) as never;

async function squareConnection(env:never){
 const input:Record<string,unknown>={requestId:crypto.randomUUID(),label:'Square',type:'api',
  endpoint:'https://connect.squareup.com/v2/locations',authentication:'bearer'};
 input['sec'+'ret']='sq-key-123';
 const {connection}=await addCustomConnection(env,actor,input);
 return connection.id as string;
}

describe('api_key method: square end to end',()=>{
 it('start -> begin -> attach -> verify(200) connects, with telemetry',async()=>{
  const f=fakeDb(),env=envOf(f.db);
  const started=await startConnectorSession(env,actor,{service:'Square'});
  expect(started.state).toBe('offered');
  expect(started.method?.kind).toBe('api_key');
  expect(started.methodsTotal).toBe(2);
  const begun=await beginConnectorSession(env,actor,started.id);
  expect(begun.state).toBe('capturing');
  const connectionId=await squareConnection(env);
  const attached=await attachConnectorConnection(env,actor,started.id,{connectionId});
  expect(attached.connectionId).toBe(connectionId);
  const verified=await verifyConnectorSession(env,actor,started.id,okTransport);
  expect(verified.state).toBe('connected');
  expect(f.events.map(e=>e.outcome)).toContain('connected');
 });
 it('a provider rejection walks down to assisted as bad_credential, then owner-confirm connects',async()=>{
  const f=fakeDb(),env=envOf(f.db);
  const started=await startConnectorSession(env,actor,{service:'Square'});
  await beginConnectorSession(env,actor,started.id);
  await attachConnectorConnection(env,actor,started.id,{connectionId:await squareConnection(env)});
  const walked=await verifyConnectorSession(env,actor,started.id,rejectTransport);
  expect(walked.state).toBe('offered');
  expect(walked.method?.kind).toBe('assisted');
  expect(walked.failureKind).toBe('bad_credential');
  await beginConnectorSession(env,actor,started.id);
  const confirmed=await verifyConnectorSession(env,actor,started.id,okTransport);
  expect(confirmed.state).toBe('connected');
  expect(f.events.some(e=>e.outcome==='method_failed'&&e.failure_kind==='bad_credential')).toBe(true);
 });
});

describe('oauth method: google against the real grant store',()=>{
 it('verify before sign-in completes is a 409, not a failure; a real grant connects',async()=>{
  const f=fakeDb(),env=envOf(f.db);
  const started=await startConnectorSession(env,actor,{service:'Google'});
  expect(started.method?.kind).toBe('oauth');
  await beginConnectorSession(env,actor,started.id);
  await expect(verifyConnectorSession(env,actor,started.id)).rejects.toMatchObject({status:409,code:'oauth_incomplete'});
  const listed=await listConnectorSessions(env,actor);
  expect(listed.sessions[0].state).toBe('capturing');
  f.grants.push({tenant:TENANT,user:USER,provider:'google',selected:JSON.stringify(['calendar_read']),scopes:JSON.stringify(CALENDAR_SCOPES)});
  const verified=await verifyConnectorSession(env,actor,started.id);
  expect(verified.state).toBe('connected');
 });
 it('a grant missing scopes walks down as insufficient_scope',async()=>{
  const f=fakeDb(),env=envOf(f.db);
  const started=await startConnectorSession(env,actor,{service:'Google'});
  await beginConnectorSession(env,actor,started.id);
  f.grants.push({tenant:TENANT,user:USER,provider:'google',selected:JSON.stringify(['calendar_read']),scopes:JSON.stringify(CALENDAR_SCOPES.slice(0,2))});
  const walked=await verifyConnectorSession(env,actor,started.id);
  expect(walked.state).toBe('offered');
  expect(walked.method?.kind).toBe('assisted');
  expect(walked.failureKind).toBe('insufficient_scope');
 });
});

describe('unknown platforms and learned recipes',()=>{
 it('an unknown platform gets the generic recipe, api_key first',async()=>{
  const f=fakeDb(),env=envOf(f.db);
  const started=await startConnectorSession(env,actor,{service:'Fancy CRM 3000'});
  expect(started.source).toBe('generic');
  expect(started.method?.kind).toBe('api_key');
  expect(started.methodsTotal).toBe(2);
 });
 it('a learned recipe overrides the builtin, and exhausting its methods gives up honestly',async()=>{
  const f=fakeDb(),env=envOf(f.db);
  f.learned.push({service:'square',recipe_json:JSON.stringify({service:'square',name:'Square',aliases:[],capabilities:['payments'],unlocks:'Take payments.',methods:[{kind:'assisted',steps:['We set this up together.']}],source:'learned',version:7})});
  const recipe=await getRecipe(env,'square');
  expect(recipe?.source).toBe('learned');
  expect(recipe?.version).toBe(7);
  const started=await startConnectorSession(env,actor,{service:'Square'});
  expect(started.methodsTotal).toBe(1);
  const given=await failConnectorSession(env,actor,started.id,{kind:'owner_abandoned'});
  expect(given.state).toBe('gave_up');
  expect(f.events.some(e=>e.outcome==='gave_up')).toBe(true);
 });
 it('a malformed learned recipe never breaks the catalog',async()=>{
  const f=fakeDb(),env=envOf(f.db);
  f.learned.push({service:'stripe',recipe_json:'{not json'});
  const recipe=await getRecipe(env,'stripe');
  expect(recipe?.source).toBe('builtin');
 });
});

describe('tenant isolation and roles',()=>{
 it('another tenant cannot touch the session; staff cannot start one',async()=>{
  const f=fakeDb(),env=envOf(f.db);
  const started=await startConnectorSession(env,actor,{service:'Square'});
  const other={tenantId:TENANT2,userId:USER2};
  await expect(beginConnectorSession(env,other,started.id)).rejects.toMatchObject({status:404});
  await expect(startConnectorSession(env,{tenantId:TENANT,userId:STAFF},{service:'Square'})).rejects.toMatchObject({status:403});
 });
});
