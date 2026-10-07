import {z} from 'zod';
import type {Env} from './env';
import {digest,HttpError,readJson} from './http';
import {phoneWriteAccess} from './phone-write-access';
import {telnyxCallCredential,telnyxWebhookConnection,verifyTelnyxInboundBinding} from './telnyx-connections';
import {issueTelnyxStreamGrant} from './telnyx-stream-grant';
import {freshTelnyxAdmission} from './telnyx-call-window';

/** Internal designated-call dispatcher. Not wired to public webhooks until the
 * stream route and provider termination/reconciliation lifecycle are ready. */
export async function answerTelnyxAdmission(env:Env,id:string,transport:typeof fetch=fetch){
 if(env.PHONE_TEST_ENABLED!=='true'||!z.uuid().safeParse(id).success)throw new HttpError(403,'call_unavailable','Phone call unavailable.');
 await env.AGENT_DB.prepare(`UPDATE mayor_telnyx_commands SET state='blocked',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE id=? AND state='queued' AND EXISTS(SELECT 1 FROM mayor_telnyx_admissions a WHERE a.id=mayor_telnyx_commands.id AND NOT ${freshTelnyxAdmission})`).bind(id).run();
 const call=await env.AGENT_DB.prepare(`SELECT a.tenant_id,a.connection_id,a.connection_revision,a.call_control_id,c.state
 FROM mayor_telnyx_admissions a JOIN mayor_telnyx_commands c ON c.id=a.id WHERE a.id=?`).bind(id)
 .first<{tenant_id:string;connection_id:string;connection_revision:number;call_control_id:string;state:string}>();
 if(!call)throw new HttpError(404,'call_unavailable','Phone call unavailable.');
 if(call.state!=='queued')return {state:call.state};
 const origin=new URL(env.APP_ORIGIN);
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('invalid_phone_origin');
 await verifyTelnyxInboundBinding(env,call.tenant_id,call.connection_revision,transport);
 const {row}=await telnyxWebhookConnection(env,call.tenant_id);
 if(row.id!==call.connection_id||row.revision!==call.connection_revision)throw new Error('phone_connection_changed');
 const credential=await telnyxCallCredential(env,call.tenant_id,call.connection_revision,'voice.write',transport);
 // Concurrent deliveries can pass preflight, but only one can issue this grant.
 const grant=await issueTelnyxStreamGrant(env,id);
 const claimed=await env.AGENT_DB.prepare(`UPDATE mayor_telnyx_commands SET state='dispatching',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE id=? AND state='queued' AND ${phoneWriteAccess}
 AND EXISTS(SELECT 1 FROM mayor_phone_connections WHERE id=? AND revision=? AND status='authorized')
 AND EXISTS(SELECT 1 FROM mayor_telnyx_admissions a WHERE a.id=mayor_telnyx_commands.id AND ${freshTelnyxAdmission})
 AND EXISTS(SELECT 1 FROM mayor_telnyx_stream_grants WHERE admission_id=? AND token_hash=? AND consumed_at IS NULL AND expires_at>unixepoch()*1000) RETURNING id`)
 .bind(id,call.tenant_id,row.owner_user_id,row.id,row.revision,id,await digest(grant.token)).first();
 if(!claimed)throw new Error('phone_dispatch_not_claimed');
 origin.protocol='wss:';origin.pathname=`/api/phone/telnyx/stream/${id}/${grant.token}`;
 let state:'accepted'|'uncertain'='uncertain';
 try{
  // Stable command_id adds provider deduplication. Never retry a timeout or
  // non-2xx response; HTTP acceptance alone does not prove the call was answered.
  const response=await transport(`https://api.telnyx.com/v2/calls/${encodeURIComponent(call.call_control_id)}/actions/answer`,{
   method:'POST',redirect:'manual',signal:AbortSignal.timeout(12000),headers:{authorization:`Bearer ${credential.apiKey}`,'content-type':'application/json',accept:'application/json'},
   body:JSON.stringify({command_id:id,stream_url:origin.href,stream_track:'inbound_track',stream_codec:'L16',stream_bidirectional_mode:'rtp',stream_bidirectional_codec:'L16',stream_bidirectional_sampling_rate:16000}),
  });
  if(response.ok&&response.headers.get('content-type')?.toLowerCase().startsWith('application/json')){
   const body=await readJson(new Request('https://internal.invalid',{method:'POST',headers:{'content-type':'application/json'},body:response.body}),16384);
   if(z.object({data:z.object({result:z.literal('ok')})}).safeParse(body).success)state='accepted';
  }else await response.body?.cancel();
 }catch{/* No provider payload, stream token or credential escapes into logs/UI. */}
 await env.AGENT_DB.prepare("UPDATE mayor_telnyx_commands SET state=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND state='dispatching'").bind(state,id).run();
 return {state};
}
