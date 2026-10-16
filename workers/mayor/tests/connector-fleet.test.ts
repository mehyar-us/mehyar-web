import {describe,it,expect} from 'vitest';
import {startConnectorSession} from '../src/connector-engine';
import {getRecipe} from '../src/connector-recipes';

/* One Connector fleet ordering (Mayor, 2026-10-15): "one click
 * preferably; the way that's used the most is the way that stays."
 * Sessions start on the best way by fleet evidence — one-click first,
 * then most successful connections — and a proven new order persists
 * into the catalog (with hysteresis, and assisted always last: it is
 * the human fallback, not a platform method). */

const TENANT='a'.repeat(32),USER='user-1';
const POP={service:'pop-tool',name:'Pop Tool',aliases:[],capabilities:[],unlocks:'Everything in one place.',
 methods:[{kind:'webhook',capture:{label:'Webhook URL',hint:'Point the webhook at The Mayor.'}},
  {kind:'api_key',capture:{label:'API key',hint:'Create a key.'}},
  {kind:'assisted',steps:['We set this up together.']}],source:'learned',version:1};
const CLICK={service:'click-tool',name:'Click Tool',aliases:[],capabilities:[],unlocks:'Everything in one place.',
 methods:[{kind:'api_key',capture:{label:'API key',hint:'Create a key.'}},
  {kind:'oauth',provider:'google'},
  {kind:'assisted',steps:['We set this up together.']}],source:'learned',version:1};

function fakeDb(){
 const sessions:any[]=[],events:any[]=[],learned:any[]=[];
 const handlers=(sql:string,args:any[])=>({
  first:async()=>{
   if(sql.includes('agent_memberships'))return {tenant_id:args[0],user_id:args[1],role:'owner',status:'active',expires_at:null};
   if(sql.includes('SELECT state FROM connector_recipes'))return learned.find(r=>r.service===args[0])??null;
   if(sql.includes('mayor_connector_sessions'))return sessions.find(s=>s.id===args[0]&&s.tenant_id===args[1])??null;
   return null;},
  all:async()=>{
   if(sql.includes('GROUP BY method_kind,outcome')){
    const byKey:Record<string,number>={};
    for(const e of events)if(e.service===args[0]&&e.method_kind&&(e.outcome==='connected'||e.outcome==='method_failed'))byKey[`${e.method_kind}:${e.outcome}`]=(byKey[`${e.method_kind}:${e.outcome}`]??0)+1;
    return {results:Object.entries(byKey).map(([k,n])=>({method_kind:k.split(':')[0],outcome:k.split(':')[1],n}))};
   }
   if(sql.includes('GROUP BY outcome')){
    const byOutcome:Record<string,number>={};
    for(const e of events)if(e.service===args[0]&&e.version===args[1]&&e.method_kind===args[2]&&(e.outcome==='method_failed'||e.outcome==='connected'))byOutcome[e.outcome]=(byOutcome[e.outcome]??0)+1;
    return {results:Object.entries(byOutcome).map(([outcome,n])=>({outcome,n}))};
   }
   if(sql.includes('FROM connector_recipes'))return {results:learned};
   if(sql.includes('mayor_connector_sessions'))return {results:sessions.filter(s=>s.tenant_id===args[0])};
   return {results:[]};},
  run:async()=>{
   if(sql.startsWith('INSERT INTO mayor_connector_sessions')){sessions.push({id:args[0],tenant_id:args[1],service:args[2],method_index:args[3],method_kind:args[4],state:args[5],failure_kind:args[6],connection_id:args[7],created_at:args[8],updated_at:args[9]});return {success:true,meta:{changes:1}};}
   if(sql.startsWith('UPDATE mayor_connector_sessions')){const s=sessions.find(s=>s.id===args[6]&&s.tenant_id===args[7]);if(s)Object.assign(s,{method_index:args[0],method_kind:args[1],state:args[2],failure_kind:args[3],connection_id:args[4],updated_at:args[5]});return {success:true,meta:{changes:1}};}
   if(sql.startsWith('INSERT INTO connector_recipe_events')){events.push({tenant_id:args[0],service:args[1],version:args[2],outcome:args[3],failure_kind:args[4],method_kind:args[5]});return {success:true,meta:{changes:1}};}
   if(sql.startsWith('INSERT INTO connector_recipes')){const row={service:args[0],recipe_json:args[1],source:args[2],version:args[3],state:args[5]};const i=learned.findIndex(r=>r.service===args[0]);if(i>=0)learned[i]=row;else learned.push(row);return {success:true,meta:{changes:1}};}
   if(sql.startsWith('UPDATE connector_recipes SET recipe_json')){const r=learned.find(r=>r.service===args[3]);if(r)r.recipe_json=args[0];return {success:true,meta:{changes:1}};}
   if(sql.startsWith('UPDATE connector_recipes SET state')){const r=learned.find(r=>r.service===args[1]);if(r)r.state='promoted';return {success:true,meta:{changes:1}};}
   return {success:true,meta:{changes:1}};}
 });
 const db={prepare:(sql:string)=>({bind:(...args:any[])=>handlers(sql,args),...handlers(sql,[])}),
  batch:async()=>[{results:[{count:1}]},{results:[{count:1}]}]};
 return {db:db as never,sessions,events,learned};
}
const actor={tenantId:TENANT,userId:USER};
const envOf=(db:never)=>({AGENT_DB:db,APP_ORIGIN:'https://mayor.mehyar.us',
 BETTER_AUTH_SECRET:'test-secret',GOOGLE_CLIENT_ID:'g-id',GOOGLE_CLIENT_SECRET:'g-secret'} as never);
