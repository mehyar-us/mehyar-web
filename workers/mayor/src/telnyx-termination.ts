import {z} from 'zod';
import type {Env} from './env';
import {readJson} from './http';
import {telnyxWebhookConnection,telnyxCallCredential} from './telnyx-connections';
import {phoneWriteAccess} from './phone-write-access';

/** Internal stop: local access ends before any network request. HTTP acceptance
 * is not proof of PSTN termination; only a signed hangup confirms ended. */
export async function terminateTelnyxCall(env:Env,id:string,transport:typeof fetch=fetch){
 if(env.PHONE_TEST_ENABLED!=='true'||!z.uuid().safeParse(id).success)throw new Error('call_unavailable');
 const call=await env.AGENT_DB.prepare('SELECT tenant_id,connection_id,connection_revision,call_control_id FROM mayor_telnyx_admissions WHERE id=?').bind(id)
 .first<{tenant_id:string;connection_id:string;connection_revision:number;call_control_id:string}>();
 if(!call)throw new Error('call_unavailable');
 const now=new Date().toISOString();
 await env.AGENT_DB.batch([
  env.AGENT_DB.prepare("INSERT OR IGNORE INTO mayor_telnyx_terminations(admission_id,command_id,state,updated_at) VALUES(?,?,'queued',?)").bind(id,crypto.randomUUID(),now),
  env.AGENT_DB.prepare('INSERT OR IGNORE INTO mayor_telnyx_ended_calls(connection_id,call_control_id,event_id,ended_at,provider_confirmed) VALUES(?,?,?,?,0)').bind(call.connection_id,call.call_control_id,'local:'+id,now),
  env.AGENT_DB.prepare("UPDATE mayor_telnyx_terminations SET state='ended',updated_at=? WHERE admission_id=? AND EXISTS(SELECT 1 FROM mayor_telnyx_ended_calls WHERE connection_id=? AND call_control_id=? AND provider_confirmed=1)").bind(now,id,call.connection_id,call.call_control_id),
 ]);
 const current=await env.AGENT_DB.prepare('SELECT command_id,state FROM mayor_telnyx_terminations WHERE admission_id=?').bind(id).first<{command_id:string;state:string}>();
 if(!current)throw new Error('call_unavailable');if(current.state!=='queued')return {state:current.state};
 let auth:Awaited<ReturnType<typeof telnyxWebhookConnection>>,key:string;
 try{
  auth=await telnyxWebhookConnection(env,call.tenant_id);
  if(auth.row.id!==call.connection_id||auth.row.revision!==call.connection_revision)throw new Error();
  key=(await telnyxCallCredential(env,call.tenant_id,call.connection_revision,'voice.write',transport)).apiKey;
 }catch{
  await env.AGENT_DB.prepare("UPDATE mayor_telnyx_terminations SET state='blocked',updated_at=? WHERE admission_id=? AND state='queued'").bind(now,id).run();
  return {state:(await env.AGENT_DB.prepare('SELECT state FROM mayor_telnyx_terminations WHERE admission_id=?').bind(id).first<{state:string}>())!.state};
 }
 const claimed=await env.AGENT_DB.prepare(`UPDATE mayor_telnyx_terminations SET state='dispatching',updated_at=? WHERE admission_id=? AND state='queued'
 AND ${phoneWriteAccess} AND EXISTS(SELECT 1 FROM mayor_phone_connections WHERE id=? AND revision=? AND status='authorized') RETURNING command_id`)
 .bind(now,id,call.tenant_id,auth.row.owner_user_id,call.connection_id,call.connection_revision).first();
 if(!claimed)return {state:(await env.AGENT_DB.prepare('SELECT state FROM mayor_telnyx_terminations WHERE admission_id=?').bind(id).first<{state:string}>())!.state};
 let state='uncertain';
 try{
  const response=await transport(`https://api.telnyx.com/v2/calls/${encodeURIComponent(call.call_control_id)}/actions/hangup`,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(12000),headers:{authorization:'Bearer '+key,'content-type':'application/json',accept:'application/json'},body:JSON.stringify({command_id:current.command_id})});
  if(response.ok&&response.headers.get('content-type')?.toLowerCase().startsWith('application/json')){
   const body=await readJson(new Request('https://internal.invalid',{method:'POST',headers:{'content-type':'application/json'},body:response.body}),16384);
   if(z.object({data:z.object({result:z.literal('ok')})}).safeParse(body).success)state='accepted';
  }else await response.body?.cancel();
 }catch{/* Keep uncertain; never retry an ambiguous provider command. */}
 await env.AGENT_DB.prepare("UPDATE mayor_telnyx_terminations SET state=?,updated_at=? WHERE admission_id=? AND state='dispatching'").bind(state,new Date().toISOString(),id).run();
 return {state:(await env.AGENT_DB.prepare('SELECT state FROM mayor_telnyx_terminations WHERE admission_id=?').bind(id).first<{state:string}>())!.state};
}
