import {z} from 'zod';
import type {Env} from './env';
import {readJson} from './http';
import {telnyxWebhookConnection,telnyxCallCredential} from './telnyx-connections';
import {terminateTelnyxCall} from './telnyx-termination';

/** Read-only provider reconciliation. 404, timeout and is_alive:false without
 * an end timestamp do not establish termination. Never repeats a hangup POST. */
export async function reconcileTelnyxTermination(env:Env,id:string,transport:typeof fetch=fetch){
 if(env.PHONE_TEST_ENABLED!=='true')throw new Error('phone_tests_disabled');
 const call=await env.AGENT_DB.prepare('SELECT tenant_id,connection_id,connection_revision,call_control_id,call_session_id FROM mayor_telnyx_admissions WHERE id=?').bind(id)
 .first<{tenant_id:string;connection_id:string;connection_revision:number;call_control_id:string;call_session_id:string}>();
 if(!call||!call.call_session_id)throw new Error('call_unavailable');
 const ended=await env.AGENT_DB.prepare('SELECT 1 FROM mayor_telnyx_ended_calls WHERE connection_id=? AND call_control_id=? AND provider_confirmed=1').bind(call.connection_id,call.call_control_id).first();
 if(ended)return 'ended' as const;
 const {row}=await telnyxWebhookConnection(env,call.tenant_id);
 if(row.id!==call.connection_id||row.revision!==call.connection_revision)throw new Error('connection_changed');
 const key=(await telnyxCallCredential(env,call.tenant_id,call.connection_revision,'voice.read',transport)).apiKey;
 const response=await transport('https://api.telnyx.com/v2/calls/'+encodeURIComponent(call.call_control_id),{method:'GET',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{authorization:'Bearer '+key,accept:'application/json'}});
 if(!response.ok||!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')){await response.body?.cancel();return 'unknown' as const;}
 const result=z.object({data:z.object({call_control_id:z.literal(call.call_control_id),call_session_id:z.literal(call.call_session_id),record_type:z.literal('call'),is_alive:z.boolean(),end_time:z.iso.datetime({offset:true}).optional()})}).parse(await readJson(new Request('https://internal.invalid',{method:'POST',headers:{'content-type':'application/json'},body:response.body}),16384)).data;
 const current=await telnyxWebhookConnection(env,call.tenant_id);if(current.row.revision!==call.connection_revision)throw new Error('connection_changed');
 if(result.is_alive)return 'alive' as const;
 if(!result.end_time||Date.parse(result.end_time)>Date.now()+30000)return 'unknown' as const;
 await env.AGENT_DB.prepare(`INSERT INTO mayor_telnyx_ended_calls(connection_id,call_control_id,event_id,ended_at,provider_confirmed) VALUES(?,?,?,?,1)
 ON CONFLICT(connection_id,call_control_id) DO UPDATE SET provider_confirmed=1,ended_at=excluded.ended_at,event_id=excluded.event_id`)
 .bind(call.connection_id,call.call_control_id,'status:'+id,result.end_time).run();
 return 'ended' as const;
}
/** Small leased batches. Stop abandoned calls once; poll status at most six times
 * with backoff. Never resume an answer or grant additional caller access. */
export async function runTelnyxRecovery(env:Env,transport:typeof fetch=fetch,clock:()=>number=Date.now){
 const summary={checked:0,complete:0,review:0,skipped:0};if(env.PHONE_TEST_ENABLED!=='true')return summary;
 const now=clock();
 const exhausted=await env.AGENT_DB.prepare("UPDATE mayor_telnyx_recovery SET state='review',last_result='retry_limit' WHERE state='pending' AND attempts>=6 AND lease_until<=?").bind(now).run();
 summary.review+=exhausted.meta.changes;
 const candidates=await env.AGENT_DB.prepare(`SELECT a.id FROM mayor_telnyx_admissions a
 LEFT JOIN mayor_telnyx_stream_grants g ON g.admission_id=a.id
 LEFT JOIN mayor_telnyx_terminations t ON t.admission_id=a.id
 LEFT JOIN mayor_telnyx_recovery r ON r.admission_id=a.id
 WHERE NOT EXISTS(SELECT 1 FROM mayor_telnyx_ended_calls e WHERE e.connection_id=a.connection_id AND e.call_control_id=a.call_control_id AND e.provider_confirmed=1)
 AND (julianday(a.created_at)<julianday(?,'-15 minutes') OR (g.consumed_at IS NULL AND julianday(a.created_at)<julianday(?,'-2 minutes')) OR t.state IN ('queued','dispatching','accepted','uncertain','blocked'))
 AND (r.admission_id IS NULL OR (r.state='pending' AND r.attempts<6 AND r.next_attempt_at<=? AND r.lease_until<=?))
 ORDER BY COALESCE(r.next_attempt_at,0),a.created_at LIMIT 4`).bind(new Date(now).toISOString(),new Date(now).toISOString(),now,now).all<{id:string}>();
 for(const {id} of candidates.results){
  const token=crypto.randomUUID(),time=clock();
  const claimed=await env.AGENT_DB.prepare(`INSERT INTO mayor_telnyx_recovery(admission_id,attempts,state,lease_until,lease_token,next_attempt_at,last_result) VALUES(?,1,'pending',?,?,?,'checking')
 ON CONFLICT(admission_id) DO UPDATE SET attempts=attempts+1,lease_until=excluded.lease_until,lease_token=excluded.lease_token,last_result='checking'
 WHERE state='pending' AND attempts<6 AND lease_until<=? AND next_attempt_at<=? RETURNING attempts`)
  .bind(id,time+120000,token,time,time,time).first<{attempts:number}>();
  if(!claimed){summary.skipped++;continue;}summary.checked++;
  let outcome='unknown';
  try{await terminateTelnyxCall(env,id,transport);outcome=await reconcileTelnyxTermination(env,id,transport);}catch{/* Record no provider payload or identity. */}
  const state=outcome==='ended'?'complete':claimed.attempts>=6?'review':'pending';
  await env.AGENT_DB.prepare('UPDATE mayor_telnyx_recovery SET state=?,lease_until=0,next_attempt_at=?,last_result=? WHERE admission_id=? AND lease_token=?')
  .bind(state,clock()+Math.min(1800000,300000*claimed.attempts),outcome,id,token).run();
  if(state==='complete')summary.complete++;if(state==='review')summary.review++;
 }
 return summary;
}
