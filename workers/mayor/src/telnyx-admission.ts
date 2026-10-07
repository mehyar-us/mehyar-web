import type {Env} from './env';
import {HttpError,digest} from './http';
import {telnyxWebhookConnection,verifyTelnyxInboundBinding} from './telnyx-connections';
import {readTelnyxInitiated} from './telnyx-webhook';
import {phoneWriteAccess} from './phone-write-access';
import {requireRecordingConsent} from './phone-recording-consent';

/** Internal prerequisite, not a public endpoint. A DB trigger atomically enqueues
 * answer intent; duplicates must observe durable command state, never replay.
 * Receipts are retained across reconnects so old calls cannot be newly admitted. */
export async function admitTelnyxInitiated(env:Env,tenantId:string,request:Request,transport:typeof fetch=fetch){
 if(env.PHONE_TEST_ENABLED!=='true')throw new HttpError(503,'phone_tests_disabled','Phone tests are disabled.');
 const {row,inbound}=await telnyxWebhookConnection(env,tenantId);
 const event=await readTelnyxInitiated(request,inbound.publicKey);
 return admitTelnyxEvent(env,tenantId,event,row.revision,transport);
}
/** Only pass an event from the signed webhook reader and its connection revision. */
export async function admitTelnyxEvent(env:Env,tenantId:string,event:Awaited<ReturnType<typeof readTelnyxInitiated>>,revision:number,transport:typeof fetch=fetch){
 if(env.PHONE_TEST_ENABLED!=='true')throw new HttpError(503,'phone_tests_disabled','Phone tests are disabled.');
 await requireRecordingConsent(env,tenantId);
 const {row,inbound}=await telnyxWebhookConnection(env,tenantId),call=event.payload;
 if(row.revision!==revision)throw new HttpError(409,'connection_changed','Phone connection changed.');
 if(call.connection_id!==inbound.applicationId||call.from!==inbound.testCaller||call.to!==row.selected_number)throw new HttpError(403,'call_not_designated','This call is not designated for testing.');
 await verifyTelnyxInboundBinding(env,tenantId,row.revision,transport);
 const payloadHash=await digest(JSON.stringify(event)),id=crypto.randomUUID(),now=new Date().toISOString();
 await env.AGENT_DB.prepare(`INSERT OR IGNORE INTO mayor_telnyx_admissions(id,event_id,tenant_id,connection_id,connection_revision,call_control_id,payload_hash,created_at,call_session_id,calling_number,called_number)
 SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM mayor_phone_connections p WHERE p.id=? AND p.tenant_id=? AND p.provider='telnyx' AND p.status='authorized' AND p.revision=? AND p.selected_number=?) AND ${phoneWriteAccess}`).bind(id,event.id,tenantId,row.id,row.revision,call.call_control_id,payloadHash,now,call.call_session_id,call.from,call.to,row.id,tenantId,row.revision,call.to,tenantId,row.owner_user_id).run();
 const current=await telnyxWebhookConnection(env,tenantId);
 if(current.row.revision!==row.revision)throw new HttpError(409,'connection_changed','Phone connection changed.');
 const receipt=await env.AGENT_DB.prepare('SELECT id,event_id,tenant_id,connection_id,connection_revision,payload_hash FROM mayor_telnyx_admissions WHERE event_id=? OR (connection_id=? AND call_control_id=?)').bind(event.id,row.id,call.call_control_id).all<{id:string;event_id:string;tenant_id:string;connection_id:string;connection_revision:number;payload_hash:string}>();
 if(receipt.results.length!==1)throw new HttpError(409,'call_admission_conflict','Call admission could not be verified.');
 const existing=receipt.results[0];
 if(existing.tenant_id!==tenantId||existing.connection_id!==row.id||existing.connection_revision!==row.revision||existing.event_id!==event.id||existing.payload_hash!==payloadHash)throw new HttpError(409,'call_admission_conflict','Call admission does not match the original event.');
 return {id:existing.id,newAdmission:existing.id===id,event,connectionRevision:row.revision};
}

