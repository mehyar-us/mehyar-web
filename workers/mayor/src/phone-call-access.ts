import type {Env} from './env';
import {twilioWebhookConnection} from './phone-connections';
import {requireTelnyxStreamAccess} from './telnyx-stream-access';

/** Resolve the provider from the durable call, never from client/model input.
 * This grants conversation access only, not verified customer permissions. */
export async function requirePhoneCall(env:Env,id:string){
 if(env.PHONE_TEST_ENABLED!=='true')throw new Error('call_unavailable');
 const call=await env.AGENT_DB.prepare("SELECT tenant_id,provider,connection_revision,caller_number FROM mayor_phone_calls WHERE id=? AND state='streaming' AND expires_at>?")
 .bind(id,new Date().toISOString()).first<{tenant_id:string;provider:string;connection_revision:number;caller_number:string|null}>();
 if(!call)throw new Error('call_unavailable');
 if(call.provider==='twilio'){
  const {row}=await twilioWebhookConnection(env,call.tenant_id);
  if(row.revision!==call.connection_revision)throw new Error('connection_changed');
 }else if(call.provider==='telnyx'){
  const binding=await requireTelnyxStreamAccess(env,id);
  const admission=await env.AGENT_DB.prepare('SELECT tenant_id,connection_revision FROM mayor_telnyx_admissions WHERE id=?').bind(id).first<{tenant_id:string;connection_revision:number}>();
  if(!admission||admission.tenant_id!==call.tenant_id||admission.connection_revision!==call.connection_revision||binding.from!==call.caller_number)throw new Error('call_unavailable');
 }else throw new Error('call_unavailable');
 return {id,tenantId:call.tenant_id,provider:call.provider,connectionRevision:call.connection_revision,number:call.caller_number};
}
