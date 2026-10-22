import {z} from 'zod';
import type {Actor} from './env';
import type {AuthEnv} from './auth/capabilities';
import {getSession} from './auth';
import {OPERATORS,requireMembership} from './permissions';
import {HttpError,json,readJson,requireOrigin,digest} from './http';
import {publicWebsiteUrl} from './website';

export const CUSTOM_CONNECTION_LIMITS={connections:10,timeoutMs:12000,responseBytes:65536,inputBytes:8192,
  tools:30,outboundPerMinute:12,outboundPerDay:100,approvalSeconds:300} as const;
const name=z.string().regex(/^[a-zA-Z0-9_.-]{1,128}$/);
export const customConnectionSchema=z.object({requestId:z.uuid(),label:z.string().trim().min(1).max(100),
  type:z.enum(['api','webhook','mcp']),endpoint:z.string().max(2048),secret:z.string().min(8).max(4096).optional(),
  authentication:z.enum(['none','bearer','api_key']).optional(),readOnlyTools:z.array(name).max(30).default([])}).strict();
type Config={endpoint:string;secret?:string;authentication:'none'|'bearer'|'api_key';readOnlyTools:string[]};
type Row={id:string;label:string;type:'api'|'webhook'|'mcp';endpoint_origin:string;ciphertext:string;has_secret:number;
  input_sha:string;status:string;revision:number;last_checked_at:string|null;last_check_status:string|null;created_at:string;updated_at:string};
export type CustomTool={name:string;title?:string;description?:string;effect:'read'|'write';inputSchema:Record<string,unknown>};
const permission=`EXISTS(SELECT 1 FROM agent_memberships m JOIN agent_tenants t ON t.id=m.tenant_id
 WHERE m.tenant_id=? AND m.user_id=? AND m.status='active' AND t.status='active'
 AND m.role IN ('owner','manager') AND (m.expires_at IS NULL OR m.expires_at>?))`;
const messages:Record<string,string>={
  invalid_connection_endpoint:'Use a public HTTPS address without login details, query parameters, or redirects.',
  invalid_connection_authentication:'Choose no authentication without a secret, or provide a secret for Bearer/API key authentication.',
  invalid_connection_secret:'Enter a single-line connection secret.',
  connection_custody_unavailable:'Secure credential storage is unavailable. Please contact support before reconnecting.',
  connection_not_found:'This connection is unavailable in your account and business. Refresh Connections.',
  connection_changed:'This connection changed. Refresh Connections and review the current settings.',
  connection_request_reused:'This request was already used with different settings. Refresh Connections before adding it.',
  connection_limit_or_permission:'You can have up to 10 active connections. Disconnect an unused one, or check your business role.',
  connection_rate_limited:'The connection request limit has been reached. Wait before checking or running another tool.',
  connection_request_limit:'This operation reached its request limit. No automatic retry will be made.',
  connection_response_too_large:'The service returned too much data. Request a smaller result.',
  connection_transport_unknown:'The service response could not be confirmed. Check the connected service; do not repeat an external action.',
  connection_redirect_refused:'The address redirects elsewhere. Enter the service’s direct HTTPS endpoint.',
  connection_provider_rejected:'The service rejected the request. Check the endpoint, credentials, and permissions in that service.',
  invalid_tool_input:'Review the tool arguments and send a valid JSON object.',
  tool_input_too_large:'The tool arguments are too large. Use a smaller request.',
  tool_not_found:'This tool is unavailable. Refresh the connection’s tool list.',
  tool_approval_required:'Review and approve the exact tool arguments in Connections before making an external change.',
  tool_request_already_used:'This action request has already been used or changed. Check its result in the connected service before doing anything else.',
  tool_approval_expired_or_used:'This approval expired or has already been used. Check the connected service; do not repeat an uncertain action.',
  tool_outcome_unknown_no_retry:'The result is unknown and the action may already have happened. Check the connected service. Do not repeat this action.',
  mcp_invalid_response:'The MCP server returned an unsupported or invalid response. Check its Streamable HTTP configuration.',
  mcp_invalid_session:'The MCP server returned an invalid session. Check its Streamable HTTP configuration.',
  mcp_tool_list_incomplete:'The MCP server has more tools than this connection can list. Use a server with a smaller tool set.',
  authentication_required:'Sign in before managing connections.',
  connection_route_not_found:'This connection action is unavailable. Refresh Connections.',
};
export function customConnectionErrorMessage(code:string){return Object.hasOwn(messages,code)?messages[code]:'The connection could not complete this request. Check its settings and tool arguments.';}
const failure=(code:string,status=400)=>new HttpError(status,code,customConnectionErrorMessage(code));

