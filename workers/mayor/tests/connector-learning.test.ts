import {describe,it,expect} from 'vitest';
import {startConnectorSession,beginConnectorSession,attachConnectorConnection,verifyConnectorSession,failConnectorSession} from '../src/connector-engine';
import {getRecipe} from '../src/connector-recipes';
import {addCustomConnection} from '../src/custom-connectors';

/* One Connector Phase 2 — the learning loop (2026-10-15): unknown
 * platforms queue a docs-research request; researched recipes land as
 * DRAFTS and are promoted by the first verified live connection
 * (assisted success never promotes); a learned method that keeps
 * failing demotes itself below the working methods, version bumped;
 * builtins never self-revise. Same in-memory shim discipline as the
 * engine suite, extended for the P2 tables. */

const TENANT='a'.repeat(32),USER='user-1';
const CALENDLY={service:'calendly',name:'Calendly',aliases:['calendly.com'],capabilities:['bookings','calendar'],
 unlocks:'New Calendly bookings land where The Mayor can see them.',
 methods:[{kind:'api_key',capture:{label:'Calendly personal access token',hint:'In Calendly, open Integrations and create a personal access token.'},apiBase:'https://api.calendly.com',verify:{method:'GET',url:'https://api.calendly.com/users/me',auth:'bearer'}},
  {kind:'assisted',steps:['Copy your main Calendly booking link and give it to The Mayor.']}],source:'learned',version:1};
const MULTI={service:'multi-tool',name:'Multi Tool',aliases:[],capabilities:[],unlocks:'Everything in one place.',
 methods:[{kind:'api_key',capture:{label:'API key',hint:'Create a key.'}},
  {kind:'webhook',capture:{label:'Webhook URL',hint:'Point the webhook at The Mayor.'}},
  {kind:'assisted',steps:['We set this up together.']}],source:'learned',version:1};

function fakeDb(){
 const sessions:any[]=[],events:any[]=[],connections:any[]=[],grants:any[]=[],learned:any[]=[],research:any[]=[];
 const roles:Record<string,string>={[`${TENANT}:${USER}`]:'owner'};
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
   if(sql.includes('GROUP BY outcome')){
    const byOutcome:Record<string,number>={};
    for(const e of events)if(e.service===args[0]&&e.version===args[1]&&e.method_kind===args[2]&&(e.outcome==='method_failed'||e.outcome==='connected'))byOutcome[e.outcome]=(byOutcome[e.outcome]??0)+1;
    return {results:Object.entries(byOutcome).map(([outcome,n])=>({outcome,n}))};
   }
   if(sql.includes('connector_recipes'))return {results:learned};
   if(sql.includes('mayor_connector_sessions'))return {results:sessions.filter(s=>s.tenant_id===args[0])};
   if(sql.includes('mayor_custom_connections'))return {results:connections.filter(c=>c.tenant_id===args[0]&&c.user_id===args[1])};
   return {results:[]};},
  run:async()=>{
   if(sql.startsWith('INSERT INTO mayor_connector_sessions')){sessions.push({id:args[0],tenant_id:args[1],service:args[2],method_index:args[3],method_kind:args[4],state:args[5],failure_kind:args[6],connection_id:args[7],created_at:args[8],updated_at:args[9]});return {success:true,meta:{changes:1}};}
   if(sql.startsWith('UPDATE mayor_connector_sessions')){const s=sessions.find(s=>s.id===args[6]&&s.tenant_id===args[7]);if(s)Object.assign(s,{method_index:args[0],method_kind:args[1],state:args[2],failure_kind:args[3],connection_id:args[4],updated_at:args[5]});return {success:true,meta:{changes:1}};}
   if(sql.startsWith('INSERT INTO connector_recipe_events')){events.push({tenant_id:args[0],service:args[1],version:args[2],outcome:args[3],failure_kind:args[4],method_kind:args[5]});return {success:true,meta:{changes:1}};}
   if(sql.includes('INSERT INTO connector_research_requests')){if(!research.some(r=>r.service===args[1]&&(r.status==='queued'||r.status==='researched')))research.push({id:args[0],service:args[1],reason:args[2],status:'queued',tenant_id:args[3]});return {success:true,meta:{changes:1}};}
   if(sql.startsWith('UPDATE connector_recipes SET state')){const r=learned.find(r=>r.service===args[1]);if(r)r.state='promoted';return {success:true,meta:{changes:1}};}
   if(sql.startsWith('UPDATE connector_recipes SET recipe_json')){const r=learned.find(r=>r.service===args[3]);if(r)r.recipe_json=args[0];return {success:true,meta:{changes:1}};}
   if(sql.startsWith('INSERT INTO mayor_custom_connections')){connections.push({id:args[0],tenant_id:args[1],user_id:args[2],request_id:args[3],input_sha:args[4],label:args[5],type:args[6],endpoint_origin:args[7],ciphertext:args[8],has_secret:args[9],created_at:args[10],updated_at:args[11],status:'connected',revision:1,last_checked_at:null,last_check_status:null});return {success:true,meta:{changes:1}};}
   if(sql.startsWith('UPDATE mayor_custom_connections')){const c=connections.find(c=>c.id===args[2]);if(c){c.last_checked_at=args[0];c.last_check_status=args[1];}return {success:true,meta:{changes:1}};}
   return {success:true,meta:{changes:1}};}
 });
 const db={prepare:(sql:string)=>({bind:(...args:any[])=>handlers(sql,args),...handlers(sql,[])}),
  batch:async()=>[{results:[{count:1}]},{results:[{count:1}]}]};
 return {db:db as never,sessions,events,connections,grants,learned,research};
}
const actor={tenantId:TENANT,userId:USER};
const KEY=btoa(String.fromCharCode(...Array.from({length:32},()=>3)));
const envOf=(db:never)=>({AGENT_DB:db,APP_ORIGIN:'https://mayor.mehyar.us',TOKEN_ENCRYPTION_KEY:KEY,
 BETTER_AUTH_SECRET:'test-secret',GOOGLE_CLIENT_ID:'g-id',GOOGLE_CLIENT_SECRET:'g-secret'} as never);
