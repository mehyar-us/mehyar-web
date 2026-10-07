import {env as testEnv} from 'cloudflare:workers';
import {beforeEach,it,expect,vi} from 'vitest';
import type {Actor,Env} from '../../src/env';
import {handleMayorMcp,handleMcpTokens} from '../../src/mcp';
import {handleOperationsRequest} from '../../src/operations';
import {confirmProfile} from '../../src/memory';
import {prepareCustomer,confirmCustomer} from '../../src/customers';
import {digest} from '../../src/http';

const env=testEnv as unknown as Env;
let actor:Actor;
async function workspace(role='owner'){
 const identity={tenantId:crypto.randomUUID().replaceAll('-',''),userId:crypto.randomUUID()};
 await env.AGENT_DB.batch([
  env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(identity.tenantId,'MCP test business',new Date().toISOString()),
  env.AGENT_DB.prepare('INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,?)').bind(identity.tenantId,identity.userId,role),
 ]);return identity;
}
beforeEach(async()=>{actor=await workspace();});
function management(identity:Actor,path='',body?:unknown,method=body===undefined?'GET':'POST'){
 return new Request(`${env.APP_ORIGIN}/api/businesses/${identity.tenantId}/mcp/tokens${path}`,{method,headers:{origin:env.APP_ORIGIN,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
async function create(identity=actor){
 const response=await handleMcpTokens(management(identity,'',{label:'External assistant'}),env,identity);
 expect(response?.status).toBe(201);return response!.json() as Promise<any>;
}
function rpcRequest(token:string,message:unknown={jsonrpc:'2.0',id:1,method:'ping'},options:{headers?:Record<string,string>;method?:string;raw?:string}={}){
 return new Request(`${env.APP_ORIGIN}/mcp`,{method:options.method??'POST',headers:{authorization:`Bearer ${token}`,accept:'application/json, text/event-stream','content-type':'application/json','mcp-protocol-version':'2025-11-25',...options.headers},...(options.method==='GET'?{}:{body:options.raw??JSON.stringify(message)})});
}
async function rpc(token:string,method:string,params?:unknown,runtime=env){
 const response=await handleMayorMcp(rpcRequest(token,{jsonrpc:'2.0',id:7,method,...(params===undefined?{}:{params})}),runtime);
 return {status:response!.status,body:await response!.json() as any};
}
async function tool(token:string,name:string,args:unknown={},runtime=env){return rpc(token,'tools/call',{name,arguments:args},runtime);}
async function goal(identity:Actor,title:string){
 const now=new Date().toISOString();
 await env.AGENT_DB.prepare('INSERT INTO mayor_harness_goals(id,tenant_id,title,description,revision,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,1,?,?,?,?)')
  .bind(crypto.randomUUID(),identity.tenantId,title,'Unknown baseline; owner-entered goal',identity.userId,identity.userId,now,now).run();
}

it('issues once, stores only a digest and lists only the creator’s safe token metadata',async()=>{
 const issued=await create();expect(issued.token).toMatch(/^mayor_mcp_[a-f0-9]{64}$/);
 expect(issued).toMatchObject({endpoint:`${env.APP_ORIGIN}/mcp`,metadata:{label:'External assistant',scopes:['business:read'],revokedAt:null}});
 const stored=await env.AGENT_DB.prepare('SELECT * FROM mayor_mcp_tokens WHERE id=?').bind(issued.metadata.id).first<any>();
 expect(stored.token_digest).toBe(await digest(issued.token));expect(JSON.stringify(stored)).not.toContain(issued.token);
 const list=await handleMcpTokens(management(actor),env,actor),safe=await list!.json() as any;
 expect(safe.tokens).toHaveLength(1);expect(JSON.stringify(safe)).not.toMatch(/token_digest|mayor_mcp_/);
 const colleague={...actor,userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'manager')").bind(actor.tenantId,colleague.userId).run();
 expect((await (await handleMcpTokens(management(colleague),env,colleague))!.json() as any).tokens).toEqual([]);
 await expect(handleMcpTokens(management(actor,`/${issued.metadata.id}/revoke`,{}),env,colleague)).rejects.toMatchObject({status:404});
 const other=await workspace();await expect(handleMcpTokens(management(other),env,actor)).rejects.toMatchObject({status:404});
});

it('limits expiry and scope, bounds active token count and requires same-origin management writes',async()=>{
 for(const input of [{label:'A',scopes:['tasks:write']},{label:'A',expiresInDays:91},{label:'A',expiresInDays:'30'},{label:'A',tenantId:actor.tenantId}])
  await expect(handleMcpTokens(management(actor,'',input),env,actor)).rejects.toThrow();
 const foreign=new Request(management(actor,'',{label:'A'}),{headers:{origin:'https://foreign.test','content-type':'application/json'}});
 await expect(handleMcpTokens(foreign,env,actor)).rejects.toMatchObject({status:403});
 for(let i=0;i<10;i++){
  const token=`mayor_mcp_${Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')}`;
  await env.AGENT_DB.prepare('INSERT INTO mayor_mcp_tokens(id,tenant_id,user_id,label,token_digest,scopes_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)')
   .bind(crypto.randomUUID(),actor.tenantId,actor.userId,'Existing',await digest(token),'["business:read"]',new Date().toISOString(),'2099-01-01T00:00:00.000Z').run();
 }
 await expect(handleMcpTokens(management(actor,'',{label:'Eleventh'}),env,actor)).rejects.toMatchObject({code:'mcp_token_limit'});
});

it('negotiates stateless JSON transport and returns empty notification acknowledgement',async()=>{
 const {token}=await create();
 const init=await rpc(token,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'Test client',version:'1'}});
 expect(init.body).toMatchObject({jsonrpc:'2.0',id:7,result:{protocolVersion:'2025-11-25',capabilities:{tools:{listChanged:false}},serverInfo:{name:'Mayor'}}});
 expect((await rpc(token,'ping')).body.result).toEqual({});
 const notification=await handleMayorMcp(rpcRequest(token,{jsonrpc:'2.0',method:'notifications/initialized'}),env);
 expect(notification!.status).toBe(202);expect(await notification!.text()).toBe('');expect(notification!.headers.get('mcp-session-id')).toBeNull();
 const get=await handleMayorMcp(rpcRequest(token,undefined,{method:'GET'}),env);expect(get!.status).toBe(405);expect(get!.headers.get('allow')).toBe('POST');
});

it('rejects foreign origins, malformed/oversized JSON, unsupported protocol, batches and methods',async()=>{
 const {token}=await create();
 const foreign=await handleMayorMcp(rpcRequest(token,undefined,{headers:{origin:'https://foreign.test'}}),env);expect(foreign!.status).toBe(403);
 expect(foreign!.headers.get('access-control-allow-origin')).toBeNull();
 expect((await handleMayorMcp(rpcRequest(token,undefined,{headers:{accept:'application/json'}}),env))!.status).toBe(406);
 expect((await handleMayorMcp(rpcRequest(token,undefined,{headers:{'mcp-protocol-version':'1900-01-01'}}),env))!.status).toBe(400);
 const bad=await handleMayorMcp(rpcRequest(token,undefined,{raw:'{'}),env);expect((await bad!.json() as any).error.code).toBe(-32700);
 expect((await handleMayorMcp(rpcRequest(token,undefined,{raw:' '.repeat(16385)}),env))!.status).toBe(413);
 const batch=await handleMayorMcp(rpcRequest(token,[{jsonrpc:'2.0',id:1,method:'ping'}]),env);expect(batch!.status).toBe(400);
 expect((await rpc(token,'resources/read')).body.error.code).toBe(-32601);
});

it('reads each native saved-record tool in one tenant without models, external reads or writes',async()=>{
 const other=await workspace();await confirmProfile(env,actor,{name:'Local bakery',timeZone:'UTC'},0);await confirmProfile(env,other,{name:'Foreign secret'},0);
 for(const identity of [actor,other]){
  await handleOperationsRequest(new Request(`${env.APP_ORIGIN}/api/businesses/${identity.tenantId}/tasks`,{method:'POST',headers:{origin:env.APP_ORIGIN,'content-type':'application/json'},body:JSON.stringify({title:identity===actor?'Local task':'Foreign task'})}),env,identity);
  const prepared=await prepareCustomer(env,identity,{name:identity===actor?'Local customer':'Foreign customer',email:`${crypto.randomUUID()}@example.test`});await confirmCustomer(env,identity,prepared);
  await goal(identity,identity===actor?'Local goal':'Foreign goal');
 }
 const {token}=await create(),fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('External fetch denied')),ai=vi.fn().mockRejectedValue(new Error('Model call denied'));
 try{
  const runtime={...env,AI:{run:ai}} as unknown as Env;
  expect((await tool(token,'mayor_get_profile',{},runtime)).body.result.structuredContent.profile.name).toBe('Local bakery');
  expect((await tool(token,'mayor_list_tasks',{},runtime)).body.result.structuredContent.tasks.map((r:any)=>r.title)).toEqual(['Local task']);
  expect((await tool(token,'mayor_list_customers',{},runtime)).body.result.structuredContent.customers.map((r:any)=>r.name)).toEqual(['Local customer']);
  expect((await tool(token,'mayor_list_goals',{},runtime)).body.result.structuredContent.goals.map((r:any)=>r.title)).toEqual(['Local goal']);
  expect((await tool(token,'mayor_get_agenda',{date:'2026-10-05'},runtime)).body.result.structuredContent.appointments).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();expect(ai).not.toHaveBeenCalled();
 }finally{fetch.mockRestore();}
});

it('rejects injected tenant/user arguments and exposes no send, publish or spend tools',async()=>{
 const {token}=await create(),listed=(await rpc(token,'tools/list')).body.result.tools;
 expect(listed.map((t:any)=>t.name)).toEqual(['mayor_get_profile','mayor_list_tasks','mayor_list_customers','mayor_get_agenda','mayor_list_goals']);
 expect(listed.every((t:any)=>t.annotations.readOnlyHint&&t.inputSchema.additionalProperties===false)).toBe(true);
 for(const args of [{tenantId:(await workspace()).tenantId},{userId:crypto.randomUUID()},{limit:100},{limit:'2'}])
  expect((await tool(token,'mayor_list_tasks',args)).body.error.code).toBe(-32602);
 expect((await tool(token,'send_email')).body.error.code).toBe(-32602);
});

it('requires current role on each request and filters the advertised tools to native permissions',async()=>{
 const {token}=await create();await env.AGENT_DB.prepare("UPDATE agent_memberships SET role='staff' WHERE tenant_id=? AND user_id=?").bind(actor.tenantId,actor.userId).run();
 expect((await rpc(token,'tools/list')).body.result.tools.map((t:any)=>t.name)).toEqual(['mayor_get_profile']);
 expect((await tool(token,'mayor_list_tasks')).body.result.isError).toBe(true);expect((await tool(token,'mayor_get_profile')).body.result.isError).toBe(false);
 await env.AGENT_DB.prepare("UPDATE agent_memberships SET role='billing' WHERE tenant_id=? AND user_id=?").bind(actor.tenantId,actor.userId).run();
 expect((await rpc(token,'tools/list')).body.result.tools).toEqual([]);
});

it('rejects revoked, expired, removed-member and inactive-business capabilities',async()=>{
 const issued=await create();const revoked=await handleMcpTokens(management(actor,`/${issued.metadata.id}/revoke`,{}),env,actor);expect(revoked!.status).toBe(200);
 expect((await rpc(issued.token,'ping')).status).toBe(401);
 const expired=await create();await env.AGENT_DB.prepare("UPDATE mayor_mcp_tokens SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(expired.metadata.id).run();expect((await rpc(expired.token,'ping')).status).toBe(401);
 const valid=await create();await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=? AND user_id=?").bind(actor.tenantId,actor.userId).run();expect((await rpc(valid.token,'ping')).status).toBe(401);
 await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='active',expires_at='2000-01-01T00:00:00.000Z' WHERE tenant_id=? AND user_id=?").bind(actor.tenantId,actor.userId).run();expect((await rpc(valid.token,'ping')).status).toBe(401);
 await env.AGENT_DB.prepare('UPDATE agent_memberships SET expires_at=NULL WHERE tenant_id=? AND user_id=?').bind(actor.tenantId,actor.userId).run();
 await env.AGENT_DB.prepare("UPDATE agent_tenants SET status='paused' WHERE id=?").bind(actor.tenantId).run();expect((await rpc(valid.token,'ping')).status).toBe(401);
});

function changeAtFinalCapability(change:()=>Promise<unknown>):Env{
 let reads=0;
 const db=new Proxy(env.AGENT_DB,{get(target,key){
  if(key!=='prepare'){const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}
  return (sql:string)=>{
   const wrap=(statement:D1PreparedStatement):D1PreparedStatement=>new Proxy(statement,{get(inner,method){
    if(method==='bind')return (...args:any[])=>wrap(inner.bind(...args));
    if(method==='first'&&sql.startsWith('SELECT * FROM mayor_mcp_tokens WHERE token_digest='))return async(...args:any[])=>{if(++reads===2)await change();return inner.first(...args as []);};
    const value=Reflect.get(inner,method);return typeof value==='function'?value.bind(inner):value;
   }});
   return wrap(target.prepare(sql));
  };
 }});return {...env,AGENT_DB:db};
}
it('discards a task read when the token is revoked after native data access',async()=>{
 const {token,metadata}=await create();const runtime=changeAtFinalCapability(()=>env.AGENT_DB.prepare('UPDATE mayor_mcp_tokens SET revoked_at=? WHERE id=?').bind(new Date().toISOString(),metadata.id).run());
 const read=await tool(token,'mayor_list_tasks',{},runtime);expect(read.body.result.isError).toBe(true);expect(read.body.result.structuredContent).toBeUndefined();
});
it('discards a task read when an operator is downgraded after native data access',async()=>{
 const {token}=await create();const runtime=changeAtFinalCapability(()=>env.AGENT_DB.prepare("UPDATE agent_memberships SET role='staff' WHERE tenant_id=? AND user_id=?").bind(actor.tenantId,actor.userId).run());
 const read=await tool(token,'mayor_list_tasks',{},runtime);expect(read.body.result.isError).toBe(true);expect(read.body.result.structuredContent).toBeUndefined();
});
it('atomically enforces the token call rate limit and never stores the raw token in its key',async()=>{
 const {token,metadata}=await create(),subject=`mcp:call:${metadata.id}`,bucket=Math.floor(Date.now()/60000);
 await env.AGENT_DB.prepare('INSERT INTO mayor_rate_limits(subject,bucket,count) VALUES(?,?,59)').bind(subject,bucket).run();
 const outcomes=await Promise.all([rpc(token,'ping'),rpc(token,'ping')]);expect(outcomes.map(r=>r.status).sort()).toEqual([200,429]);
 expect((await env.AGENT_DB.prepare('SELECT count FROM mayor_rate_limits WHERE subject=? AND bucket=?').bind(subject,bucket).first<any>()).count).toBe(60);
 expect(subject).not.toContain(token);
});