/** Global fetch is strictly public in Wrangler. Never use a service/VPC binding here. */
export function customEndpoint(value:string,origin:string):URL{
  const url=publicWebsiteUrl(value,origin);
  if(/(?:^|\.)(?:metadata|home|lan|corp|nip\.io|sslip\.io|localtest\.me)$/.test(url.hostname))throw failure('invalid_connection_endpoint');
  return url;
}
function stable(value:unknown,depth=0):string{
  if(depth>12)throw failure('invalid_tool_input');
  if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(v=>stable(v,depth+1)).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable((value as Record<string,unknown>)[k],depth+1)).join(',')+'}';
  throw failure('invalid_tool_input');
}
export function canonicalToolArgs(value:unknown):string{
  if(!value||Array.isArray(value)||typeof value!=='object')throw failure('invalid_tool_input');
  const text=stable(value);if(new TextEncoder().encode(text).length>CUSTOM_CONNECTION_LIMITS.inputBytes)throw failure('tool_input_too_large');return text;
}
// Same AES-256-GCM custody pattern as auth/vault, with a separate custom-connector domain.
const aad=(actor:Actor,id:string)=>new TextEncoder().encode(JSON.stringify(['mayor-custom-connection',actor.tenantId,actor.userId,id]));
const base64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));
const bytes=(text:string)=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
async function vaultKey(env:AuthEnv){
  if(!env.TOKEN_ENCRYPTION_KEY)throw failure('connection_custody_unavailable',503);
  let key:Uint8Array;try{key=bytes(env.TOKEN_ENCRYPTION_KEY);}catch{throw failure('connection_custody_unavailable',503);}
  if(key.length!==32)throw failure('connection_custody_unavailable',503);
  return crypto.subtle.importKey('raw',key,'AES-GCM',false,['encrypt','decrypt']);
}
async function seal(env:AuthEnv,actor:Actor,id:string,value:unknown){
  const iv=crypto.getRandomValues(new Uint8Array(12)),ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(actor,id)},await vaultKey(env),new TextEncoder().encode(JSON.stringify(value)));
  return `v1.${base64(iv)}.${base64(new Uint8Array(ciphertext))}`;
}
async function open<T>(env:AuthEnv,actor:Actor,id:string,ciphertext:string):Promise<T>{
  try{const [version,iv,data,extra]=ciphertext.split('.');if(version!=='v1'||!iv||!data||extra)throw new Error();
    const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv),additionalData:aad(actor,id)},await vaultKey(env),bytes(data));
    return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(plaintext)) as T;}
  catch{throw failure('connection_custody_unavailable',503);}
}
function view(row:Row){return {id:row.id,label:row.label,type:row.type,endpoint:row.endpoint_origin,status:row.status,
  hasSecret:row.has_secret===1,revision:row.revision,lastCheckedAt:row.last_checked_at,lastCheckStatus:row.last_check_status};}
