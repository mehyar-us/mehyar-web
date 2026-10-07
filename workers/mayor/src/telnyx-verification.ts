import {z} from 'zod';
import type {Env} from './env';
import {digest,readJson} from './http';
import {requirePhoneCall} from './phone-call-access';
import {telnyxWebhookConnection,telnyxCallCredential} from './telnyx-connections';

const deny=()=>new Error('phone_verification_unavailable');
async function context(env:Env,id:string,transport:typeof fetch){
 const call=await requirePhoneCall(env,id);if(call.provider!=='telnyx'||!call.number)throw deny();
 const {row}=await telnyxWebhookConnection(env,call.tenantId);
 if(row.revision!==call.connectionRevision)throw deny();
 const credential=await telnyxCallCredential(env,call.tenantId,call.connectionRevision,'verify.write',transport);
 const profile=credential.inbound?.verifyProfileId;if(!profile)throw deny();
 return {call,credential,profile};
}
async function post(key:string,path:string,body:unknown,transport:typeof fetch){
 const response=await transport('https://api.telnyx.com/v2/verifications/'+path,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{authorization:'Bearer '+key,'content-type':'application/json',accept:'application/json'},body:JSON.stringify(body)});
 if(!response.ok||!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')){await response.body?.cancel();throw deny();}
 return readJson(new Request('https://internal.invalid',{method:'POST',headers:{'content-type':'application/json'},body:response.body}),16384);
}
async function fail(env:Env,id:string,nonce:string){
 await env.AGENT_DB.prepare("UPDATE mayor_phone_verifications SET state='failed' WHERE call_id=? AND provider='telnyx' AND nonce=? AND state IN ('sending','checking')").bind(id,nonce).run();
}
/** Internal consent/DTMF controller only. Never expose this function as an AI
 * tool, infer consent from caller ID, store codes, or automatically retry sends. */
export async function startTelnyxVerification(env:Env,id:string,consent:boolean,transport:typeof fetch=fetch){
 if(consent!==true)throw deny();
 const {call,credential,profile}=await context(env,id,transport),nonce=crypto.randomUUID(),now=new Date().toISOString();
 const expires=new Date(Date.now()+300000).toISOString();
 const claimed=await env.AGENT_DB.prepare(`INSERT OR IGNORE INTO mayor_phone_verifications
 (call_id,tenant_id,connection_revision,state,nonce,expires_at,created_at,provider)
 VALUES(?,?,?,'sending',?,?,?,'telnyx') RETURNING call_id`).bind(id,call.tenantId,call.connectionRevision,nonce,expires,now).first();
 if(!claimed)throw deny();
 try{
  const subject='phone-verify:'+await digest(`${call.tenantId}:${call.number}`),bucket=Math.floor(Date.now()/3600000);
  const quota=await env.AGENT_DB.prepare('INSERT INTO mayor_rate_limits(subject,bucket,count) VALUES(?,?,1) ON CONFLICT(subject,bucket) DO UPDATE SET count=count+1 RETURNING count').bind(subject,bucket).first<{count:number}>();
  if(!quota||quota.count>3)throw deny();
  await context(env,id,transport);
  const receipt=z.object({data:z.object({id:z.uuid(),phone_number:z.literal(call.number!),verify_profile_id:z.literal(profile),type:z.literal('sms'),status:z.literal('pending'),timeout_secs:z.number().int().positive().max(300)})}).parse(await post(credential.apiKey,'sms',{phone_number:call.number,verify_profile_id:profile,timeout_secs:300},transport)).data;
  await context(env,id,transport);
  const saved=await env.AGENT_DB.prepare(`UPDATE mayor_phone_verifications SET state='pending',verification_sid=?,expires_at=MIN(expires_at,?)
 WHERE call_id=? AND provider='telnyx' AND state='sending' AND nonce=? AND expires_at>?
 AND EXISTS(SELECT 1 FROM mayor_phone_calls c JOIN mayor_phone_connections p ON p.tenant_id=c.tenant_id AND p.provider=c.provider AND p.revision=c.connection_revision AND p.status='authorized' WHERE c.id=? AND c.state='streaming' AND c.expires_at>?) RETURNING call_id`)
  .bind(receipt.id,new Date(Date.parse(now)+receipt.timeout_secs*1000).toISOString(),id,nonce,new Date().toISOString(),id,new Date().toISOString()).first();
  if(!saved)throw deny();return {state:'pending' as const,nonce};
 }catch{await fail(env,id,nonce);throw deny();}
}
/** Exact verification ID, not a phone-wide check. Nonce rotates per attempt;
 * concurrent/replayed input cannot spend another attempt or approve another call. */
export async function checkTelnyxVerification(env:Env,id:string,nonce:string,code:string,transport:typeof fetch=fetch){
 if(!z.uuid().safeParse(nonce).success||!/^\d{4,10}$/.test(code))throw deny();
 const {call,credential}=await context(env,id,transport),nextNonce=crypto.randomUUID(),now=new Date().toISOString();
 const pending=await env.AGENT_DB.prepare(`UPDATE mayor_phone_verifications SET state='checking',nonce=?,attempts=attempts+1
 WHERE call_id=? AND tenant_id=? AND connection_revision=? AND provider='telnyx' AND state='pending' AND nonce=? AND expires_at>? AND attempts<5 RETURNING verification_sid,attempts`)
 .bind(nextNonce,id,call.tenantId,call.connectionRevision,nonce,now).first<{verification_sid:string;attempts:number}>();
 if(!pending)throw deny();
 try{
  if(!z.uuid().safeParse(pending.verification_sid).success)throw deny();
  const receipt=z.object({data:z.object({phone_number:z.literal(call.number!),response_code:z.enum(['accepted','rejected'])})}).parse(await post(credential.apiKey,pending.verification_sid+'/actions/verify',{code},transport)).data;
  await context(env,id,transport);
  const state=receipt.response_code==='accepted'?'approved':pending.attempts<5?'pending':'failed';
  const saved=await env.AGENT_DB.prepare(`UPDATE mayor_phone_verifications SET state=? WHERE call_id=? AND provider='telnyx' AND state='checking' AND nonce=? AND expires_at>?
 AND EXISTS(SELECT 1 FROM mayor_phone_calls c JOIN mayor_phone_connections p ON p.tenant_id=c.tenant_id AND p.provider=c.provider AND p.revision=c.connection_revision AND p.status='authorized' WHERE c.id=? AND c.state='streaming' AND c.expires_at>?) RETURNING call_id`)
  .bind(state,id,nextNonce,new Date().toISOString(),id,new Date().toISOString()).first();
  if(!saved)throw deny();return {state,nonce:nextNonce};
 }catch{await fail(env,id,nextNonce);throw deny();}
}