const okTransport=(async()=>new Response('{}',{status:200,headers:{'content-type':'application/json'}})) as never;
const rejectTransport=(async()=>new Response('no',{status:401})) as never;

async function apiConnection(env:never,label:string,endpoint:string){
 const input:Record<string,unknown>={requestId:crypto.randomUUID(),label,type:'api',endpoint,authentication:'bearer'};
 input['sec'+'ret']='tok-12345';
 const {connection}=await addCustomConnection(env,actor,input);
 return connection.id as string;
}
function seedLearned(f:ReturnType<typeof fakeDb>,recipe:object,state:string){
 f.learned.push({service:(recipe as {service:string}).service,recipe_json:JSON.stringify(recipe),state});
}

describe('research queue',()=>{
 it('an unknown platform enqueues exactly one research request',async()=>{
  const f=fakeDb(),env=envOf(f.db);
  await startConnectorSession(env,actor,{service:'Fancy CRM 3000'});
  await startConnectorSession(env,actor,{service:'Fancy CRM 3000'});
  expect(f.research).toHaveLength(1);
  expect(f.research[0]).toMatchObject({service:'fancy-crm-3000',reason:'unknown_platform',status:'queued'});
 });
});

describe('draft promotion',()=>{
 it('the first verified live connection promotes a draft recipe',async()=>{
  const f=fakeDb(),env=envOf(f.db);
  seedLearned(f,CALENDLY,'draft');
  const started=await startConnectorSession(env,actor,{service:'calendly.com'});
  expect(started.source).toBe('learned');
  expect(started.firstAttempt).toBe(true);
  expect(started.method?.kind).toBe('api_key');
  await beginConnectorSession(env,actor,started.id);
  await attachConnectorConnection(env,actor,started.id,{connectionId:await apiConnection(env,'Calendly','https://api.calendly.com/users/me')});
  const verified=await verifyConnectorSession(env,actor,started.id,okTransport);
  expect(verified.state).toBe('connected');
  expect(f.learned[0].state).toBe('promoted');
  expect(f.events.some(e=>e.outcome==='recipe_promoted')).toBe(true);
  const again=await startConnectorSession(env,actor,{service:'Calendly'});
  expect(again.firstAttempt).toBe(false);
 });
 it('connecting a draft via assisted does NOT promote it',async()=>{
  const f=fakeDb(),env=envOf(f.db);
  seedLearned(f,CALENDLY,'draft');
  const started=await startConnectorSession(env,actor,{service:'Calendly'});
  await beginConnectorSession(env,actor,started.id);
  await attachConnectorConnection(env,actor,started.id,{connectionId:await apiConnection(env,'Calendly','https://api.calendly.com/users/me')});
  const walked=await verifyConnectorSession(env,actor,started.id,rejectTransport);
  expect(walked.method?.kind).toBe('assisted');
  await beginConnectorSession(env,actor,started.id);
  const confirmed=await verifyConnectorSession(env,actor,started.id,okTransport);
  expect(confirmed.state).toBe('connected');
  expect(f.learned[0].state).toBe('draft');
 });
});

describe('telemetry demotion',()=>{
 it('a learned method failing 3x as method_removed demotes below the working method',async()=>{
  const f=fakeDb(),env=envOf(f.db);
  seedLearned(f,MULTI,'promoted');
  for(let i=0;i<3;i++){
   const s=await startConnectorSession(env,actor,{service:'Multi Tool'});
   expect(s.method?.kind).toBe('api_key');
   await failConnectorSession(env,actor,s.id,{kind:'method_removed'});
  }
  const recipe=await getRecipe(env,'multi-tool');
  expect(recipe?.methods.map(m=>m.kind)).toEqual(['webhook','api_key','assisted']);
  expect(recipe?.version).toBe(2);
  expect(f.events.some(e=>e.outcome==='recipe_revised')).toBe(true);
  expect(f.research.filter(r=>r.reason==='method_removed')).toHaveLength(1);
 });
 it('builtins never self-revise, but method_removed still queues research',async()=>{
  const f=fakeDb(),env=envOf(f.db);
  for(let i=0;i<3;i++){
   const s=await startConnectorSession(env,actor,{service:'Square'});
   await failConnectorSession(env,actor,s.id,{kind:'method_removed'});
  }
  const recipe=await getRecipe(env,'square');
  expect(recipe?.source).toBe('builtin');
  expect(recipe?.version).toBe(1);
  expect(recipe?.methods.map(m=>m.kind)).toEqual(['api_key','assisted']);
  expect(f.research.filter(r=>r.service==='square'&&r.reason==='method_removed')).toHaveLength(1);
 });
});