async function owned(env:AuthEnv,actor:Actor,id:string,revision?:number){
  await requireMembership(env,actor,OPERATORS);
  const row=await env.AGENT_DB.prepare("SELECT * FROM mayor_custom_connections WHERE id=? AND tenant_id=? AND user_id=? AND status='connected'")
    .bind(z.uuid().parse(id),actor.tenantId,actor.userId).first<Row>();
  if(!row)throw failure('connection_not_found',404);
  if(revision!==undefined&&row.revision!==revision)throw failure('connection_changed',409);return row;
}
export async function listCustomConnections(env:AuthEnv,actor:Actor){
  await requireMembership(env,actor,OPERATORS);
  const rows=await env.AGENT_DB.prepare("SELECT * FROM mayor_custom_connections WHERE tenant_id=? AND user_id=? ORDER BY status='connected' DESC,created_at DESC LIMIT 10")
    .bind(actor.tenantId,actor.userId).all<Row>();
  await requireMembership(env,actor,OPERATORS);return {connections:rows.results.map(view),limits:CUSTOM_CONNECTION_LIMITS};
}
export async function addCustomConnection(env:AuthEnv,actor:Actor,raw:unknown){
  await requireMembership(env,actor,OPERATORS);const input=customConnectionSchema.parse(raw),endpoint=customEndpoint(input.endpoint,env.APP_ORIGIN);
  const authentication=input.authentication??(input.secret?'bearer':'none');
  if((authentication==='none')!==!input.secret)throw failure('invalid_connection_authentication');
  if(input.secret&&/[\r\n\x00]/.test(input.secret))throw failure('invalid_connection_secret');
  const readOnlyTools=[...new Set(input.readOnlyTools)].sort();
  const inputSha=await digest(stable([input.label,input.type,endpoint.href,authentication,input.secret??null,readOnlyTools]));
  const prior=await env.AGENT_DB.prepare('SELECT * FROM mayor_custom_connections WHERE tenant_id=? AND user_id=? AND request_id=?')
    .bind(actor.tenantId,actor.userId,input.requestId).first<Row>();
  if(prior){if(prior.input_sha!==inputSha)throw failure('connection_request_reused',409);return {connection:view(prior)};}
  const id=crypto.randomUUID(),now=new Date().toISOString(),ciphertext=await seal(env,actor,id,{endpoint:endpoint.href,secret:input.secret,authentication,readOnlyTools});
  const result=await env.AGENT_DB.prepare(`INSERT INTO mayor_custom_connections(id,tenant_id,user_id,request_id,input_sha,label,type,endpoint_origin,ciphertext,has_secret,created_at,updated_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ${permission} AND (SELECT COUNT(*) FROM mayor_custom_connections WHERE tenant_id=? AND user_id=? AND status='connected')<10`)
    .bind(id,actor.tenantId,actor.userId,input.requestId,inputSha,input.label,input.type,endpoint.origin,ciphertext,input.secret?1:0,now,now,
      actor.tenantId,actor.userId,now,actor.tenantId,actor.userId).run();
  if(result.meta.changes!==1)throw failure('connection_limit_or_permission',409);return {connection:view(await owned(env,actor,id))};
}
export async function disconnectCustomConnection(env:AuthEnv,actor:Actor,id:string,revision:number){
  await owned(env,actor,id,revision);const now=new Date().toISOString();
  const result=await env.AGENT_DB.prepare(`UPDATE mayor_custom_connections SET status='disconnected',ciphertext='',has_secret=0,revision=revision+1,updated_at=?
    WHERE id=? AND tenant_id=? AND user_id=? AND revision=? AND ${permission}`)
    .bind(now,id,actor.tenantId,actor.userId,revision,actor.tenantId,actor.userId,now).run();
  if(result.meta.changes!==1)throw failure('connection_changed',409);return {id,status:'disconnected'};
}
async function reserveHttp(env:AuthEnv,actor:Actor){
  const now=Date.now(),subject=`custom:${actor.tenantId}:${actor.userId}`;
  const results=await env.AGENT_DB.batch([env.AGENT_DB.prepare(`INSERT INTO mayor_rate_limits(subject,bucket,count) VALUES(?,?,1)
    ON CONFLICT(subject,bucket) DO UPDATE SET count=count+1 RETURNING count`).bind(subject+':minute',Math.floor(now/60000)),
  env.AGENT_DB.prepare(`INSERT INTO mayor_rate_limits(subject,bucket,count) VALUES(?,?,1)
    ON CONFLICT(subject,bucket) DO UPDATE SET count=count+1 RETURNING count`).bind(subject+':day',Math.floor(now/86400000))]);
  if(results.some((r,i)=>Number((r.results[0] as {count:number})?.count)>(i===0?12:100)))throw failure('connection_rate_limited',429);
}
async function responseText(response:Response){
  const reader=response.body?.getReader();if(!reader)return '';let size=0;const chunks:Uint8Array[]=[];
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>65536)throw failure('connection_response_too_large',502);chunks.push(part.value);}}
  finally{await reader.cancel().catch(()=>{});}
  const all=new Uint8Array(size);let offset=0;for(const part of chunks){all.set(part,offset);offset+=part.length;}return new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(all);
}
export function safeConnectorResult(value:unknown,secret?:string,depth=0):unknown{
  if(depth>8)return '[truncated]';
  if(typeof value==='string')return (secret?value.split(secret).join('[redacted]'):value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').slice(0,4000);
  if(value===null||typeof value==='number'||typeof value==='boolean')return value;
  if(Array.isArray(value))return value.slice(0,50).map(v=>safeConnectorResult(v,secret,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,50).filter(([k])=>!/(?:token|secret|authorization|cookie|password|credential|api.?key)/i.test(k))
    .map(([k,v])=>[k.slice(0,100),safeConnectorResult(v,secret,depth+1)]));return null;
}
function client(env:AuthEnv,actor:Actor,row:Row,config:Config,transport:typeof fetch){
  // One shared outbound deadline for the whole MCP exchange, including response bodies.
  // Local DB authorization/budget checks are additional overhead, not new HTTP windows.
  const signal=AbortSignal.timeout(CUSTOM_CONNECTION_LIMITS.timeoutMs);let requests=0;
  return async(method:string,body?:unknown,extra:Record<string,string>={},query?:Record<string,string|number|boolean>)=>{
    if(++requests>5)throw failure('connection_request_limit',429);
    await owned(env,actor,row.id,row.revision);await reserveHttp(env,actor);
    const url=customEndpoint(config.endpoint,env.APP_ORIGIN);for(const [key,value] of Object.entries(query??{}))url.searchParams.set(key,String(value));
    const headers=new Headers({accept:'application/json, text/event-stream',...extra});
    if(config.secret)headers.set(config.authentication==='api_key'?'x-api-key':'authorization',config.authentication==='api_key'?config.secret:'Bearer '+config.secret);
    if(body!==undefined)headers.set('content-type','application/json');
    let response:Response;try{response=await transport(url.href,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual',signal});}
    catch{throw failure('connection_transport_unknown',502);}
    if(response.status>=300&&response.status<400){await response.body?.cancel();throw failure('connection_redirect_refused',502);}
    if(!response.ok){await response.body?.cancel();throw failure('connection_provider_rejected',502);}
    const text=await responseText(response);await owned(env,actor,row.id,row.revision);return {text,headers:response.headers,status:response.status};
  };
}
export function parseMcpResponse(text:string,id:string,contentType:string){
  const messages:unknown[]=contentType.includes('text/event-stream')?text.split(/\r?\n\r?\n/).filter(Boolean).map(frame=>{
    const data=frame.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');return data?JSON.parse(data):null;
  }).filter(Boolean):[JSON.parse(text)];
  if(messages.length>32)throw failure('mcp_invalid_response',502);
  const matches=messages.filter((value):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&(value as Record<string,unknown>).id===id));
  if(matches.length!==1||matches[0].jsonrpc!=='2.0'||'error' in matches[0]||!('result' in matches[0]))throw failure('mcp_invalid_response',502);return matches[0].result;
}
async function mcp(env:AuthEnv,actor:Actor,row:Row,config:Config,transport:typeof fetch){
  const send=client(env,actor,row,config,transport),id=crypto.randomUUID();
  const initial=await send('POST',{jsonrpc:'2.0',id,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'Mayor',version:'1.0'}}});
  const init=z.object({protocolVersion:z.enum(['2025-03-26','2025-06-18','2025-11-25']),capabilities:z.object({tools:z.unknown().optional()})}).passthrough()
    .parse(parseMcpResponse(initial.text,id,initial.headers.get('content-type')??''));
  const session=initial.headers.get('mcp-session-id');if(session&&(!/^[\x21-\x7e]{1,512}$/.test(session)))throw failure('mcp_invalid_session',502);
  const headers:Record<string,string>={'MCP-Protocol-Version':init.protocolVersion};if(session)headers['Mcp-Session-Id']=session;
  await send('POST',{jsonrpc:'2.0',method:'notifications/initialized'},headers);
  return {call:async(method:string,params:unknown)=>{const id=crypto.randomUUID(),response=await send('POST',{jsonrpc:'2.0',id,method,params},headers);
    return parseMcpResponse(response.text,id,response.headers.get('content-type')??'');}};
}
const apiArgs=z.object({method:z.enum(['GET','POST','PUT','PATCH','DELETE']).default('GET'),query:z.record(z.string().max(100),z.union([z.string().max(2000),z.number().finite(),z.boolean()])).optional(),body:z.unknown().optional()}).strict();
const mcpTool=z.object({name,title:z.string().max(200).optional(),description:z.string().max(2000).optional(),inputSchema:z.record(z.string(),z.unknown())});
async function toolsFor(env:AuthEnv,actor:Actor,row:Row,config:Config,transport:typeof fetch):Promise<CustomTool[]>{
  if(row.type!=='mcp')return [{name:row.type==='webhook'?'send':'request',title:row.type==='webhook'?'Send to webhook':'API request',effect:'write',
    inputSchema:row.type==='webhook'?{type:'object'}:{type:'object',properties:{method:{enum:['GET','POST','PUT','PATCH','DELETE']},query:{type:'object'},body:{}},additionalProperties:false}}];
  const session=await mcp(env,actor,row,config,transport),result=z.object({tools:z.array(mcpTool).max(30),nextCursor:z.string().optional()}).parse(await session.call('tools/list',{}));
  if(result.nextCursor)throw failure('mcp_tool_list_incomplete',409);
  if(new Set(result.tools.map(t=>t.name)).size!==result.tools.length)throw failure('mcp_invalid_response',502);
  return result.tools.map(t=>({...t,effect:config.readOnlyTools.includes(t.name)?'read':'write'}));
}
export async function listCustomTools(env:AuthEnv,actor:Actor,id:string,transport:typeof fetch=fetch){
  const row=await owned(env,actor,id),config=await open<Config>(env,actor,row.id,row.ciphertext);
  return {tools:safeConnectorResult(await toolsFor(env,actor,row,config,transport),config.secret),untrusted:true};
}
export async function checkCustomConnection(env:AuthEnv,actor:Actor,id:string,transport:typeof fetch=fetch){
  const row=await owned(env,actor,id),config=await open<Config>(env,actor,id,row.ciphertext);customEndpoint(config.endpoint,env.APP_ORIGIN);
  let status='configured',toolCount:number|undefined;
  if(row.type==='mcp'){toolCount=(await toolsFor(env,actor,row,config,transport)).length;status='reachable';}
  else if(row.type==='api'){await client(env,actor,row,config,transport)('HEAD');status='reachable';}
  // Checking a webhook never sends a delivery, including an empty test message.
  await owned(env,actor,id,row.revision);const at=new Date().toISOString();
  await env.AGENT_DB.prepare('UPDATE mayor_custom_connections SET last_checked_at=?,last_check_status=? WHERE id=? AND tenant_id=? AND user_id=? AND revision=?')
    .bind(at,status,id,actor.tenantId,actor.userId,row.revision).run();return {id,status,toolCount,checkedAt:at};
}
function operation(row:Row,config:Config,tool:string,args:Record<string,unknown>){
  if(row.type==='api'){if(tool!=='request')throw failure('tool_not_found');const input=apiArgs.parse(args);if(input.method==='GET'&&input.body!==undefined)throw failure('invalid_tool_input');return input.method==='GET'?'read':'write';}
  if(row.type==='webhook'){if(tool!=='send')throw failure('tool_not_found');return 'write';}
  name.parse(tool);return config.readOnlyTools.includes(tool)?'read':'write';
}
async function execute(env:AuthEnv,actor:Actor,row:Row,config:Config,tool:string,args:Record<string,unknown>,transport:typeof fetch){
  let result:unknown;
  if(row.type==='mcp'){
    const session=await mcp(env,actor,row,config,transport);
    const listed=z.object({tools:z.array(mcpTool).max(30),nextCursor:z.string().optional()}).parse(await session.call('tools/list',{}));
    if(listed.nextCursor||!listed.tools.some(t=>t.name===tool))throw failure('tool_not_found');
    result=await session.call('tools/call',{name:tool,arguments:args});
  }else{
    const input=row.type==='api'?apiArgs.parse(args):{method:'POST',body:args,query:undefined};
    const response=await client(env,actor,row,config,transport)(input.method,input.body,{},input.query);
    try{result=JSON.parse(response.text);}catch{result=response.text;}
  }
  await owned(env,actor,row.id,row.revision);return {result:safeConnectorResult(result,config.secret),untrusted:true,truncated:true};
}
/** Assistant boundary: configured read operations only. Never accepts an approval boolean. */
export async function readCustomTool(env:AuthEnv,actor:Actor,id:string,tool:string,args:Record<string,unknown>,transport:typeof fetch=fetch){
  canonicalToolArgs(args);const row=await owned(env,actor,id),config=await open<Config>(env,actor,id,row.ciphertext);
  if(operation(row,config,tool,args)!=='read')throw failure('tool_approval_required',409);return execute(env,actor,row,config,tool,args,transport);
}
export async function prepareCustomTool(env:AuthEnv,actor:Actor,raw:unknown){
  const input=z.object({connectionId:z.uuid(),tool:name,args:z.record(z.string(),z.unknown()),requestId:z.uuid()}).strict().parse(raw);
  const text=canonicalToolArgs(input.args),row=await owned(env,actor,input.connectionId),config=await open<Config>(env,actor,row.id,row.ciphertext);
  const effect=operation(row,config,input.tool,input.args),now=new Date().toISOString(),expiresAt=new Date(Date.now()+300000).toISOString(),id=crypto.randomUUID();
  const inputSha=await digest(stable([row.id,row.revision,input.tool,JSON.parse(text)]));
  const prior=await env.AGENT_DB.prepare('SELECT id,input_sha,expires_at,state FROM mayor_custom_tool_proposals WHERE tenant_id=? AND user_id=? AND request_id=?')
    .bind(actor.tenantId,actor.userId,input.requestId).first<{id:string;input_sha:string;expires_at:string;state:string}>();
  if(prior&&(prior.input_sha!==inputSha||prior.state!=='prepared'))throw failure('tool_request_already_used',409);
  if(!prior)await env.AGENT_DB.prepare(`INSERT INTO mayor_custom_tool_proposals(id,tenant_id,user_id,connection_id,connection_revision,request_id,tool,effect,ciphertext,input_sha,created_at,expires_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ${permission}`)
    .bind(id,actor.tenantId,actor.userId,row.id,row.revision,input.requestId,input.tool,effect,await seal(env,actor,'proposal:'+id,JSON.parse(text)),inputSha,now,expiresAt,actor.tenantId,actor.userId,now).run();
  return {proposal:{id:prior?.id??id,expiresAt:prior?.expires_at??expiresAt,effect,connectionId:row.id,tool:input.tool,args:JSON.parse(text),
    readback:`${effect==='write'?'Approve external change':'Run read'}: ${row.label} (${row.endpoint_origin}), tool ${input.tool}. Review the exact arguments below.`}};
}
/** UI-only approval boundary: consume before sending. Unknown outcomes cannot be replayed. */
export async function confirmCustomTool(env:AuthEnv,actor:Actor,proposalId:string,transport:typeof fetch=fetch){
  await requireMembership(env,actor,OPERATORS);const now=new Date().toISOString();
  const proposal=await env.AGENT_DB.prepare(`UPDATE mayor_custom_tool_proposals SET state='running'
    WHERE id=? AND tenant_id=? AND user_id=? AND state='prepared' AND expires_at>? AND ${permission}
    AND EXISTS(SELECT 1 FROM mayor_custom_connections c WHERE c.id=mayor_custom_tool_proposals.connection_id
      AND c.tenant_id=mayor_custom_tool_proposals.tenant_id AND c.user_id=mayor_custom_tool_proposals.user_id
      AND c.status='connected' AND c.revision=mayor_custom_tool_proposals.connection_revision)
    RETURNING *`).bind(z.uuid().parse(proposalId),actor.tenantId,actor.userId,now,actor.tenantId,actor.userId,now)
    .first<{id:string;connection_id:string;connection_revision:number;tool:string;effect:string;ciphertext:string;input_sha:string}>();
  if(!proposal)throw failure('tool_approval_expired_or_used',409);
  try{
    const row=await owned(env,actor,proposal.connection_id,proposal.connection_revision),config=await open<Config>(env,actor,row.id,row.ciphertext);
    const args=await open<Record<string,unknown>>(env,actor,'proposal:'+proposal.id,proposal.ciphertext);
    if(await digest(stable([row.id,row.revision,proposal.tool,args]))!==proposal.input_sha||operation(row,config,proposal.tool,args)!==proposal.effect)throw failure('connection_changed',409);
    const result=await execute(env,actor,row,config,proposal.tool,args,transport);
    await env.AGENT_DB.prepare("UPDATE mayor_custom_tool_proposals SET state='completed',ciphertext='',result_json=? WHERE id=? AND tenant_id=? AND user_id=?")
      .bind(JSON.stringify(result),proposal.id,actor.tenantId,actor.userId).run();return {...result,proposalId:proposal.id,state:'completed'};
  }catch{
    await env.AGENT_DB.prepare("UPDATE mayor_custom_tool_proposals SET state='unknown',ciphertext='' WHERE id=? AND tenant_id=? AND user_id=?")
      .bind(proposal.id,actor.tenantId,actor.userId).run();throw failure('tool_outcome_unknown_no_retry',409);
  }
}
/** Root may pass its authenticated Actor; otherwise this handler obtains the existing session. */
export async function handleCustomConnectionsRequest(request:Request,env:AuthEnv,authenticatedActor?:Actor):Promise<Response|null>{
  const match=new URL(request.url).pathname.match(/^\/api\/businesses\/([^/]+)\/connections(?:\/(.*))?$/);if(!match)return null;
  try{
    const session=authenticatedActor?null:await getSession(request,env);const actor=authenticatedActor??(session?{tenantId:match[1],userId:session.user.id}:null);
    if(!actor)throw failure('authentication_required',401);if(actor.tenantId!==match[1])throw failure('connection_not_found',404);
    await requireMembership(env,actor,OPERATORS);const action=match[2]??'';
    if(request.method==='GET'&&action==='')return json(await listCustomConnections(env,actor));
    if(request.method==='GET'&&action.endsWith('/tools'))return json(await listCustomTools(env,actor,action.slice(0,-6)));
    if(request.method!=='POST')throw failure('connection_route_not_found',404);requireOrigin(request,env.APP_ORIGIN);
    const input=await readJson(request,16384);
    if(action==='add')return json(await addCustomConnection(env,actor,input));
    if(action==='tools/prepare')return json(await prepareCustomTool(env,actor,input));
    if(action==='tools/confirm'){const data=z.object({proposalId:z.uuid(),approved:z.literal(true)}).strict().parse(input);return json(await confirmCustomTool(env,actor,data.proposalId));}
    const item=action.match(/^([a-f0-9-]{36})\/(check|disconnect)$/);if(!item)throw failure('connection_route_not_found',404);
    if(item[2]==='check'){z.object({}).strict().parse(input);return json(await checkCustomConnection(env,actor,item[1]));}
    const data=z.object({revision:z.number().int().min(1)}).strict().parse(input);return json(await disconnectCustomConnection(env,actor,item[1],data.revision));
  }catch(error){if(error instanceof HttpError)return json({error:error.code,message:error.message},error.status);
    return json({error:'invalid_connection_request',message:'Check the connection settings and tool arguments, then try again.'},400);}
}
