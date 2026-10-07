import {z} from 'zod';
import type {Env} from './env';
import {digest,readJson} from './http';
import {twilioWebhookConnection} from './phone-connections';
import {requirePhoneCall} from './phone-call-access';
import {readPendingTwilioAssistantName} from './phone-assistant-persona';

type Credential={accountSid:string;apiKeySid:string;apiKeySecret:string;verifyServiceSid?:string};
type Call={id:string;tenantId:string;number:string;revision:number};
type Verification={state:string;nonce:string;verification_sid:string|null;attempts:number;expires_at:string};
export type VerificationStep={id:string;nonce:string;action:'send'|'check'};
const escape=(text:string)=>text.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll("'",'&apos;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const unavailable='<Say>Phone verification is unavailable. You can still ask the AI for a callback. Appointment access is not enabled.</Say>';
const receiptSchema=z.object({sid:z.string().regex(/^VE[0-9a-fA-F]{32}$/),account_sid:z.string(),service_sid:z.string(),to:z.string(),channel:z.literal('sms'),status:z.string()});
async function verifyRequest(credential:Credential,action:'Verifications'|'VerificationCheck',body:URLSearchParams,transport:typeof fetch){
 const response=await transport(`https://verify.twilio.com/v2/Services/${credential.verifyServiceSid}/${action}`,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{authorization:'Basic '+btoa(`${credential.apiKeySid}:${credential.apiKeySecret}`),'content-type':'application/x-www-form-urlencoded'},body});
 if(!response.ok){await response.body?.cancel();throw new Error('verification_unavailable');}
 return receiptSchema.parse(await readJson(new Request('https://internal.invalid',{method:'POST',headers:{'content-type':'application/json'},body:response.body}),16384));
}
/** Returns only provider instructions; OTP digits are never persisted or sent to AI. */
export async function phoneVerification(env:Env,call:Call,credential:Credential,digits:string,step:VerificationStep|undefined,transport:typeof fetch=fetch):Promise<{body:string;connect:boolean}>{
 if(!credential.verifyServiceSid)return {body:step?'<Hangup/>':'',connect:!step};
 const now=new Date().toISOString();
 if(!step)await env.AGENT_DB.prepare("INSERT OR IGNORE INTO mayor_phone_verifications(call_id,tenant_id,connection_revision,state,nonce,expires_at,created_at) VALUES(?,?,?,'offered',?,?,?)")
  .bind(call.id,call.tenantId,call.revision,crypto.randomUUID(),new Date(Date.now()+300000).toISOString(),now).run();
 const row=await env.AGENT_DB.prepare('SELECT state,nonce,verification_sid,attempts,expires_at FROM mayor_phone_verifications WHERE call_id=? AND tenant_id=? AND connection_revision=?').bind(call.id,call.tenantId,call.revision).first<Verification>();
 if(!row||step&&(step.id!==call.id||step.nonce!==row.nonce))return {body:'<Hangup/>',connect:false};
 if(row.expires_at<=now)return {body:'<Hangup/>',connect:false};
 let name:string;
 try{name=await readPendingTwilioAssistantName(env,call);}
 catch{return {body:'<Hangup/>',connect:false};}
 const prompt=(action:'send'|'check',nonce:string)=>{
  const url=escape(`${env.APP_ORIGIN}/api/phone/twilio/verify/${call.tenantId}/${call.id}/${action}/${nonce}`);
  return {body:`<Gather input="dtmf" action="${url}" method="POST" timeout="15" actionOnEmptyResult="true" ${action==='send'?'numDigits="1"':'finishOnKey="#"'}><Say>${escape(action==='send'?`I am ${name}, an AI assistant. This is a test call. To verify control of your calling number, press 1 to receive a verification text. Message and data rates may apply. Press 2 to continue without verification. Appointment actions also require permission from the business.`:'Enter the code from our verification text using your keypad, then press pound. Do not say it aloud. To continue without verification, press pound.')}</Say></Gather>`,connect:false};
 };
 if(!step){
  if(row.state==='offered')return prompt('send',row.nonce);
  if(row.state==='pending')return prompt('check',row.nonce);
  return {body:['approved','declined','failed'].includes(row.state)?'':'<Hangup/>',connect:['approved','declined','failed'].includes(row.state)};
 }
 const expected=step.action==='send'?'offered':'pending';
 if(row.state!==expected)return {body:'<Hangup/>',connect:false};
 const nextNonce=crypto.randomUUID(),decline=step.action==='send'?digits!=='1':digits==='';
 const nextState=decline?'declined':step.action==='send'?'sending':'checking';
 const claimed=await env.AGENT_DB.prepare('UPDATE mayor_phone_verifications SET state=?,nonce=?,attempts=attempts+? WHERE call_id=? AND tenant_id=? AND state=? AND nonce=? AND expires_at>? RETURNING call_id')
  .bind(nextState,nextNonce,step.action==='check'&&!decline?1:0,call.id,call.tenantId,expected,step.nonce,now).first<{call_id:string}>();
 if(!claimed)return {body:'<Hangup/>',connect:false};
 if(decline)return {body:'<Say>Continuing without phone verification. You can ask for a callback.</Say>',connect:true};
 try{
  if(step.action==='send'){
   // One send per call, plus an atomic cross-call number budget. Failed sends
   // consume the budget too; uncertain requests are never automatically retried.
   const subject='phone-verify:'+await digest(`${call.tenantId}:${call.number}`),bucket=Math.floor(Date.now()/3600000);
   const quota=await env.AGENT_DB.prepare('INSERT INTO mayor_rate_limits(subject,bucket,count) VALUES(?,?,1) ON CONFLICT(subject,bucket) DO UPDATE SET count=count+1 RETURNING count').bind(subject,bucket).first<{count:number}>();
   if(!quota||quota.count>3)throw new Error('verification_limit');
  }else if(row.attempts>=5||!/^\d{4,10}$/.test(digits)||!row.verification_sid)throw new Error('verification_invalid');
  const body=step.action==='send'?new URLSearchParams({To:call.number,Channel:'sms'}):new URLSearchParams({VerificationSid:row.verification_sid!,Code:digits});
  const receipt=await verifyRequest(credential,step.action==='send'?'Verifications':'VerificationCheck',body,transport);
  if(receipt.account_sid!==credential.accountSid||receipt.service_sid!==credential.verifyServiceSid||receipt.to!==call.number||step.action==='check'&&receipt.sid!==row.verification_sid)throw new Error('verification_mismatch');
  const current=await twilioWebhookConnection(env,call.tenantId);
  if(current.row.revision!==call.revision)throw new Error('connection_changed');
  const state=step.action==='check'&&receipt.status==='approved'?'approved':receipt.status==='pending'&&(step.action==='send'||row.attempts+1<5)?'pending':'failed';
  const saved=await env.AGENT_DB.prepare('UPDATE mayor_phone_verifications SET state=?,verification_sid=? WHERE call_id=? AND state=? AND nonce=? AND expires_at>? AND EXISTS(SELECT 1 FROM mayor_phone_connections WHERE tenant_id=? AND provider=\'twilio\' AND revision=? AND status=\'authorized\') AND EXISTS(SELECT 1 FROM mayor_phone_calls WHERE id=? AND state=\'pending\' AND expires_at>?) RETURNING call_id')
   .bind(state,receipt.sid,call.id,nextState,nextNonce,new Date().toISOString(),call.tenantId,call.revision,call.id,new Date().toISOString()).first<{call_id:string}>();
  if(!saved)return {body:'<Hangup/>',connect:false};
  if(state==='pending')return prompt('check',nextNonce);
  return {body:state==='approved'?'<Say>Your calling number is verified for this call. Appointment lookup also requires permission from the business.</Say>':unavailable,connect:true};
 }catch{
  await env.AGENT_DB.prepare("UPDATE mayor_phone_verifications SET state='failed' WHERE call_id=? AND nonce=? AND state=?").bind(call.id,nextNonce,nextState).run();
  return {body:unavailable,connect:true};
 }
}

/** Number possession is not a customer identity or an appointment permission. */
export async function verifiedCallNumber(env:Env,callId:string){
 if(env.PHONE_TEST_ENABLED!=='true')return null;
 const now=new Date().toISOString();
 const row=await env.AGENT_DB.prepare("SELECT c.tenant_id,c.caller_number,c.connection_revision FROM mayor_phone_calls c JOIN mayor_phone_verifications v ON v.call_id=c.id AND v.tenant_id=c.tenant_id AND v.connection_revision=c.connection_revision AND v.provider=c.provider WHERE c.id=? AND c.state='streaming' AND c.expires_at>? AND v.state='approved' AND v.expires_at>?").bind(callId,now,now).first<{tenant_id:string;caller_number:string;connection_revision:number}>();
 if(!row)return null;
 try{await requirePhoneCall(env,callId);}catch{return null;}
 return {tenantId:row.tenant_id,number:row.caller_number,connectionRevision:row.connection_revision};
}
