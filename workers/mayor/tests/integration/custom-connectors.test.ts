import {env as testEnv} from 'cloudflare:workers';
import {it,expect,vi} from 'vitest';
import type {Env,Actor} from '../../src/env';
import {addCustomConnection,listCustomConnections,checkCustomConnection,listCustomTools,readCustomTool,prepareCustomTool,confirmCustomTool,disconnectCustomConnection,handleCustomConnectionsRequest,CUSTOM_CONNECTION_LIMITS} from '../../src/custom-connectors';
import {connectionStatus} from '../../src/connections';
const env=testEnv as unknown as Env;
async function fixture(){
  const actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};
  await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Custom fixture',new Date().toISOString()).run();
  await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
  const add=async(type:'api'|'webhook'|'mcp'='api',extra:Record<string,unknown>={})=>(await addCustomConnection(env,actor,{requestId:crypto.randomUUID(),label:'Private fixture',type,endpoint:'https://api.vendor.com/v1',secret:'fixture-credential-secret',...extra})).connection;
  return {actor,add};
}
it('stores encrypted config and returns no saved secret or endpoint capability',async()=>{
  const f=await fixture(),connection=await f.add();
  const row=await env.AGENT_DB.prepare('SELECT * FROM mayor_custom_connections WHERE id=?').bind(connection.id).first<any>();
  expect(row.ciphertext).toMatch(/^v1\./);expect(JSON.stringify(row)).not.toContain('fixture-credential-secret');
  expect(JSON.stringify(await listCustomConnections(env,f.actor))).not.toContain('/v1');
  const status=await connectionStatus(env,f.actor);expect(status.builtIn.find(c=>c.provider==='facebook')?.status).toBe('app_review_pending');
  expect(JSON.stringify(status)).not.toContain('ciphertext');
});
it('idempotent add binds exact config rather than swallowing changed input',async()=>{
  const f=await fixture(),input={requestId:crypto.randomUUID(),label:'Exact config',type:'api',endpoint:'https://api.vendor.com/v1',secret:'fixture-credential-secret'};
  const first=await addCustomConnection(env,f.actor,input);expect((await addCustomConnection(env,f.actor,input)).connection.id).toBe(first.connection.id);
  for(const change of [{label:'Other'},{endpoint:'https://other.vendor.com/'},{secret:'changed-credential-secret'}])await expect(addCustomConnection(env,f.actor,{...input,...change})).rejects.toThrow();
});
it('isolates another user in the same tenant, another tenant and staff before transport',async()=>{
  const f=await fixture(),connection=await f.add(),transport=vi.fn();
  for(const actor of [{...f.actor,userId:crypto.randomUUID()},{...f.actor,tenantId:crypto.randomUUID()}]){
    await expect(readCustomTool(env,actor,connection.id,'request',{} as any,transport)).rejects.toThrow();
  }
  await env.AGENT_DB.prepare("UPDATE agent_memberships SET role='staff' WHERE tenant_id=? AND user_id=?").bind(f.actor.tenantId,f.actor.userId).run();
  await expect(checkCustomConnection(env,f.actor,connection.id,transport)).rejects.toThrow();expect(transport).not.toHaveBeenCalled();
});
it.each(['user','tenant','id'] as const)('AAD rejects swapped %s custody without any fetch',async field=>{
  const f=await fixture(),first=await f.add(),second=await f.add(),transport=vi.fn();
  const original=await env.AGENT_DB.prepare('SELECT ciphertext FROM mayor_custom_connections WHERE id=?').bind(first.id).first<{ciphertext:string}>();
  let actor:Actor=f.actor,id=second.id;
  if(field!=='id'){
    actor=field==='user'?{...f.actor,userId:crypto.randomUUID()}:{...f.actor,tenantId:crypto.randomUUID()};
    if(field==='tenant')await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Other',new Date().toISOString()).run();
    await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'manager')").bind(actor.tenantId,actor.userId).run();
    await env.AGENT_DB.prepare('UPDATE mayor_custom_connections SET tenant_id=?,user_id=? WHERE id=?').bind(actor.tenantId,actor.userId,id).run();
  }
  await env.AGENT_DB.prepare('UPDATE mayor_custom_connections SET ciphertext=? WHERE id=?').bind(original!.ciphertext,id).run();
  await expect(checkCustomConnection(env,actor,id,transport)).rejects.toThrow();expect(transport).not.toHaveBeenCalled();
});
it('a webhook check never sends and writes require an exact consumed UI proposal',async()=>{
  const f=await fixture(),connection=await f.add('webhook');let calls=0;
  const transport=(async(target:RequestInfo|URL,init?:RequestInit)=>{calls++;expect(String(target)).toBe('https://api.vendor.com/v1');
    expect(init?.method).toBe('POST');expect(init?.redirect).toBe('manual');expect(JSON.parse(String(init?.body))).toEqual({message:'Approved exact input'});
    return Response.json({ok:true,echo:'fixture-credential-secret',token:'private'});}) as typeof fetch;
  expect((await checkCustomConnection(env,f.actor,connection.id,transport)).status).toBe('configured');expect(calls).toBe(0);
  await expect(readCustomTool(env,f.actor,connection.id,'send',{message:'unapproved'},transport)).rejects.toThrow();
  const {proposal}=await prepareCustomTool(env,f.actor,{connectionId:connection.id,tool:'send',args:{message:'Approved exact input'},requestId:crypto.randomUUID()});
  expect(proposal.effect).toBe('write');const result=await confirmCustomTool(env,f.actor,proposal.id,transport);
  expect(JSON.stringify(result)).not.toContain('fixture-credential-secret');expect(calls).toBe(1);
  await expect(confirmCustomTool(env,f.actor,proposal.id,transport)).rejects.toThrow();expect(calls).toBe(1);
});
it('revocation and expiry invalidate saved approvals without outbound execution',async()=>{
  const f=await fixture(),connection=await f.add('webhook'),transport=vi.fn();
  const {proposal}=await prepareCustomTool(env,f.actor,{connectionId:connection.id,tool:'send',args:{x:1},requestId:crypto.randomUUID()});
  await disconnectCustomConnection(env,f.actor,connection.id,connection.revision);
  await expect(confirmCustomTool(env,f.actor,proposal.id,transport)).rejects.toThrow();
  const second=await f.add('webhook');const p=await prepareCustomTool(env,f.actor,{connectionId:second.id,tool:'send',args:{x:1},requestId:crypto.randomUUID()});
  await env.AGENT_DB.prepare("UPDATE mayor_custom_tool_proposals SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(p.proposal.id).run();
  await expect(confirmCustomTool(env,f.actor,p.proposal.id,transport)).rejects.toThrow();expect(transport).not.toHaveBeenCalled();
});
it('ambiguous external writes consume the approval permanently, with no raw exception leak',async()=>{
  const f=await fixture(),connection=await f.add('webhook');const transport=vi.fn(async()=>{throw new Error('private token fixture-credential-secret');}) as unknown as typeof fetch;
  const p=await prepareCustomTool(env,f.actor,{connectionId:connection.id,tool:'send',args:{x:1},requestId:crypto.randomUUID()});
  await expect(confirmCustomTool(env,f.actor,p.proposal.id,transport)).rejects.toThrow('Do not repeat this action');
  await expect(confirmCustomTool(env,f.actor,p.proposal.id,transport)).rejects.toThrow();expect(transport).toHaveBeenCalledTimes(1);
  expect((await env.AGENT_DB.prepare('SELECT state FROM mayor_custom_tool_proposals WHERE id=?').bind(p.proposal.id).first<any>()).state).toBe('unknown');
});
it('MCP supports initialize/list/call but remote readOnly annotations do not authorize writes',async()=>{
  const f=await fixture(),connection=await f.add('mcp');const methods:string[]=[];
  const transport=(async(_target:RequestInfo|URL,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));methods.push(body.method);expect(init?.redirect).toBe('manual');
    if(body.method==='initialize')return Response.json({jsonrpc:'2.0',id:body.id,result:{protocolVersion:'2025-11-25',capabilities:{tools:{}}}},{headers:{'mcp-session-id':'owned-session'}});
    expect(new Headers(init?.headers).get('mcp-session-id')).toBe('owned-session');
    if(body.method==='notifications/initialized')return new Response(null,{status:202});
    return Response.json({jsonrpc:'2.0',id:body.id,result:body.method==='tools/list'?{tools:[{name:'send',inputSchema:{type:'object'},annotations:{readOnlyHint:true}}]}:{content:[{type:'text',text:'sent'}]}});
  }) as typeof fetch;
  expect((await listCustomTools(env,f.actor,connection.id,transport)).tools).toMatchObject([{name:'send',effect:'write'}]);
  await expect(readCustomTool(env,f.actor,connection.id,'send',{},transport)).rejects.toThrow();expect(methods).not.toContain('tools/call');
  const p=await prepareCustomTool(env,f.actor,{connectionId:connection.id,tool:'send',args:{x:1},requestId:crypto.randomUUID()});
  await confirmCustomTool(env,f.actor,p.proposal.id,transport);expect(methods.filter(m=>m==='tools/call')).toHaveLength(1);
});
it('API read refuses redirects and discards data after in-flight revocation',async()=>{
  const f=await fixture(),connection=await f.add();
  const redirect=(async()=>new Response(null,{status:302,headers:{location:'https://127.0.0.1/'}})) as typeof fetch;
  await expect(readCustomTool(env,f.actor,connection.id,'request',{},redirect)).rejects.toThrow();
  const transport=(async()=>{await disconnectCustomConnection(env,f.actor,connection.id,connection.revision);return Response.json({private:'discard'});}) as typeof fetch;
  await expect(readCustomTool(env,f.actor,connection.id,'request',{},transport)).rejects.toThrow();
});
it('route errors include fixed safe guidance and MCP subrequests share one total outbound deadline',async()=>{
  const f=await fixture(),id=crypto.randomUUID();
  const response=await handleCustomConnectionsRequest(new Request(`https://mayor.example.test/api/businesses/${f.actor.tenantId}/connections/${id}/check`,{
    method:'POST',headers:{origin:env.APP_ORIGIN,'content-type':'application/json'},body:'{}'}),env,f.actor);
  expect(response?.status).toBe(404);expect(await response?.json()).toMatchObject({error:'connection_not_found',message:expect.stringContaining('Refresh Connections')});
  const connection=await f.add('mcp'),signals:AbortSignal[]=[];
  const transport=(async(_target:RequestInfo|URL,init?:RequestInit)=>{
    signals.push(init!.signal!);const body=JSON.parse(String(init?.body));
    if(body.method==='initialize')return Response.json({jsonrpc:'2.0',id:body.id,result:{protocolVersion:'2025-11-25',capabilities:{tools:{}}}});
    if(body.method==='notifications/initialized')return new Response(null,{status:202});
    return Response.json({jsonrpc:'2.0',id:body.id,result:{tools:[]}});
  }) as typeof fetch;
  await listCustomTools(env,f.actor,connection.id,transport);expect(signals).toHaveLength(3);
  expect(new Set(signals).size).toBe(1);expect(CUSTOM_CONNECTION_LIMITS.timeoutMs).toBe(12000);
});
