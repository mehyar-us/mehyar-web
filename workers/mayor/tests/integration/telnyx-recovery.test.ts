import {env as testEnv} from 'cloudflare:workers';
import {it,expect} from 'vitest';
import type {Env} from '../../src/env';
import {sealPhoneCredential} from '../../src/phone-connections';
import {issueTelnyxStreamGrant,consumeTelnyxStreamGrant} from '../../src/telnyx-stream-grant';
const env={...testEnv,PHONE_TEST_ENABLED:'true'} as unknown as Env;
async function fixture(){
 const actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()},id=crypto.randomUUID(),connection=crypto.randomUUID();
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Stream fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
 const ciphertext=await sealPhoneCredential(env,actor,'telnyx','fixture',{apiKey:'KEY_stream_fixture',inbound:{publicKey:'A'.repeat(43)+'=',applicationId:'123',testCaller:'+12025550101',verifyProfileId:'bf08a03e-5256-4fb3-94fa-465b0349b29e'}});
 await env.AGENT_DB.prepare("INSERT INTO mayor_phone_connections(id,tenant_id,provider,account_id,owner_user_id,ciphertext,status,revision,selected_number_id,selected_number,verified_at,updated_at) VALUES(?,?,'telnyx','fixture',?,?,'authorized',1,'123','+12025550102','now','now')").bind(connection,actor.tenantId,actor.userId,ciphertext).run();
 await env.AGENT_DB.prepare('INSERT INTO mayor_telnyx_admissions(id,event_id,tenant_id,connection_id,connection_revision,call_control_id,payload_hash,created_at) VALUES(?,?,?,?,1,?,?,?)').bind(id,crypto.randomUUID(),actor.tenantId,connection,'call-'+id,'fixture',new Date().toISOString()).run();
 const state=(value:string)=>env.AGENT_DB.prepare('UPDATE mayor_telnyx_commands SET state=? WHERE id=?').bind(value,id).run();
 return {actor,id,connection,state};
}
async function streamingFixture(){
 const f=await fixture(),session=crypto.randomUUID();
 await env.AGENT_DB.prepare('UPDATE mayor_telnyx_admissions SET call_session_id=?,calling_number=?,called_number=? WHERE id=?').bind(session,'+12025550101','+12025550102',f.id).run();
 const grant=await issueTelnyxStreamGrant(env,f.id);await f.state('accepted');
 await consumeTelnyxStreamGrant(env,f.id,grant.token);
 return {...f,session};
}
async function verificationFixture(){
 const f=await streamingFixture();
 const {activateTelnyxPhoneCall}=await import('../../src/telnyx-phone-call');
 await activateTelnyxPhoneCall(env,f.id);return f;
}
it('recovery leases concurrent runs, terminates an abandoned call once, and confirms provider status',async()=>{
 const {runTelnyxRecovery}=await import('../../src/telnyx-recovery');
 const f=await verificationFixture();
 await env.AGENT_DB.prepare("UPDATE mayor_telnyx_admissions SET created_at=datetime('now','-16 minutes') WHERE id=?").bind(f.id).run();
 let posts=0,reads=0;
 const transport=(async(_url:RequestInfo|URL,init?:RequestInit)=>{
  if(init?.method==='POST'){posts++;return Response.json({data:{result:'ok'}});}reads++;
  return Response.json({data:{call_control_id:'call-'+f.id,call_session_id:f.session,record_type:'call',is_alive:false,end_time:new Date().toISOString()}});
 }) as typeof fetch;
 const results=await Promise.all([runTelnyxRecovery(env,transport),runTelnyxRecovery(env,transport)]);
 expect(posts).toBe(1);expect(reads).toBe(1);expect(results.reduce((n,r)=>n+r.complete,0)).toBe(1);
 expect((await runTelnyxRecovery(env,transport)).checked).toBe(0);
});
it('recovery bounds unknown results and escalates an exhausted interrupted lease',async()=>{
 const {runTelnyxRecovery}=await import('../../src/telnyx-recovery');
 const f=await verificationFixture();
 await env.AGENT_DB.prepare("UPDATE mayor_telnyx_admissions SET created_at=datetime('now','-16 minutes') WHERE id=?").bind(f.id).run();
 let time=Date.now(),posts=0,reads=0;
 const transport=(async(_url:RequestInfo|URL,init?:RequestInit)=>{if(init?.method==='POST'){posts++;throw new Error('timeout');}reads++;return new Response(null,{status:404});}) as typeof fetch;
 for(let i=0;i<6;i++){await runTelnyxRecovery(env,transport,()=>time);time+=1800001;}
 expect(posts).toBe(1);expect(reads).toBe(6);
 expect(await env.AGENT_DB.prepare('SELECT state FROM mayor_telnyx_recovery WHERE admission_id=?').bind(f.id).first()).toEqual({state:'review'});
 expect((await runTelnyxRecovery(env,transport,()=>time)).checked).toBe(0);
 await env.AGENT_DB.prepare("UPDATE mayor_telnyx_recovery SET state='pending',lease_until=? WHERE admission_id=?").bind(time-1,f.id).run();
 expect((await runTelnyxRecovery(env,transport,()=>time)).review).toBe(1);expect(reads).toBe(6);
});
it('notifies only active operators, preserves read state, and resolves on provider confirmation',async()=>{
 const {syncPhoneReviewNotifications}=await import('../../src/phone-review-notifications');
 const {listNotifications,markNotificationRead}=await import('../../src/notifications');
 const {terminateTelnyxCall}=await import('../../src/telnyx-termination');
 const f=await verificationFixture(),manager=crypto.randomUUID(),staff=crypto.randomUUID(),inactive=crypto.randomUUID();
 for(const [user,role,status] of [[manager,'manager','active'],[staff,'staff','active'],[inactive,'owner','inactive']])await env.AGENT_DB.prepare('INSERT INTO agent_memberships(tenant_id,user_id,role,status) VALUES(?,?,?,?)').bind(f.actor.tenantId,user,role,status).run();
 await terminateTelnyxCall(env,f.id,(async()=>{throw new Error('timeout');}) as typeof fetch);
 await Promise.all([syncPhoneReviewNotifications(env),syncPhoneReviewNotifications(env)]);
 const rows=await env.AGENT_DB.prepare("SELECT user_id FROM mayor_notifications WHERE tenant_id=? AND kind='phone_call_review'").bind(f.actor.tenantId).all<{user_id:string}>();
 expect(rows.results.map(r=>r.user_id).sort()).toEqual([manager,f.actor.userId].sort());
 const notices=await listNotifications(env,f.actor);expect(notices.notifications).toHaveLength(1);expect(notices.notifications[0].message).toContain('could not confirm');
 expect(JSON.stringify(notices)).not.toContain('+12025550101');expect(JSON.stringify(notices)).not.toContain('call-'+f.id);
 await markNotificationRead(env,f.actor,notices.notifications[0].id);await syncPhoneReviewNotifications(env);
 expect((await listNotifications(env,f.actor)).notifications[0].read).toBe(true);
 await expect(listNotifications(env,{tenantId:f.actor.tenantId,userId:staff})).rejects.toThrow();
 await env.AGENT_DB.prepare('UPDATE mayor_telnyx_ended_calls SET provider_confirmed=1 WHERE connection_id=?').bind(f.connection).run();await syncPhoneReviewNotifications(env);
 expect((await listNotifications(env,f.actor)).notifications).toEqual([]);
});
it('queues phone-review emails only for opted-in verified recipients and cancels resolved notices',async()=>{
 const {createAuth}=await import('../../src/auth');
 const {syncPhoneReviewNotifications}=await import('../../src/phone-review-notifications');
 const {saveEmailPreference,queueNotificationEmails,deliverNotificationEmails}=await import('../../src/notification-email');
 const {terminateTelnyxCall}=await import('../../src/telnyx-termination');
 const f=await verificationFixture();
 const user=await (await createAuth(env).$context).internalAdapter.createUser({email:`${crypto.randomUUID()}@example.test`,name:'Review fixture',emailVerified:true});
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'manager')").bind(f.actor.tenantId,user.id).run();
 const actor={tenantId:f.actor.tenantId,userId:user.id},sent:unknown[]=[];
 const mailEnv={...env,MAYOR_EMAIL_FROM:'mayor@example.test',MAYOR_EMAIL:{send:async(message:unknown)=>{sent.push(message);return {messageId:'fixture'};}}} as unknown as Env;
 await terminateTelnyxCall(env,f.id,(async()=>{throw new Error('timeout');}) as typeof fetch);await syncPhoneReviewNotifications(env);
 expect(await queueNotificationEmails(mailEnv)).toBe(0);await saveEmailPreference(mailEnv,actor,{enabled:true});
 expect(await queueNotificationEmails(mailEnv)).toBe(1);
 await env.AGENT_DB.prepare('UPDATE mayor_telnyx_ended_calls SET provider_confirmed=1 WHERE connection_id=?').bind(f.connection).run();await syncPhoneReviewNotifications(env);
 await deliverNotificationEmails(mailEnv);expect(sent).toEqual([]);
});
