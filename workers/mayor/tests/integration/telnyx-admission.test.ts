import {env as testEnv} from 'cloudflare:workers';
import {beforeEach,it,expect} from 'vitest';
import type {Env} from '../../src/env';
import {connectTelnyx,selectTelnyxNumber,disconnectTelnyx} from '../../src/telnyx-connections';
import {admitTelnyxInitiated} from '../../src/telnyx-admission';
const env={...testEnv,PHONE_TEST_ENABLED:'true'} as unknown as Env;
let actor:{tenantId:string;userId:string},keys:CryptoKeyPair,input:any,event:any;
const number={id:'12345',phone_number:'+12025550124',status:'active',connection_id:'76543'};
const transport=(async(url:RequestInfo|URL)=>Response.json(String(url).includes('/call_control_applications/')?{data:{id:'76543',active:true,record_type:'call_control_application',webhook_api_version:'2',webhook_event_url:`${env.APP_ORIGIN}/api/phone/telnyx/incoming/${actor.tenantId}`}}:new URL(String(url)).search?{data:[number],meta:{page_number:1,total_pages:1}}:{data:number})) as typeof fetch;
const encoded=(bytes:ArrayBuffer)=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
beforeEach(async()=>{
 actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Telnyx admission fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
 keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']) as CryptoKeyPair;
 input={apiKey:'KEY_admission_test_only',inbound:{publicKey:encoded(await crypto.subtle.exportKey('raw',keys.publicKey)),applicationId:'76543',testCaller:'+12025550123'}};
 await connectTelnyx(env,actor,input,transport);await selectTelnyxNumber(env,actor,number.id,transport);
 event={data:{id:crypto.randomUUID(),event_type:'call.initiated',occurred_at:new Date().toISOString(),payload:{call_control_id:'v3:'+crypto.randomUUID(),call_leg_id:crypto.randomUUID(),call_session_id:crypto.randomUUID(),connection_id:input.inbound.applicationId,direction:'incoming',from:input.inbound.testCaller,to:number.phone_number}}};
});
async function signed(){
 const raw=JSON.stringify(event),timestamp=String(Math.floor(Date.now()/1000));
 const signature=encoded(await crypto.subtle.sign('Ed25519',keys.privateKey,new TextEncoder().encode(`${timestamp}|${raw}`)));
 return new Request('https://mayor.example.test/telnyx',{method:'POST',headers:{'content-type':'application/json','telnyx-timestamp':timestamp,'telnyx-signature-ed25519':signature},body:raw});
}
const count=async()=>(await env.AGENT_DB.prepare('SELECT COUNT(*) AS total FROM mayor_telnyx_admissions WHERE tenant_id=?').bind(actor.tenantId).first<{total:number}>())!.total;
it.each(['moved','inactive_number','changed_number','inactive_application','wrong_callback','provider_error'])('does not queue an answer when live settings report %s',async issue=>{
 const changed=(async(url:RequestInfo|URL)=>{
  if(issue==='provider_error')return new Response('unavailable',{status:503});
  if(String(url).includes('/call_control_applications/'))return Response.json({data:{id:'76543',active:issue!=='inactive_application',record_type:'call_control_application',webhook_api_version:'2',webhook_event_url:issue==='wrong_callback'?'https://other.example/incoming':`${env.APP_ORIGIN}/api/phone/telnyx/incoming/${actor.tenantId}`}});
  return Response.json({data:{...number,connection_id:issue==='moved'?'other':'76543',status:issue==='inactive_number'?'deleted':'active',phone_number:issue==='changed_number'?'+12025550199':number.phone_number}});
 }) as typeof fetch;
 await expect(admitTelnyxInitiated(env,actor.tenantId,await signed(),changed)).rejects.toThrow();
 expect(await count()).toBe(0);
 expect((await env.AGENT_DB.prepare('SELECT c.id FROM mayor_telnyx_commands c JOIN mayor_telnyx_admissions a ON a.id=c.id WHERE a.tenant_id=?').bind(actor.tenantId).all()).results).toHaveLength(0);
});
it('authenticates webhook bytes before contacting the provider',async()=>{
 const original=await signed(),headers=new Headers(original.headers);headers.set('telnyx-signature-ed25519','invalid');let requests=0;
 await expect(admitTelnyxInitiated(env,actor.tenantId,new Request(original,{headers}),(async()=>{requests++;return Response.json({});}) as typeof fetch)).rejects.toThrow();
 expect(requests).toBe(0);expect(await count()).toBe(0);
});
it('rejects a disconnect that occurs during live validation',async()=>{
 let changed=false;
 const racing=(async(url:RequestInfo|URL,init?:RequestInit)=>{if(!changed){changed=true;await disconnectTelnyx(env,actor);}return transport(url,init);}) as typeof fetch;
 await expect(admitTelnyxInitiated(env,actor.tenantId,await signed(),racing)).rejects.toThrow();expect(await count()).toBe(0);
});
it.each(['different_connection','missing_connection','inactive','wrong_id','wrong_type','old_webhook','wrong_callback','missing_callback'])('refuses inbound number selection with %s without changing the existing selection',async issue=>{
 const before=await env.AGENT_DB.prepare('SELECT revision,selected_number_id,selected_number FROM mayor_phone_connections WHERE tenant_id=?').bind(actor.tenantId).first();
 const checked=(async(url:RequestInfo|URL,init?:RequestInit)=>{
  expect(init?.method).toBe('GET');expect(init?.redirect).toBe('manual');
  if(String(url).includes('/call_control_applications/'))return Response.json({data:{id:issue==='wrong_id'?'other':'76543',active:issue!=='inactive',record_type:issue==='wrong_type'?'texml_application':'call_control_application',webhook_api_version:issue==='old_webhook'?'1':'2',webhook_event_url:issue==='wrong_callback'?`${env.APP_ORIGIN}/api/phone/telnyx/incoming/another-business`:issue==='missing_callback'?undefined:`${env.APP_ORIGIN}/api/phone/telnyx/incoming/${actor.tenantId}`}});
  return Response.json({data:{...number,connection_id:issue==='different_connection'?'98765':issue==='missing_connection'?null:'76543'}});
 }) as typeof fetch;
 await expect(selectTelnyxNumber(env,actor,number.id,checked)).rejects.toMatchObject({code:issue.endsWith('_connection')?'number_application_mismatch':'voice_application_not_ready'});
 expect(await env.AGENT_DB.prepare('SELECT revision,selected_number_id,selected_number FROM mayor_phone_connections WHERE tenant_id=?').bind(actor.tenantId).first()).toEqual(before);
});
it('admits only one concurrent delivery and returns the same durable receipt on replay',async()=>{
 const requests=await Promise.all(Array.from({length:8},()=>signed()));
 const results=await Promise.all(requests.map(request=>admitTelnyxInitiated(env,actor.tenantId,request,transport)));
 expect(results.filter(result=>result.newAdmission)).toHaveLength(1);expect(new Set(results.map(result=>result.id)).size).toBe(1);expect(await count()).toBe(1);
 const commands=await env.AGENT_DB.prepare('SELECT c.id,c.kind,c.state FROM mayor_telnyx_commands c JOIN mayor_telnyx_admissions a ON a.id=c.id WHERE a.tenant_id=?').bind(actor.tenantId).all();
 expect(commands.results).toEqual([{id:results[0].id,kind:'answer',state:'queued'}]);
 expect((await admitTelnyxInitiated(env,actor.tenantId,await signed(),transport)).newAdmission).toBe(false);
});
it('rolls back admission if the durable command cannot be recorded',async()=>{
 await env.AGENT_DB.prepare("CREATE TRIGGER fail_telnyx_command BEFORE INSERT ON mayor_telnyx_commands BEGIN SELECT RAISE(ABORT,'injected command storage failure'); END").run();
 try{await expect(admitTelnyxInitiated(env,actor.tenantId,await signed(),transport)).rejects.toThrow();expect(await count()).toBe(0);}
 finally{await env.AGENT_DB.prepare('DROP TRIGGER fail_telnyx_command').run();}
 const retry=await admitTelnyxInitiated(env,actor.tenantId,await signed(),transport);expect(retry.newAdmission).toBe(true);
 expect(await env.AGENT_DB.prepare('SELECT state FROM mayor_telnyx_commands WHERE id=?').bind(retry.id).first()).toEqual({state:'queued'});
});
it('does not reset an uncertain command when a webhook is delivered again',async()=>{
 const admitted=await admitTelnyxInitiated(env,actor.tenantId,await signed(),transport);
 await env.AGENT_DB.prepare("UPDATE mayor_telnyx_commands SET state='uncertain' WHERE id=?").bind(admitted.id).run();
 expect((await admitTelnyxInitiated(env,actor.tenantId,await signed(),transport)).newAdmission).toBe(false);
 expect(await env.AGENT_DB.prepare('SELECT state FROM mayor_telnyx_commands WHERE id=?').bind(admitted.id).first()).toEqual({state:'uncertain'});
});
it.each(['connection_id','from','to'])('rejects a correctly signed call with an undesignated %s',async field=>{
 event.data.payload[field]=field==='connection_id'?'999':'+12025550199';
 await expect(admitTelnyxInitiated(env,actor.tenantId,await signed(),transport)).rejects.toMatchObject({code:'call_not_designated'});expect(await count()).toBe(0);
});
it('does not accept altered payloads or alternate event IDs for an already admitted call',async()=>{
 await admitTelnyxInitiated(env,actor.tenantId,await signed(),transport);
 event.data.payload.call_leg_id=crypto.randomUUID();
 await expect(admitTelnyxInitiated(env,actor.tenantId,await signed(),transport)).rejects.toMatchObject({code:'call_admission_conflict'});
 event.data.id=crypto.randomUUID();
 await expect(admitTelnyxInitiated(env,actor.tenantId,await signed(),transport)).rejects.toMatchObject({code:'call_admission_conflict'});expect(await count()).toBe(1);
});
it('does not admit an old call again after reconnecting the account',async()=>{
 await admitTelnyxInitiated(env,actor.tenantId,await signed(),transport);
 await connectTelnyx(env,actor,input,transport);await selectTelnyxNumber(env,actor,number.id,transport);
 await expect(admitTelnyxInitiated(env,actor.tenantId,await signed(),transport)).rejects.toMatchObject({code:'call_admission_conflict'});expect(await count()).toBe(1);
});
it('refuses disabled tests and disconnected or foreign workspaces',async()=>{
 await expect(admitTelnyxInitiated({...env,PHONE_TEST_ENABLED:'false'},actor.tenantId,await signed(),transport)).rejects.toMatchObject({code:'phone_tests_disabled'});
 await expect(admitTelnyxInitiated(env,crypto.randomUUID(),await signed(),transport)).rejects.toMatchObject({code:'phone_unavailable'});
 await disconnectTelnyx(env,actor);
 await expect(admitTelnyxInitiated(env,actor.tenantId,await signed(),transport)).rejects.toMatchObject({code:'phone_unavailable'});expect(await count()).toBe(0);
});
it('does not create a receipt if ownership is revoked at the final insert',async()=>{
 let fired=false;
 const guarded={...env,AGENT_DB:{prepare:(sql:string)=>{
  const statement=env.AGENT_DB.prepare(sql);if(!sql.startsWith('INSERT OR IGNORE INTO mayor_telnyx_admissions'))return statement;
  return {bind:(...args:unknown[])=>({run:async()=>{fired=true;await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=?").bind(actor.tenantId).run();return statement.bind(...args).run();}})};
 }}} as unknown as Env;
 await expect(admitTelnyxInitiated(guarded,actor.tenantId,await signed(),transport)).rejects.toMatchObject({code:'workspace_not_found'});expect(fired).toBe(true);expect(await count()).toBe(0);
});

it('retains an authenticated hangup before initiation and rejects the late initiation',async()=>{
 const {recordTelnyxHangup}=await import('../../src/telnyx-hangup');
 const original=structuredClone(event);
 event.data.event_type='call.hangup';delete event.data.payload.direction;
 await recordTelnyxHangup(env,actor.tenantId,await signed());
 await recordTelnyxHangup(env,actor.tenantId,await signed());
 event=original;
 await expect(admitTelnyxInitiated(env,actor.tenantId,await signed(),transport)).rejects.toThrow();
 expect(await count()).toBe(0);
});
it('hangup blocks queued answers and invalidates their unused stream access',async()=>{
 const {recordTelnyxHangup}=await import('../../src/telnyx-hangup');
 const {issueTelnyxStreamGrant,consumeTelnyxStreamGrant}=await import('../../src/telnyx-stream-grant');
 const admitted=await admitTelnyxInitiated(env,actor.tenantId,await signed(),transport);
 const grant=await issueTelnyxStreamGrant(env,admitted.id);
 event.data.event_type='call.hangup';event.data.id=crypto.randomUUID();delete event.data.payload.direction;
 await recordTelnyxHangup(env,actor.tenantId,await signed());
 expect(await env.AGENT_DB.prepare('SELECT state FROM mayor_telnyx_commands WHERE id=?').bind(admitted.id).first()).toEqual({state:'blocked'});
 await expect(consumeTelnyxStreamGrant(env,admitted.id,grant.token)).rejects.toThrow();
 await env.AGENT_DB.prepare("UPDATE mayor_telnyx_commands SET state='dispatching' WHERE id=?").bind(admitted.id).run();
 expect(await env.AGENT_DB.prepare('SELECT state FROM mayor_telnyx_commands WHERE id=?').bind(admitted.id).first()).toEqual({state:'blocked'});
});
it('does not accept a forged or undesignated hangup',async()=>{
 const {recordTelnyxHangup}=await import('../../src/telnyx-hangup');
 event.data.event_type='call.hangup';delete event.data.payload.direction;
 const request=await signed();request.headers.set('telnyx-signature-ed25519','invalid');
 await expect(recordTelnyxHangup(env,actor.tenantId,request)).rejects.toThrow();
 event.data.payload.to='+12025550199';
 await expect(recordTelnyxHangup(env,actor.tenantId,await signed())).rejects.toThrow();
 expect((await env.AGENT_DB.prepare('SELECT * FROM mayor_telnyx_ended_calls WHERE connection_id IN (SELECT id FROM mayor_phone_connections WHERE tenant_id=?)').bind(actor.tenantId).all()).results).toHaveLength(0);
});
it('upgrades a local stop to provider-confirmed termination on a signed hangup',async()=>{
 const {terminateTelnyxCall}=await import('../../src/telnyx-termination');
 const {recordTelnyxHangup}=await import('../../src/telnyx-hangup');
 const admitted=await admitTelnyxInitiated(env,actor.tenantId,await signed(),transport);
 expect(await terminateTelnyxCall(env,admitted.id,(async()=>Response.json({data:{result:'ok'}})) as typeof fetch)).toEqual({state:'accepted'});
 event.data.event_type='call.hangup';event.data.id=crypto.randomUUID();delete event.data.payload.direction;
 await recordTelnyxHangup(env,actor.tenantId,await signed());
 expect(await env.AGENT_DB.prepare('SELECT state FROM mayor_telnyx_terminations WHERE admission_id=?').bind(admitted.id).first()).toEqual({state:'ended'});
});
it('routes a signed initiation through durable answer dispatch and a hangup through local revocation',async()=>{
 const {receiveTelnyxCall}=await import('../../src/telnyx-calls');
 const jobs:Promise<unknown>[]=[],lifetime={waitUntil:(job:Promise<unknown>)=>{jobs.push(job);}};let answers=0;
 const provider=(async(url:RequestInfo|URL,init?:RequestInit)=>{
  if(String(url).endsWith('/actions/answer')){answers++;return Response.json({data:{result:'ok'}});}return transport(url,init);
 }) as typeof fetch;
 expect((await receiveTelnyxCall(await signed(),env,actor.tenantId,lifetime,provider)).status).toBe(204);await Promise.all(jobs);
 expect(answers).toBe(1);expect(await count()).toBe(1);
 await receiveTelnyxCall(await signed(),env,actor.tenantId,lifetime,provider);await Promise.all(jobs);expect(answers).toBe(1);
 event.data.event_type='call.hangup';event.data.id=crypto.randomUUID();delete event.data.payload.direction;
 expect((await receiveTelnyxCall(await signed(),env,actor.tenantId,lifetime,provider)).status).toBe(204);
 expect((await env.AGENT_DB.prepare('SELECT provider_confirmed FROM mayor_telnyx_ended_calls WHERE connection_id IN (SELECT id FROM mayor_phone_connections WHERE tenant_id=?)').bind(actor.tenantId).first())).toEqual({provider_confirmed:1});
});
it('acknowledges unrelated authenticated events without dispatching commands',async()=>{
 const {receiveTelnyxCall}=await import('../../src/telnyx-calls');let jobs=0;
 event.data.event_type='call.answered';
 expect((await receiveTelnyxCall(await signed(),env,actor.tenantId,{waitUntil:()=>{jobs++;}},transport)).status).toBe(204);
 expect(jobs).toBe(0);expect(await count()).toBe(0);
});
