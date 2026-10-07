import {env as testEnv} from 'cloudflare:workers';
import {it,expect} from 'vitest';
import type {Env} from '../../src/env';
import {sealPhoneCredential} from '../../src/phone-connections';
import {issueTelnyxStreamGrant,consumeTelnyxStreamGrant} from '../../src/telnyx-stream-grant';
import {answerTelnyxAdmission} from '../../src/telnyx-answer';
const env={...testEnv,PHONE_TEST_ENABLED:'true',TELNYX_OAUTH_ENABLED:'true',TELNYX_CLIENT_ID:'fixture',TELNYX_CLIENT_SECRET:'secret',TELNYX_OAUTH_SCOPES:'numbers.read voice.read'} as unknown as Env;
async function fixture(oauth=false){
 const actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()},id=crypto.randomUUID(),connection=crypto.randomUUID();
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Stream fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
 const inbound={publicKey:'A'.repeat(43)+'=',applicationId:'123',testCaller:'+12025550101',verifyProfileId:'bf08a03e-5256-4fb3-94fa-465b0349b29e'};
 const ciphertext=await sealPhoneCredential(env,actor,'telnyx','fixture',oauth?{kind:'oauth',clientId:'fixture',inbound,tokens:{accessToken:'oauth-call-access',refreshToken:'refresh',expiresAt:Date.now()+3600000,scopes:['numbers.read','voice.read','voice.write']}}:{apiKey:'KEY_stream_fixture',inbound});
 await env.AGENT_DB.prepare("INSERT INTO mayor_phone_connections(id,tenant_id,provider,account_id,owner_user_id,ciphertext,status,revision,selected_number_id,selected_number,verified_at,updated_at) VALUES(?,?,'telnyx','fixture',?,?,'authorized',1,'123','+12025550102','now','now')").bind(connection,actor.tenantId,actor.userId,ciphertext).run();
 await env.AGENT_DB.prepare('INSERT INTO mayor_telnyx_admissions(id,event_id,tenant_id,connection_id,connection_revision,call_control_id,payload_hash,created_at) VALUES(?,?,?,?,1,?,?,?)').bind(id,crypto.randomUUID(),actor.tenantId,connection,'call-'+id,'fixture',new Date().toISOString()).run();
 const state=(value:string)=>env.AGENT_DB.prepare('UPDATE mayor_telnyx_commands SET state=? WHERE id=?').bind(value,id).run();
 return {actor,id,connection,state};
}
it('issues only one token, stores only its hash and admits one concurrent socket',async()=>{
 const f=await fixture();
 const issued=await Promise.allSettled(Array.from({length:5},()=>issueTelnyxStreamGrant(env,f.id)));
 expect(issued.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const grant=(issued.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<{token:string}>).value;
 const stored=await env.AGENT_DB.prepare('SELECT * FROM mayor_telnyx_stream_grants WHERE admission_id=?').bind(f.id).first();
 expect(JSON.stringify(stored)).not.toContain(grant.token);
 await f.state('dispatching');
 const consumed=await Promise.allSettled(Array.from({length:5},()=>consumeTelnyxStreamGrant(env,f.id,grant.token)));
 expect(consumed.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect((consumed.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<any>).value).toMatchObject({tenantId:f.actor.tenantId,callControlId:'call-'+f.id,connectionRevision:1});
 await expect(issueTelnyxStreamGrant(env,f.id)).rejects.toThrow();
});
it.each(['queued','uncertain','blocked'])('rejects a socket when command is %s',async state=>{
 const f=await fixture(),grant=await issueTelnyxStreamGrant(env,f.id);await f.state(state);
 await expect(consumeTelnyxStreamGrant(env,f.id,grant.token)).rejects.toThrow();
 expect(await env.AGENT_DB.prepare('SELECT consumed_at FROM mayor_telnyx_stream_grants WHERE admission_id=?').bind(f.id).first()).toEqual({consumed_at:null});
});
it.each(['expired','revoked','viewer','inactive','connection','disabled'])('rejects %s access at consumption',async change=>{
 const f=await fixture(),grant=await issueTelnyxStreamGrant(env,f.id);await f.state('accepted');
 if(change==='expired')await env.AGENT_DB.prepare('UPDATE mayor_telnyx_stream_grants SET expires_at=0 WHERE admission_id=?').bind(f.id).run();
 if(change==='revoked')await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=?").bind(f.actor.tenantId).run();
 if(change==='viewer')await env.AGENT_DB.prepare("UPDATE agent_memberships SET role='viewer' WHERE tenant_id=?").bind(f.actor.tenantId).run();
 if(change==='inactive')await env.AGENT_DB.prepare("UPDATE agent_tenants SET status='inactive' WHERE id=?").bind(f.actor.tenantId).run();
 if(change==='connection')await env.AGENT_DB.prepare('UPDATE mayor_phone_connections SET revision=revision+1 WHERE id=?').bind(f.connection).run();
 await expect(consumeTelnyxStreamGrant(change==='disabled'?{...env,PHONE_TEST_ENABLED:'false'}:env,f.id,grant.token)).rejects.toThrow();
});
it('cannot use another call token or a guessed token and preserves the valid attempt',async()=>{
 const a=await fixture(),b=await fixture(),grant=await issueTelnyxStreamGrant(env,a.id);await a.state('accepted');await b.state('accepted');
 await expect(consumeTelnyxStreamGrant(env,b.id,grant.token)).rejects.toThrow();
 await expect(consumeTelnyxStreamGrant(env,a.id,'0'.repeat(64))).rejects.toThrow();
 await expect(consumeTelnyxStreamGrant(env,a.id,grant.token)).resolves.toHaveProperty('admissionId',a.id);
});
it('cannot issue after dispatch or resurrect an expired token',async()=>{
 const a=await fixture();await a.state('dispatching');await expect(issueTelnyxStreamGrant(env,a.id)).rejects.toThrow();
 const b=await fixture();await issueTelnyxStreamGrant(env,b.id);
 await env.AGENT_DB.prepare('UPDATE mayor_telnyx_stream_grants SET expires_at=0 WHERE admission_id=?').bind(b.id).run();
 await expect(issueTelnyxStreamGrant(env,b.id)).rejects.toThrow();
});

function provider(tenantId:string,onAnswer:(url:string,init:RequestInit)=>Promise<Response>){
 return (async(url:RequestInfo|URL,init?:RequestInit)=>{
  if(init?.method==='POST')return onAnswer(String(url),init);
  if(String(url).includes('/call_control_applications/'))return Response.json({data:{id:'123',active:true,record_type:'call_control_application',webhook_api_version:'2',webhook_event_url:`${env.APP_ORIGIN}/api/phone/telnyx/incoming/${tenantId}`}});
  return Response.json({data:{id:'123',phone_number:'+12025550102',status:'active',connection_id:'123'}});
 }) as typeof fetch;
}
it.each([false,true])('dispatches one answer under concurrent delivery and binds its stream grant (OAuth %s)',async oauth=>{
 const f=await fixture(oauth);let posts=0;
 const transport=provider(f.actor.tenantId,async(url,init)=>{
  posts++;expect(new Headers(init.headers).get('authorization')).toBe(oauth?'Bearer oauth-call-access':'Bearer KEY_stream_fixture');expect(url).toBe(`https://api.telnyx.com/v2/calls/call-${f.id}/actions/answer`);expect(init.redirect).toBe('manual');
  const body=JSON.parse(init.body as string);expect(body).toMatchObject({command_id:f.id,stream_codec:'L16',stream_track:'inbound_track',stream_bidirectional_codec:'L16',stream_bidirectional_sampling_rate:16000});
  const stream=new URL(body.stream_url);expect(stream.origin).toBe('wss://mayor.example.test');
  const token=stream.pathname.split('/').at(-1)!;
  // The stream may connect while the answer HTTP request is still in flight.
  await expect(consumeTelnyxStreamGrant(env,f.id,token)).resolves.toHaveProperty('admissionId',f.id);
  return Response.json({data:{result:'ok'}});
 });
 const outcomes=await Promise.allSettled(Array.from({length:5},()=>answerTelnyxAdmission(env,f.id,transport)));
 expect(posts).toBe(1);expect(outcomes.some(r=>r.status==='fulfilled'&&r.value.state==='accepted')).toBe(true);
 await expect(answerTelnyxAdmission(env,f.id,transport)).resolves.toEqual({state:'accepted'});expect(posts).toBe(1);
});
it.each(['timeout','rejected','redirect','malformed'])('does not repeat an answer after %s',async outcome=>{
 const f=await fixture();let posts=0;
 const transport=provider(f.actor.tenantId,async()=>{
  posts++;if(outcome==='timeout')throw new Error('private provider error');
  if(outcome==='rejected')return new Response('private provider error',{status:429});
  if(outcome==='redirect')return new Response(null,{status:302,headers:{location:'https://evil.test'}});
  return Response.json({data:{result:'unexpected'}});
 });
 expect(await answerTelnyxAdmission(env,f.id,transport)).toEqual({state:'uncertain'});
 expect(await answerTelnyxAdmission(env,f.id,transport)).toEqual({state:'uncertain'});expect(posts).toBe(1);
});
it('does not answer when connection authority disappears during provider preflight',async()=>{
 const f=await fixture();
 const transport=(async()=>{
  await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=?").bind(f.actor.tenantId).run();
  return Response.json({data:{}});
 }) as typeof fetch;
 await expect(answerTelnyxAdmission(env,f.id,transport)).rejects.toThrow();
 expect(await env.AGENT_DB.prepare('SELECT state FROM mayor_telnyx_commands WHERE id=?').bind(f.id).first()).toEqual({state:'queued'});
 expect(await env.AGENT_DB.prepare('SELECT admission_id FROM mayor_telnyx_stream_grants WHERE admission_id=?').bind(f.id).first()).toBeNull();
});
it('does not repeat a provider request if saving its result fails',async()=>{
 const f=await fixture();let posts=0;
 const transport=provider(f.actor.tenantId,async()=>{posts++;return Response.json({data:{result:'ok'}});});
 await env.AGENT_DB.prepare("CREATE TRIGGER fail_telnyx_answer_result BEFORE UPDATE ON mayor_telnyx_commands WHEN NEW.state='accepted' BEGIN SELECT RAISE(ABORT,'injected persistence failure'); END").run();
 try{await expect(answerTelnyxAdmission(env,f.id,transport)).rejects.toThrow();}
 finally{await env.AGENT_DB.prepare('DROP TRIGGER fail_telnyx_answer_result').run();}
 expect(await answerTelnyxAdmission(env,f.id,transport)).toEqual({state:'dispatching'});expect(posts).toBe(1);
});
it.each(['2000-01-01T00:00:00.000Z','2999-01-01T00:00:00.000Z','invalid'])('blocks stale or invalid admission time %s without provider access',async timestamp=>{
 const f=await fixture();await env.AGENT_DB.prepare('UPDATE mayor_telnyx_admissions SET created_at=? WHERE id=?').bind(timestamp,f.id).run();
 await expect(issueTelnyxStreamGrant(env,f.id)).rejects.toThrow();
 let requests=0;const transport=(async()=>{requests++;throw new Error('Must not request');}) as typeof fetch;
 expect(await answerTelnyxAdmission(env,f.id,transport)).toEqual({state:'blocked'});expect(requests).toBe(0);
});
it('does not answer if its admission expires during live provider validation',async()=>{
 const f=await fixture();let posts=0;
 const base=provider(f.actor.tenantId,async()=>{posts++;return Response.json({data:{result:'ok'}});});
 const transport=(async(url:RequestInfo|URL,init?:RequestInit)=>{
  await env.AGENT_DB.prepare("UPDATE mayor_telnyx_admissions SET created_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(f.id).run();
  return base(url,init);
 }) as typeof fetch;
 await expect(answerTelnyxAdmission(env,f.id,transport)).rejects.toThrow();expect(posts).toBe(0);
 expect(await env.AGENT_DB.prepare('SELECT admission_id FROM mayor_telnyx_stream_grants WHERE admission_id=?').bind(f.id).first()).toBeNull();
});

async function streamingFixture(){
 const f=await fixture(),session=crypto.randomUUID();
 await env.AGENT_DB.prepare('UPDATE mayor_telnyx_admissions SET call_session_id=?,calling_number=?,called_number=? WHERE id=?').bind(session,'+12025550101','+12025550102',f.id).run();
 const grant=await issueTelnyxStreamGrant(env,f.id);await f.state('accepted');
 await consumeTelnyxStreamGrant(env,f.id,grant.token);
 return {...f,session};
}
it.each(['hangup','disconnect','role','tenant','revision','uncertain','expired','missing_binding'])('ends stream authority after %s',async issue=>{
 const {requireTelnyxStreamAccess}=await import('../../src/telnyx-stream-access');
 const f=await streamingFixture();
 expect(await requireTelnyxStreamAccess(env,f.id)).toEqual({callControlId:'call-'+f.id,callSessionId:f.session,from:'+12025550101',to:'+12025550102'});
 if(issue==='hangup')await env.AGENT_DB.prepare('INSERT INTO mayor_telnyx_ended_calls(connection_id,call_control_id,event_id,ended_at) VALUES(?,?,?,?)').bind(f.connection,'call-'+f.id,crypto.randomUUID(),new Date().toISOString()).run();
 if(issue==='disconnect')await env.AGENT_DB.prepare("UPDATE mayor_phone_connections SET status='revoked' WHERE id=?").bind(f.connection).run();
 if(issue==='role')await env.AGENT_DB.prepare("UPDATE agent_memberships SET role='viewer' WHERE tenant_id=?").bind(f.actor.tenantId).run();
 if(issue==='tenant')await env.AGENT_DB.prepare("UPDATE agent_tenants SET status='inactive' WHERE id=?").bind(f.actor.tenantId).run();
 if(issue==='revision')await env.AGENT_DB.prepare('UPDATE mayor_phone_connections SET revision=revision+1 WHERE id=?').bind(f.connection).run();
 if(issue==='uncertain')await f.state('uncertain');
 if(issue==='expired')await env.AGENT_DB.prepare("UPDATE mayor_telnyx_admissions SET created_at=datetime('now','-16 minutes') WHERE id=?").bind(f.id).run();
 if(issue==='missing_binding')await env.AGENT_DB.prepare('UPDATE mayor_telnyx_admissions SET call_session_id=NULL WHERE id=?').bind(f.id).run();
 await expect(requireTelnyxStreamAccess(env,f.id)).rejects.toThrow();
});
it('closes actual idle sockets when a signed call termination has been recorded',async()=>{
 const {attachTelnyxStream}=await import('../../src/telnyx-stream');
 const f=await streamingFixture(),provider=new WebSocketPair(),agent=new WebSocketPair();
 for(const socket of [provider[0],provider[1],agent[0],agent[1]])socket.accept();
 const bridge=await attachTelnyxStream(env,f.id,provider[1],agent[1]);
 const closed=(socket:WebSocket)=>new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Socket remained open after termination')),3000);
  socket.addEventListener('close',()=>{clearTimeout(timer);resolve();},{once:true});
 });
 const both=Promise.all([closed(provider[0]),closed(agent[0])]);
 try{
  await env.AGENT_DB.prepare('INSERT INTO mayor_telnyx_ended_calls(connection_id,call_control_id,event_id,ended_at) VALUES(?,?,?,?)').bind(f.connection,'call-'+f.id,crypto.randomUUID(),new Date().toISOString()).run();
  await both;
 }finally{bridge.close();provider[0].close();agent[0].close();}
});


it('activates a provider-bound phone principal without granting appointment identity',async()=>{
 const {activateTelnyxPhoneCall}=await import('../../src/telnyx-phone-call');
 const {requirePhoneCall}=await import('../../src/phone-call-access');
 const {verifiedCallNumber}=await import('../../src/phone-verification');
 const {requestCallback}=await import('../../src/callbacks');
 const f=await streamingFixture();
 expect(await activateTelnyxPhoneCall(env,f.id)).toMatchObject({provider:'telnyx',tenantId:f.actor.tenantId,number:'+12025550101'});
 expect(await verifiedCallNumber(env,f.id)).toBeNull();
 expect(await requestCallback(env,f.id,'human_assistance')).toMatchObject({status:'pending'});
 // A legacy/default Twilio verification receipt must not authorize Telnyx.
 const now=new Date().toISOString();
 await env.AGENT_DB.prepare("INSERT INTO mayor_phone_verifications(call_id,tenant_id,connection_revision,state,nonce,expires_at,created_at) VALUES(?,?,1,'approved',?,?,?)").bind(f.id,f.actor.tenantId,crypto.randomUUID(),new Date(Date.now()+60000).toISOString(),now).run();
 expect(await verifiedCallNumber(env,f.id)).toBeNull();
 await env.AGENT_DB.prepare('INSERT INTO mayor_telnyx_ended_calls(connection_id,call_control_id,event_id,ended_at) VALUES(?,?,?,?)').bind(f.connection,'call-'+f.id,crypto.randomUUID(),now).run();
 await expect(requirePhoneCall(env,f.id)).rejects.toThrow();
 await expect(activateTelnyxPhoneCall(env,f.id)).rejects.toThrow();
 await expect(requestCallback(env,f.id,'human_assistance')).rejects.toThrow();
 expect(await env.AGENT_DB.prepare('SELECT state FROM mayor_phone_calls WHERE id=?').bind(f.id).first()).toEqual({state:'ended'});
});

async function verificationFixture(){
 const f=await streamingFixture();
 const {activateTelnyxPhoneCall}=await import('../../src/telnyx-phone-call');
 await activateTelnyxPhoneCall(env,f.id);return f;
}
const verifyId='6a2f4681-e23a-4944-b37f-ece360dcf182';
const pendingReceipt=()=>({data:{id:verifyId,phone_number:'+12025550101',verify_profile_id:'bf08a03e-5256-4fb3-94fa-465b0349b29e',type:'sms',status:'pending',timeout_secs:300}});
it('sends only after consent, deduplicates concurrent sends/checks, and never stores OTP digits',async()=>{
 const {startTelnyxVerification,checkTelnyxVerification}=await import('../../src/telnyx-verification');
 const {verifiedCallNumber}=await import('../../src/phone-verification');
 const f=await verificationFixture();let sends=0,checks=0;
 const transport=(async(url:RequestInfo|URL,init?:RequestInit)=>{
  expect(init?.redirect).toBe('manual');expect(init?.method).toBe('POST');
  if(String(url).endsWith('/sms')){sends++;expect(JSON.parse(String(init?.body))).toEqual({phone_number:'+12025550101',verify_profile_id:pendingReceipt().data.verify_profile_id,timeout_secs:300});return Response.json(pendingReceipt());}
  expect(String(url)).toBe('https://api.telnyx.com/v2/verifications/'+verifyId+'/actions/verify');
  expect(JSON.parse(String(init?.body))).toEqual({code:'654321'});checks++;
  return Response.json({data:{phone_number:'+12025550101',response_code:'accepted'}});
 }) as typeof fetch;
 await expect(startTelnyxVerification(env,f.id,false,transport)).rejects.toThrow();expect(sends).toBe(0);
 const results=await Promise.allSettled([startTelnyxVerification(env,f.id,true,transport),startTelnyxVerification(env,f.id,true,transport)]);
 expect(sends).toBe(1);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const success=results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<{nonce:string}>;
 const checked=await Promise.allSettled([checkTelnyxVerification(env,f.id,success.value.nonce,'654321',transport),checkTelnyxVerification(env,f.id,success.value.nonce,'654321',transport)]);
 expect(checks).toBe(1);expect(checked.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect(await verifiedCallNumber(env,f.id)).toMatchObject({tenantId:f.actor.tenantId,number:'+12025550101'});
 const rows=await env.AGENT_DB.prepare('SELECT * FROM mayor_phone_verifications WHERE call_id=?').bind(f.id).all();
 expect(JSON.stringify(rows)).not.toContain('654321');
 const audit=await env.AGENT_DB.prepare('SELECT * FROM mayor_audit WHERE tenant_id=?').bind(f.actor.tenantId).all();expect(JSON.stringify(audit)).not.toContain('654321');
});
it.each(['timeout','wrong_number','wrong_profile','wrong_channel','redirect'])('fails a %s send without retrying',async issue=>{
 const {startTelnyxVerification}=await import('../../src/telnyx-verification');
 const f=await verificationFixture();let sends=0;
 const transport=(async()=>{sends++;if(issue==='timeout')throw new Error('timeout');if(issue==='redirect')return new Response(null,{status:302});
  const receipt=pendingReceipt();if(issue==='wrong_number')receipt.data.phone_number='+12025550199';if(issue==='wrong_profile')receipt.data.verify_profile_id=crypto.randomUUID();if(issue==='wrong_channel')receipt.data.type='call';return Response.json(receipt);
 }) as typeof fetch;
 await expect(startTelnyxVerification(env,f.id,true,transport)).rejects.toThrow();
 await expect(startTelnyxVerification(env,f.id,true,transport)).rejects.toThrow();expect(sends).toBe(1);
 expect(await env.AGENT_DB.prepare('SELECT state FROM mayor_phone_verifications WHERE call_id=?').bind(f.id).first()).toEqual({state:'failed'});
});
it('limits rejected checks to five and rotates the attempt nonce',async()=>{
 const {startTelnyxVerification,checkTelnyxVerification}=await import('../../src/telnyx-verification');
 const f=await verificationFixture();let checks=0;
 const transport=(async(url:RequestInfo|URL)=>{if(String(url).endsWith('/sms'))return Response.json(pendingReceipt());checks++;return Response.json({data:{phone_number:'+12025550101',response_code:'rejected'}});}) as typeof fetch;
 let step=await startTelnyxVerification(env,f.id,true,transport);
 for(let i=0;i<5;i++){
  const previous=step.nonce,result=await checkTelnyxVerification(env,f.id,previous,'123456',transport);
  expect(result.state).toBe(i===4?'failed':'pending');expect(result.nonce).not.toBe(previous);
  await expect(checkTelnyxVerification(env,f.id,previous,'123456',transport)).rejects.toThrow();step={state:'pending',nonce:result.nonce};
 }
 await expect(checkTelnyxVerification(env,f.id,step.nonce,'123456',transport)).rejects.toThrow();expect(checks).toBe(5);
});
it('does not approve a verification when the call ends during provider processing',async()=>{
 const {startTelnyxVerification,checkTelnyxVerification}=await import('../../src/telnyx-verification');
 const {verifiedCallNumber}=await import('../../src/phone-verification');
 const f=await verificationFixture();
 const started=await startTelnyxVerification(env,f.id,true,(async()=>Response.json(pendingReceipt())) as typeof fetch);
 await expect(checkTelnyxVerification(env,f.id,started.nonce,'123456',(async()=>{
  await env.AGENT_DB.prepare('INSERT INTO mayor_telnyx_ended_calls(connection_id,call_control_id,event_id,ended_at) VALUES(?,?,?,?)').bind(f.connection,'call-'+f.id,crypto.randomUUID(),new Date().toISOString()).run();
  return Response.json({data:{phone_number:'+12025550101',response_code:'accepted'}});
 }) as typeof fetch)).rejects.toThrow();
 expect(await verifiedCallNumber(env,f.id)).toBeNull();
});
it('enforces the shared per-number send budget before contacting Telnyx',async()=>{
 const {startTelnyxVerification}=await import('../../src/telnyx-verification');
 const {digest}=await import('../../src/http');
 const f=await verificationFixture(),subject='phone-verify:'+await digest(`${f.actor.tenantId}:+12025550101`);
 await env.AGENT_DB.prepare('INSERT INTO mayor_rate_limits(subject,bucket,count) VALUES(?,?,3)').bind(subject,Math.floor(Date.now()/3600000)).run();let sends=0;
 await expect(startTelnyxVerification(env,f.id,true,(async()=>{sends++;return Response.json(pendingReceipt());}) as typeof fetch)).rejects.toThrow();expect(sends).toBe(0);
});
it('rejects expired challenges before submitting any code',async()=>{
 const {startTelnyxVerification,checkTelnyxVerification}=await import('../../src/telnyx-verification');
 const f=await verificationFixture(),step=await startTelnyxVerification(env,f.id,true,(async()=>Response.json(pendingReceipt())) as typeof fetch);
 await env.AGENT_DB.prepare("UPDATE mayor_phone_verifications SET expires_at='2000-01-01T00:00:00.000Z' WHERE call_id=?").bind(f.id).run();let checks=0;
 await expect(checkTelnyxVerification(env,f.id,step.nonce,'123456',(async()=>{checks++;return Response.json({});}) as typeof fetch)).rejects.toThrow();expect(checks).toBe(0);
});
it('passes the verification gate through the runtime socket attachment',async()=>{
 const {attachTelnyxStream}=await import('../../src/telnyx-stream');
 const f=await streamingFixture(),provider=new WebSocketPair(),agent=new WebSocketPair();
 for(const socket of [provider[0],provider[1],agent[0],agent[1]])socket.accept();
 let opened!:()=>void;
 const gateOpened=new Promise<void>(resolve=>{opened=resolve;});
 const gate={start:(_resume:()=>void)=>opened(),digit:(_value:string)=>{},close:()=>{}};
 const bridge=await attachTelnyxStream(env,f.id,provider[1],agent[1],gate);
 try{
  provider[0].send(JSON.stringify({event:'start',stream_id:'s',start:{call_control_id:'call-'+f.id,call_session_id:f.session,from:'+12025550101',to:'+12025550102',media_format:{encoding:'L16',sample_rate:16000,channels:1}}}));
  await gateOpened;
 }finally{bridge.close();provider[0].close();agent[0].close();}
});
it('plays verification prompts and starts the AI only after acknowledged private keypad verification',async()=>{
 const {attachVerifiedTelnyxStream}=await import('../../src/telnyx-prompts');
 const {verifiedCallNumber}=await import('../../src/phone-verification');
 const f=await verificationFixture(),provider=new WebSocketPair(),agent=new WebSocketPair();
 for(const socket of [provider[0],provider[1],agent[0],agent[1]])socket.accept();
 const spoken:string[]=[],agentMessages:unknown[]=[];
 const voiceEnv={...env,AI:{run:async(_model:string,input:{text:string})=>{spoken.push(input.text);return new Response(new Uint8Array(640));}}} as unknown as Env;
 agent[0].addEventListener('message',e=>{agentMessages.push(e.data);});
 const transport=(async(url:RequestInfo|URL)=>Response.json(String(url).endsWith('/sms')?pendingReceipt():{data:{phone_number:'+12025550101',response_code:'accepted'}})) as typeof fetch;
 const bridge=await attachVerifiedTelnyxStream(voiceEnv,f.id,provider[1],agent[1],transport);
 const nextMark=()=>new Promise<string>((resolve,reject)=>{
  const timer=setTimeout(()=>{provider[0].removeEventListener('message',listener);reject(new Error('Missing prompt mark'));},2000);
  const listener=(event:MessageEvent)=>{const data=JSON.parse(String(event.data));if(data.event==='mark'){clearTimeout(timer);provider[0].removeEventListener('message',listener);resolve(data.mark.name);}};
  provider[0].addEventListener('message',listener);
 });
 const ack=async(name:string)=>{provider[0].send(JSON.stringify({event:'mark',stream_id:'s',mark:{name}}));await new Promise(resolve=>setTimeout(resolve,10));};
 const digit=(value:string)=>provider[0].send(JSON.stringify({event:'dtmf',stream_id:'s',dtmf:{digit:value}}));
 try{
  let mark=nextMark();
  provider[0].send(JSON.stringify({event:'start',stream_id:'s',start:{call_control_id:'call-'+f.id,call_session_id:f.session,from:'+12025550101',to:'+12025550102',media_format:{encoding:'L16',sample_rate:16000,channels:1}}}));
  await ack(await mark);expect(agentMessages).toEqual([]);
  mark=nextMark();digit('1');await ack(await mark);expect(agentMessages).toEqual([]);
  mark=nextMark();for(const value of '123456#')digit(value);const finalMark=await mark;
  expect(agentMessages).toEqual([]);await ack(finalMark);
  expect(agentMessages).toEqual(['{"type":"start_call"}']);
  expect(await verifiedCallNumber(env,f.id)).toMatchObject({number:'+12025550101'});
  expect(spoken).toHaveLength(3);expect(spoken.join(' ')).not.toContain('123456');
 }finally{bridge.close();provider[0].close();agent[0].close();}
});
it('deduplicates concurrent hangups and revokes local call access before the provider responds',async()=>{
 const {terminateTelnyxCall}=await import('../../src/telnyx-termination');
 const {requirePhoneCall}=await import('../../src/phone-call-access');
 const f=await verificationFixture();let commands=0;
 const transport=(async(url:RequestInfo|URL,init?:RequestInit)=>{
  commands++;expect(String(url)).toBe('https://api.telnyx.com/v2/calls/call-'+f.id+'/actions/hangup');expect(init?.redirect).toBe('manual');
  expect(JSON.parse(String(init?.body)).command_id).toMatch(/^[a-f0-9-]{36}$/);
  await expect(requirePhoneCall(env,f.id)).rejects.toThrow();
  return Response.json({data:{result:'ok'}});
 }) as typeof fetch;
 await Promise.all([terminateTelnyxCall(env,f.id,transport),terminateTelnyxCall(env,f.id,transport)]);
 expect(commands).toBe(1);expect(await terminateTelnyxCall(env,f.id,transport)).toEqual({state:'accepted'});expect(commands).toBe(1);
 expect(await env.AGENT_DB.prepare('SELECT provider_confirmed FROM mayor_telnyx_ended_calls WHERE connection_id=?').bind(f.connection).first()).toEqual({provider_confirmed:0});
});
it.each(['timeout','redirect','invalid_response','revoked'])('records termination %s without automatic retries',async issue=>{
 const {terminateTelnyxCall}=await import('../../src/telnyx-termination');
 const f=await verificationFixture();let requests=0;
 if(issue==='revoked')await env.AGENT_DB.prepare("UPDATE mayor_phone_connections SET status='revoked' WHERE id=?").bind(f.connection).run();
 const transport=(async()=>{requests++;if(issue==='timeout')throw new Error('timeout');return issue==='redirect'?new Response(null,{status:302}):Response.json({data:{result:'unexpected'}});}) as typeof fetch;
 expect(await terminateTelnyxCall(env,f.id,transport)).toEqual({state:issue==='revoked'?'blocked':'uncertain'});
 await terminateTelnyxCall(env,f.id,transport);expect(requests).toBe(issue==='revoked'?0:1);
 expect(await env.AGENT_DB.prepare('SELECT state FROM mayor_phone_calls WHERE id=?').bind(f.id).first()).toEqual({state:'ended'});
});
it('does not overwrite provider termination confirmation with a late HTTP response',async()=>{
 const {terminateTelnyxCall}=await import('../../src/telnyx-termination');
 const f=await verificationFixture();
 const result=await terminateTelnyxCall(env,f.id,(async()=>{
  await env.AGENT_DB.prepare('UPDATE mayor_telnyx_ended_calls SET provider_confirmed=1 WHERE connection_id=?').bind(f.connection).run();
  return Response.json({data:{result:'ok'}});
 }) as typeof fetch);
 expect(result).toEqual({state:'ended'});
});
it('upgrades one authorized stream with fresh internal identity and hangs up on socket close',async()=>{
 const {connectTelnyxStream}=await import('../../src/telnyx-calls');
 const f=await fixture();
 await env.AGENT_DB.prepare('UPDATE mayor_telnyx_admissions SET call_session_id=?,calling_number=?,called_number=? WHERE id=?').bind(crypto.randomUUID(),'+12025550101','+12025550102',f.id).run();
 const grant=await issueTelnyxStreamGrant(env,f.id);await f.state('accepted');
 const agentPair=new WebSocketPair();agentPair[1].accept();let connected=0,hangups=0;
 const runtime={...env,MAYOR_PHONE:{idFromName:(id:string)=>{expect(id).toBe(f.id);return id;},get:()=>({fetch:async(request:Request)=>{
  connected++;expect(request.headers.get('x-mayor-call')).toBe(f.id);expect(request.headers.get('cookie')).toBeNull();expect(request.headers.get('authorization')).toBeNull();
  return new Response(null,{status:101,webSocket:agentPair[0]});
 }})}} as unknown as Env;
 const jobs:Promise<unknown>[]=[],lifetime={waitUntil:(job:Promise<unknown>)=>{jobs.push(job);}};
 const transport=(async()=>{hangups++;return Response.json({data:{result:'ok'}});}) as typeof fetch;
 const request=new Request('https://mayor.example.test/api/phone/telnyx/stream/'+f.id+'/'+grant.token,{headers:{upgrade:'websocket',cookie:'ignored=secret',authorization:'Bearer ignored','x-mayor-call':'forged'}});
 const response=await connectTelnyxStream(request,runtime,f.id,grant.token,lifetime,transport);
 expect(response.status).toBe(101);response.webSocket!.accept();expect(connected).toBe(1);
 await expect(connectTelnyxStream(request,runtime,f.id,grant.token,lifetime,transport)).rejects.toThrow();
 const closed=new Promise<void>(resolve=>{agentPair[1].addEventListener('close',()=>resolve(),{once:true});});
 response.webSocket!.close();await closed;await Promise.all(jobs);
 expect(hangups).toBe(1);expect(await env.AGENT_DB.prepare('SELECT state FROM mayor_telnyx_terminations WHERE admission_id=?').bind(f.id).first()).toEqual({state:'accepted'});agentPair[1].close();
});
it.each(['ended','alive','not_found','wrong_call','wrong_session','no_end_time'])('reconciliation handles provider status %s without issuing commands',async mode=>{
 const {reconcileTelnyxTermination}=await import('../../src/telnyx-recovery');
 const f=await verificationFixture();let requests=0;
 const transport=(async(url:RequestInfo|URL,init?:RequestInit)=>{
  requests++;expect(init?.method).toBe('GET');expect(init?.redirect).toBe('manual');expect(String(url)).toBe('https://api.telnyx.com/v2/calls/call-'+f.id);
  if(mode==='not_found')return new Response(null,{status:404});
  return Response.json({data:{call_control_id:mode==='wrong_call'?'other':'call-'+f.id,call_session_id:mode==='wrong_session'?crypto.randomUUID():f.session,record_type:'call',is_alive:mode==='alive',...(mode==='no_end_time'?{}:{end_time:new Date().toISOString()})}});
 }) as typeof fetch;
 if(mode.startsWith('wrong_'))await expect(reconcileTelnyxTermination(env,f.id,transport)).rejects.toThrow();
 else expect(await reconcileTelnyxTermination(env,f.id,transport)).toBe(mode==='ended'?'ended':mode==='alive'?'alive':'unknown');
 expect(requests).toBe(1);
 const ended=await env.AGENT_DB.prepare('SELECT provider_confirmed FROM mayor_telnyx_ended_calls WHERE connection_id=?').bind(f.connection).first();expect(ended).toEqual(mode==='ended'?{provider_confirmed:1}:null);
});