function seed(f:ReturnType<typeof fakeDb>,recipe:object,state='promoted'){
 f.learned.push({service:(recipe as {service:string}).service,recipe_json:JSON.stringify(recipe),state});
}
function wins(f:ReturnType<typeof fakeDb>,service:string,kind:string,n:number,version=1){
 for(let i=0;i<n;i++)f.events.push({tenant_id:TENANT,service,version,outcome:'connected',failure_kind:null,method_kind:kind});
}

describe('fleet ordering',()=>{
 it('the most-used way starts the session AND persists as the catalog order',async()=>{
  const f=fakeDb(),env=envOf(f.db);
  seed(f,POP);wins(f,'pop-tool','api_key',6);
  const started=await startConnectorSession(env,actor,{service:'Pop Tool'});
  expect(started.method?.kind).toBe('api_key');
  const recipe=await getRecipe(env,'pop-tool');
  expect(recipe?.methods.map(m=>m.kind)).toEqual(['api_key','webhook','assisted']);
  expect(recipe?.version).toBe(2);
  expect(f.events.some(e=>e.outcome==='recipe_revised')).toBe(true);
 });
 it('below the volume threshold the session still prefers the winner, but the catalog does not move',async()=>{
  const f=fakeDb(),env=envOf(f.db);
  seed(f,POP);wins(f,'pop-tool','api_key',4);
  const started=await startConnectorSession(env,actor,{service:'Pop Tool'});
  expect(started.method?.kind).toBe('api_key');
  const recipe=await getRecipe(env,'pop-tool');
  expect(recipe?.methods.map(m=>m.kind)).toEqual(['webhook','api_key','assisted']);
  expect(recipe?.version).toBe(1);
 });
 it('a one-click way beats a more-used key paste, and takes the top spot for good',async()=>{
  const f=fakeDb(),env=envOf(f.db);
  seed(f,CLICK);wins(f,'click-tool','api_key',9);
  const started=await startConnectorSession(env,actor,{service:'Click Tool'});
  expect(started.method?.kind).toBe('oauth');
  expect(started.method?.oneClick).toBe(true);
  const recipe=await getRecipe(env,'click-tool');
  expect(recipe?.methods.map(m=>m.kind)).toEqual(['oauth','api_key','assisted']);
  expect(recipe?.version).toBe(2);
 });
 it('assisted evidence can steer a builtin session, but never rewrites the builtin catalog order',async()=>{
  const f=fakeDb(),env=envOf(f.db);
  wins(f,'square','assisted',8);
  const started=await startConnectorSession(env,actor,{service:'Square'});
  expect(started.method?.kind).toBe('assisted');
  expect(f.learned.some(r=>r.service==='square')).toBe(false);
  const recipe=await getRecipe(env,'square');
  expect(recipe?.source).toBe('builtin');
  expect(recipe?.methods.map(m=>m.kind)).toEqual(['api_key','assisted']);
 });
});
