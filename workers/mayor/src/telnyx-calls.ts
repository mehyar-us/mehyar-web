import type {Env} from './env';
import {HttpError} from './http';
import {readTelnyxCallEvent} from './telnyx-webhook';
import {telnyxWebhookConnection} from './telnyx-connections';
import {admitTelnyxEvent} from './telnyx-admission';
import {recordTelnyxHangupEvent} from './telnyx-hangup';
import {answerTelnyxAdmission} from './telnyx-answer';
import {consumeTelnyxStreamGrant} from './telnyx-stream-grant';
import {activateTelnyxPhoneCall} from './telnyx-phone-call';
import {attachVerifiedTelnyxStream} from './telnyx-prompts';
import {terminateTelnyxCall} from './telnyx-termination';
export type PhoneLifetime={waitUntil(work:Promise<unknown>):void};
export async function receiveTelnyxCall(request:Request,env:Env,tenantId:string,lifetime:PhoneLifetime,transport:typeof fetch=fetch){
 if(env.PHONE_TEST_ENABLED!=='true')throw new HttpError(503,'phone_tests_disabled','Phone tests are disabled.');
 const {row,inbound}=await telnyxWebhookConnection(env,tenantId);
 const event=await readTelnyxCallEvent(request,inbound.publicKey);
 if(!event)return new Response(null,{status:204});
 if(event.event_type==='call.hangup')await recordTelnyxHangupEvent(env,tenantId,event,row.revision);
 else{
  const admission=await admitTelnyxEvent(env,tenantId,event,row.revision,transport);
  lifetime.waitUntil(answerTelnyxAdmission(env,admission.id,transport).then(async result=>{
   if(result.state==='uncertain')await terminateTelnyxCall(env,admission.id,transport);
  }).catch(()=>{console.error(JSON.stringify({event:'telnyx_answer_incomplete'}));}));
 }
 return new Response(null,{status:204,headers:{'cache-control':'no-store'}});
}
export async function connectTelnyxStream(request:Request,env:Env,id:string,token:string,lifetime:PhoneLifetime,transport:typeof fetch=fetch){
 if(env.PHONE_TEST_ENABLED!=='true')throw new HttpError(503,'phone_tests_disabled','Phone tests are disabled.');
 if(request.method!=='GET'||request.headers.get('upgrade')?.toLowerCase()!=='websocket'||new URL(request.url).search)throw new HttpError(400,'invalid_stream','Invalid phone stream.');
 await consumeTelnyxStreamGrant(env,id,token);
 let agent:WebSocket|undefined,provider:WebSocket|undefined;
 const stop=()=>lifetime.waitUntil(terminateTelnyxCall(env,id,transport).catch(()=>{console.error(JSON.stringify({event:'telnyx_termination_incomplete'}));}));
 try{
  await activateTelnyxPhoneCall(env,id);
  // Fresh internal headers: never forward browser cookies, auth or identity.
  const internal=new Request('https://internal.invalid/agents/mayor-phone/'+id,{headers:{upgrade:'websocket','x-mayor-call':id}});
  const response=await env.MAYOR_PHONE.get(env.MAYOR_PHONE.idFromName(id)).fetch(internal);
  if(response.status!==101||!response.webSocket){await response.body?.cancel();throw new Error('phone_agent_unavailable');}
  agent=response.webSocket;agent.accept();
  const pair=new WebSocketPair();provider=pair[1];provider.accept();
  await attachVerifiedTelnyxStream(env,id,provider,agent,transport,stop);
  return new Response(null,{status:101,webSocket:pair[0]});
 }catch(error){for(const socket of [provider,agent])try{socket?.close(1011,'Call unavailable');}catch{}stop();throw error;}
}
