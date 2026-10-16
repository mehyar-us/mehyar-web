import {describe,it,expect} from 'vitest';
import {BUSINESS_ROUTINE_CATALOG} from '../src/business-routine-catalog';
import {HARNESS_BUILTINS} from '../src/business-harness-schema';
import {businessHarnessTools} from '../src/business-harness-tools';

/* One Connector in the Mayor harness (Mayor, 2026-10-15): the connector
 * is a builtin harness skill every business carries, and the
 * conversation agent gets real tools to run connections — start,
 * progress, advance — over the same engine sessions the API serves.
 * Credentials never pass through these tools. */

const TENANT='a'.repeat(32),USER='user-1';
const POP={service:'pop-tool',name:'Pop Tool',aliases:[],capabilities:[],unlocks:'Everything in one place.',
 methods:[{kind:'api_key',capture:{label:'API key',hint:'Create a key.'}},
  {kind:'assisted',steps:['We set this up together.']}],source:'learned',version:1};

function fakeDb(){
 const sessions:any[]=[],learned:any[]=[{service:'pop-tool',recipe_json:JSON.stringify(POP),state:'promoted'}];
 const handlers=(sql:string,args:any[])=>({
  first:async()=>{
   if(sql.includes('agent_memberships'))return {tenant_id:args[0],user_id:args[1],role:'owner',status:'active',expires_at:null};
   if(sql.includes('mayor_connector_sessions'))return sessions.find(s=>s.id===args[0]&&s.tenant_id===args[1])??null;
   return null;},
  all:async()=>{
   if(sql.includes('FROM connector_recipes'))return {results:learned};
   if(sql.includes('mayor_connector_sessions'))return {results:sessions.filter(s=>s.tenant_id===args[0])};
   return {results:[]};},
  run:async()=>{
   if(sql.startsWith('INSERT INTO mayor_connector_sessions')){sessions.push({id:args[0],tenant_id:args[1],service:args[2],method_index:args[3],method_kind:args[4],state:args[5],failure_kind:args[6],connection_id:args[7],created_at:args[8],updated_at:args[9]});return {success:true,meta:{changes:1}};}
   if(sql.startsWith('UPDATE mayor_connector_sessions')){const s=sessions.find(s=>s.id===args[6]&&s.tenant_id===args[7]);if(s)Object.assign(s,{method_index:args[0],method_kind:args[1],state:args[2],failure_kind:args[3],connection_id:args[4],updated_at:args[5]});return {success:true,meta:{changes:1}};}
   return {success:true,meta:{changes:1}};}
 });
 const db={prepare:(sql:string)=>({bind:(...args:any[])=>handlers(sql,args),...handlers(sql,[])}),
  batch:async()=>[{results:[{count:1}]},{results:[{count:1}]}]};
 return {db:db as never,sessions};
}
const envOf=(db:never)=>({AGENT_DB:db,APP_ORIGIN:'https://mayor.mehyar.us',
 BETTER_AUTH_SECRET:'test-secret',GOOGLE_CLIENT_ID:'g-id',GOOGLE_CLIENT_SECRET:'g-secret'} as never);
const options={toolCallId:'test',messages:[]};

describe('the connector skill in the harness',()=>{
 it('ships as a builtin harness skill with the connector context tool',()=>{
  expect(BUSINESS_ROUTINE_CATALOG.some(item=>item.id==='connect-your-tools')).toBe(true);
  const builtin=HARNESS_BUILTINS.find(item=>item.id==='builtin:connect-your-tools');
  expect(builtin).toBeDefined();
  expect(builtin!.allowedTools).toContain('connector_status');
  expect(builtin!.instructions).toContain('one-click');
  expect(builtin!.instructions).toContain('Never ask me for a password or API key in chat');
 });
 it('the agent tools run a real engine session end to end',async()=>{
  const f=fakeDb();
  const tools=businessHarnessTools({env:envOf(f.db),actor:{tenantId:TENANT,userId:USER},
   transcript:'Connect my Pop Tool',previousAssistant:'',authorize:async()=>{},claim:()=>{},
   readback:()=>{},pending:()=>{},valid:()=>true});
  const started=await tools.connectService.execute!({service:'Pop Tool'},options) as {id:string;state:string;method?:{kind:string}};
  expect(started.state).toBe('offered');
  expect(started.method?.kind).toBe('api_key');
  const begun=await tools.advanceConnector.execute!({sessionId:started.id,action:'begin'},options) as {state:string};
  expect(begun.state).toBe('capturing');
  const progress=await tools.connectorProgress.execute!({},options) as {sessions:{id:string}[]};
  expect(progress.sessions.map(s=>s.id)).toContain(started.id);
 });
});
