import {TwilioAdapter} from '@cloudflare/voice-twilio';
import {z} from 'zod';
import type {Env} from './env';
import {HttpError,readJson} from './http';
import {twilioWebhookConnection} from './phone-connections';
import {phoneVerification,type VerificationStep} from './phone-verification';
import {readPendingTwilioAssistantName} from './phone-assistant-persona';

export async function validTwilioSignature(token:string,url:string,params:URLSearchParams,signature:string){
 if(!/^[A-Za-z0-9+/]{27}=$/.test(signature))return false;
 const keys=[...new Set(params.keys())].sort();
 // Our webhooks use scalar fields; duplicate fields are ambiguous and rejected.
 if(keys.some(key=>params.getAll(key).length!==1))return false;
 const input=url+keys.map(key=>key+params.get(key)).join('');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(token),{name:'HMAC',hash:'SHA-1'},false,['verify']);
 return crypto.subtle.verify('HMAC',key,Uint8Array.from(atob(signature),c=>c.charCodeAt(0)),new TextEncoder().encode(input));
}
const xml=(value:string)=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll("'",'&apos;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function twiml(body:string){return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`,{headers:{'content-type':'text/xml','cache-control':'no-store'}});}
async function boundedForm(request:Request){
 if(!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))throw new HttpError(415,'invalid_webhook','Invalid webhook.');
 const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'invalid_webhook','Invalid webhook.');
 let text='',size=0;const decoder=new TextDecoder();
 for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();throw new HttpError(413,'webhook_too_large','Invalid webhook.');}text+=decoder.decode(value,{stream:true});}
 return new URLSearchParams(text+decoder.decode());
}
export async function receiveTwilioCall(request:Request,env:Env,tenantId:string,transport:typeof fetch=fetch,verificationStep?:VerificationStep){
 if(env.PHONE_TEST_ENABLED!=='true')throw new HttpError(503,'phone_tests_disabled','Phone tests are disabled.');
 const {row,credential}=await twilioWebhookConnection(env,tenantId),params=await boundedForm(request);
 const url=env.APP_ORIGIN+new URL(request.url).pathname;
 if(new URL(request.url).search||!await validTwilioSignature(credential.authToken!,url,params,request.headers.get('x-twilio-signature')??''))throw new HttpError(403,'invalid_signature','Invalid signature.');
 const callSid=params.get('CallSid')??'';
 if(!/^CA[0-9a-fA-F]{32}$/.test(callSid)||params.get('AccountSid')!==credential.accountSid||params.get('To')!==row.selected_number||params.get('From')!==credential.testCaller)throw new HttpError(403,'call_not_allowed','This call is not allowed.');
 // Twilio signatures have no timestamp: verify the signed call is still live.
 const response=await transport(`https://api.twilio.com/2010-04-01/Accounts/${credential.accountSid}/Calls/${callSid}.json`,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{authorization:'Basic '+btoa(`${credential.apiKeySid}:${credential.apiKeySecret}`)}});
 if(!response.ok){await response.body?.cancel();throw new HttpError(403,'call_unverified','Call could not be verified.');}
 const call=z.object({sid:z.string(),account_sid:z.string(),from:z.string(),to:z.string(),direction:z.string(),status:z.string()}).parse(await readJson(new Request('https://internal.invalid',{method:'POST',headers:{'content-type':'application/json'},body:response.body}),16384));
 if(call.sid!==callSid||call.account_sid!==credential.accountSid||call.from!==credential.testCaller||call.to!==row.selected_number||call.direction!=='inbound'||!['ringing','in-progress'].includes(call.status))throw new HttpError(403,'call_not_live','Call is not active.');
 const current=await twilioWebhookConnection(env,tenantId);if(current.row.revision!==row.revision)throw new HttpError(409,'connection_changed','Connection changed.');
 const now=new Date().toISOString();
 if(!verificationStep)await env.AGENT_DB.prepare("INSERT OR IGNORE INTO mayor_phone_calls(id,tenant_id,account_id,call_sid,connection_revision,state,stream_expires_at,expires_at,created_at,caller_number) VALUES(?,?,?,?,?,'pending',?,?,?,?)")
  .bind(crypto.randomUUID(),tenantId,credential.accountSid,callSid,row.revision,new Date(Date.now()+(credential.verifyServiceSid?300000:120000)).toISOString(),new Date(Date.now()+900000).toISOString(),now,call.from).run();
 const admitted=await env.AGENT_DB.prepare('SELECT id,state,stream_expires_at,connection_revision FROM mayor_phone_calls WHERE account_id=? AND call_sid=? AND tenant_id=?').bind(credential.accountSid,callSid,tenantId).first<{id:string;state:string;stream_expires_at:string;connection_revision:number}>();
 if(!admitted||admitted.state!=='pending'||admitted.stream_expires_at<=now||admitted.connection_revision!==row.revision)return twiml('<Hangup/>');
 const verification=await phoneVerification(env,{id:admitted.id,tenantId,number:call.from,revision:row.revision},credential,params.get('Digits')??'',verificationStep,transport);
 if(!verification.connect)return twiml(verification.body);
 let name:string;
 try{name=await readPendingTwilioAssistantName(env,{id:admitted.id,tenantId,revision:row.revision});}
 catch{return twiml(`${verification.body}<Hangup/>`);}
 const stream=env.APP_ORIGIN.replace(/^https:/,'wss:')+`/api/phone/twilio/stream/${admitted.id}`;
 return twiml(`${verification.body}<Say>${xml(`Hello, I am ${name}, an AI assistant. This is a test call. Appointment actions require verification and permission from the business.`)}</Say><Connect><Stream url="${xml(stream)}"/></Connect><Hangup/>`);
}
export async function connectTwilioStream(request:Request,env:Env,id:string){
 if(env.PHONE_TEST_ENABLED!=='true')throw new HttpError(503,'phone_tests_disabled','Phone tests are disabled.');
 if(request.headers.get('upgrade')?.toLowerCase()!=='websocket')throw new HttpError(426,'websocket_required','WebSocket required.');
 const call=await env.AGENT_DB.prepare('SELECT tenant_id,connection_revision FROM mayor_phone_calls WHERE id=?').bind(id).first<{tenant_id:string;connection_revision:number}>();
 if(!call)throw new HttpError(404,'call_unavailable','Call unavailable.');
 const {row,credential}=await twilioWebhookConnection(env,call.tenant_id);
 const url=env.APP_ORIGIN+new URL(request.url).pathname,signature=request.headers.get('x-twilio-signature')??'';
 if(new URL(request.url).search||row.revision!==call.connection_revision||!(await validTwilioSignature(credential.authToken!,url,new URLSearchParams(),signature)||await validTwilioSignature(credential.authToken!,url.replace(/^https:/,'wss:'),new URLSearchParams(),signature)))throw new HttpError(403,'invalid_signature','Invalid signature.');
 if(credential.verifyServiceSid){
  const verification=await env.AGENT_DB.prepare('SELECT state FROM mayor_phone_verifications WHERE call_id=? AND tenant_id=? AND connection_revision=?').bind(id,call.tenant_id,call.connection_revision).first<{state:string}>();
  if(!verification||!['approved','declined','failed'].includes(verification.state))throw new HttpError(409,'verification_pending','Finish or decline phone verification first.');
 }
 const claimed=await env.AGENT_DB.prepare("UPDATE mayor_phone_calls SET state='streaming' WHERE id=? AND state='pending' AND stream_expires_at>?").bind(id,new Date().toISOString()).run();
 if(claimed.meta.changes!==1)throw new HttpError(409,'stream_already_used','This stream expired or has already been used.');
 // Adapter creates its internal socket without headers. This bound facade injects
 // only the verified call identity, never browser/session/owner permissions.
 let agentConnected=false;
 const namespace={idFromName:()=>env.MAYOR_PHONE.idFromName(id),get:()=>({fetch:(internal:Request)=>{
  if(agentConnected)return Promise.resolve(new Response('Call already connected',{status:409}));agentConnected=true;
  const headers=new Headers(internal.headers);headers.set('x-mayor-call',id);
  return env.MAYOR_PHONE.get(env.MAYOR_PHONE.idFromName(id)).fetch(new Request(internal,{headers}));
 }})};
 return TwilioAdapter.handleRequest(request,{MayorPhone:namespace},'MayorPhone',{instanceName:id});
}
