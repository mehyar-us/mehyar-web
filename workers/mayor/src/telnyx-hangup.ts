import type {Env} from './env';
import {HttpError} from './http';
import {telnyxWebhookConnection} from './telnyx-connections';
import {readTelnyxHangup} from './telnyx-webhook';
import {phoneWriteAccess} from './phone-write-access';

/** Internal terminal receipt. No provider request: termination must survive provider outages.
 * The migration atomically cancels queued answers and invalidates unused stream grants.
 * Already-running sockets still require the outer call lifecycle to close them. */
export async function recordTelnyxHangup(env:Env,tenantId:string,request:Request){
 if(env.PHONE_TEST_ENABLED!=='true')throw new HttpError(503,'phone_tests_disabled','Phone tests are disabled.');
 const {row,inbound}=await telnyxWebhookConnection(env,tenantId);
 const event=await readTelnyxHangup(request,inbound.publicKey);
 return recordTelnyxHangupEvent(env,tenantId,event,row.revision);
}
/** Only pass an event from the signed webhook reader and its connection revision. */
export async function recordTelnyxHangupEvent(env:Env,tenantId:string,event:Awaited<ReturnType<typeof readTelnyxHangup>>,revision:number){
 if(env.PHONE_TEST_ENABLED!=='true')throw new HttpError(503,'phone_tests_disabled','Phone tests are disabled.');
 const {row,inbound}=await telnyxWebhookConnection(env,tenantId),call=event.payload;
 if(row.revision!==revision)throw new HttpError(409,'connection_changed','Phone connection changed.');
 if(call.connection_id!==inbound.applicationId||call.from!==inbound.testCaller||call.to!==row.selected_number)throw new HttpError(403,'call_not_designated','This call is not designated for testing.');
 await env.AGENT_DB.prepare(`INSERT INTO mayor_telnyx_ended_calls(connection_id,call_control_id,event_id,ended_at)
 SELECT ?,?,?,? WHERE ${phoneWriteAccess} AND EXISTS(SELECT 1 FROM mayor_phone_connections WHERE id=? AND revision=? AND status='authorized') ON CONFLICT(connection_id,call_control_id) DO UPDATE SET provider_confirmed=1,event_id=excluded.event_id,ended_at=excluded.ended_at`)
 .bind(row.id,call.call_control_id,event.id,event.occurred_at,tenantId,row.owner_user_id,row.id,row.revision).run();
 const receipt=await env.AGENT_DB.prepare('SELECT event_id FROM mayor_telnyx_ended_calls WHERE connection_id=? AND call_control_id=?').bind(row.id,call.call_control_id).first();
 if(!receipt)throw new HttpError(409,'connection_changed','Phone connection changed.');
 return {callControlId:call.call_control_id,ended:true as const};
}
