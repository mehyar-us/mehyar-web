import {env as testEnv} from 'cloudflare:workers';
import {beforeEach,it,expect} from 'vitest';
import type {Actor,Env} from '../../src/env';
import {requestCallback,listCallbacks,handleCallback} from '../../src/callbacks';
import {MayorPhone} from '../../src/phone-voice';
import {sealPhoneCredential} from '../../src/phone-connections';
const env={...testEnv,PHONE_TEST_ENABLED:'true'} as unknown as Env;
let actor:Actor,callId:string;
beforeEach(async()=>{
 actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};callId=crypto.randomUUID();
 const now=new Date().toISOString();
 const ciphertext=await sealPhoneCredential(env,actor,'twilio','fixture-account',{accountSid:'AC'+'1'.repeat(32),apiKeySid:'SK'+'2'.repeat(32),apiKeySecret:'fixture_secret_123456',authToken:'3'.repeat(32),testCaller:'+12025550102'});
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Callback fixture',now).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
 await env.AGENT_DB.prepare(`INSERT INTO mayor_phone_connections(id,tenant_id,provider,account_id,owner_user_id,ciphertext,status,selected_number,verified_at,updated_at)
 VALUES(?,?,'twilio','fixture-account',?,?,'authorized','+12025550101',?,?)`).bind(crypto.randomUUID(),actor.tenantId,actor.userId,ciphertext,now,now).run();
 await env.AGENT_DB.prepare(`INSERT INTO mayor_phone_calls(id,tenant_id,account_id,call_sid,connection_revision,state,stream_expires_at,expires_at,created_at,caller_number)
 VALUES(?,?,'fixture-account',?,1,'streaming',?,?,?,'+12025550102')`).bind(callId,actor.tenantId,crypto.randomUUID(),now,new Date(Date.now()+600000).toISOString(),now).run();
});
it('deduplicates concurrent requests, preserves the original reason and audits once',async()=>{
 const results=await Promise.all([requestCallback(env,callId,'scheduling'),requestCallback(env,callId,'scheduling')]);
 expect(results[0].id).toBe(results[1].id);
 await requestCallback(env,callId,'human_assistance');
 const listed=await listCallbacks(env,actor);
 expect(listed).toMatchObject({identityVerified:false,hasMore:false,callbacks:[{id:results[0].id,number:'+12025550102',reason:'scheduling'}]});
 const audits=await env.AGENT_DB.prepare("SELECT event FROM mayor_audit WHERE tenant_id=?").bind(actor.tenantId).all();
 expect(audits.results).toEqual([{event:'callback.requested'}]);
});
it('enforces tenant and role boundaries and records who handled the request',async()=>{
 const receipt=await requestCallback(env,callId,'scheduling');
 const outsider={tenantId:actor.tenantId,userId:crypto.randomUUID()};
 await expect(listCallbacks(env,outsider)).rejects.toThrow();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'staff')").bind(actor.tenantId,outsider.userId).run();
 await expect(listCallbacks(env,outsider)).rejects.toThrow();
 await expect(handleCallback(env,outsider,receipt.id)).rejects.toThrow();
 await expect(handleCallback(env,{...actor,tenantId:crypto.randomUUID()},receipt.id)).rejects.toThrow();
 expect(await handleCallback(env,actor,receipt.id)).toMatchObject({status:'handled'});
 await expect(handleCallback(env,actor,receipt.id)).rejects.toThrow();
 expect((await listCallbacks(env,actor)).callbacks).toEqual([]);
 expect(await requestCallback(env,callId,'scheduling')).toMatchObject({id:receipt.id,status:'handled'});
 expect(await env.AGENT_DB.prepare("SELECT actor_id FROM mayor_audit WHERE resource_id=? AND event='callback.handled'").bind(receipt.id).first()).toEqual({actor_id:actor.userId});
});
it.each(['ended','expired','changed_connection','revoked_owner','expired_owner','inactive_tenant','missing_number','disabled'] as const)('rejects %s calls without storing a request',async scenario=>{
 if(scenario==='ended')await env.AGENT_DB.prepare("UPDATE mayor_phone_calls SET state='ended' WHERE id=?").bind(callId).run();
 if(scenario==='expired')await env.AGENT_DB.prepare("UPDATE mayor_phone_calls SET expires_at='2000-01-01' WHERE id=?").bind(callId).run();
 if(scenario==='changed_connection')await env.AGENT_DB.prepare('UPDATE mayor_phone_connections SET revision=revision+1 WHERE tenant_id=?').bind(actor.tenantId).run();
 if(scenario==='revoked_owner')await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=?").bind(actor.tenantId).run();
 if(scenario==='expired_owner')await env.AGENT_DB.prepare("UPDATE agent_memberships SET expires_at='2000-01-01' WHERE tenant_id=?").bind(actor.tenantId).run();
 if(scenario==='inactive_tenant')await env.AGENT_DB.prepare("UPDATE agent_tenants SET status='suspended' WHERE id=?").bind(actor.tenantId).run();
 if(scenario==='missing_number')await env.AGENT_DB.prepare('UPDATE mayor_phone_calls SET caller_number=NULL WHERE id=?').bind(callId).run();
 await expect(requestCallback(scenario==='disabled'?{...env,PHONE_TEST_ENABLED:'false'}:env,callId,'scheduling')).rejects.toThrow();
 expect(await env.AGENT_DB.prepare('SELECT id FROM mayor_callbacks WHERE call_id=?').bind(callId).first()).toBeNull();
});
it('does not return a stale receipt after the originating connection is revoked',async()=>{
 await requestCallback(env,callId,'human_assistance');
 await env.AGENT_DB.prepare("UPDATE mayor_phone_connections SET status='revoked' WHERE tenant_id=?").bind(actor.tenantId).run();
 await expect(requestCallback(env,callId,'human_assistance')).rejects.toThrow();
 // A real request remains available for an operator even after the call connection is revoked.
 expect((await listCallbacks(env,actor)).callbacks).toHaveLength(1);
});

// Exercise the actual turn/confirmation methods against D1 with synthetic model
// bytes. This is not a real microphone, Durable Object lifecycle or phone test.
function phoneHarness(){
 let propose=true;
 const ai={run:async()=>{
  const events=propose?[
   {choices:[{delta:{tool_calls:[{id:'callback-1',index:0,type:'function',function:{name:'proposeCallback',arguments:'{"reason":"scheduling"}'}}]}}]},
   {choices:[{delta:{},finish_reason:'stop'}]},
  ]:[{response:'How can I help?'},{choices:[{delta:{},finish_reason:'stop'}]}];
  const bytes=new TextEncoder().encode(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join('')+'data: [DONE]\n\n');
  return new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}});
 }};
 const phone=Object.create(MayorPhone.prototype) as any;
 Object.assign(phone,{env:{...env,AI:ai},proposals:new Map(),ready:new Set(),generations:new Map(),authorize:async()=>({id:callId,tenantId:actor.tenantId}),forceEndCall:()=>{}});
 const connection={id:'fixture-connection'},controller=new AbortController();
 const turn=async(text:string)=>{
  const response=await phone.onTurn(text,{connection,signal:controller.signal,messages:[]});
  if(typeof response==='string')return response;
  let answer='';for await(const part of response)answer+=part;return answer;
 };
 return {phone,connection,turn,controller,noProposal:()=>{propose=false;}};
}
it('saves only on a separate explicit turn after the actual server readback completes',async()=>{
 const harness=phoneHarness();
 expect(await harness.turn('Can a person help me schedule?')).toContain('to save the request.');
 expect((await listCallbacks(env,actor)).callbacks).toHaveLength(0);
 harness.noProposal();
 expect(await harness.turn('yes')).toContain('callback request is saved');
 expect((await listCallbacks(env,actor)).callbacks).toHaveLength(1);
});
it.each(['interrupted','expired','correction','bare_yes'] as const)('does not save after %s confirmation',async scenario=>{
 const harness=phoneHarness();
 if(scenario!=='bare_yes')await harness.turn('Please ask someone to call me.');
 harness.noProposal();
 if(scenario==='interrupted')harness.phone.onInterrupt(harness.connection);
 if(scenario==='expired')harness.phone.proposals.get(harness.connection.id).expiresAt=0;
 if(scenario==='correction')await harness.turn('No, I want to discuss something else.');
 await harness.turn('yes');
 expect((await listCallbacks(env,actor)).callbacks).toHaveLength(0);
});

it.each(['punctuated','expired','unread','reconnected'] as const)('never delegates a %s callback confirmation outcome to the model',async scenario=>{
 const harness=phoneHarness();let modelCalls=0;
 harness.phone.env={...env,AI:{run:()=>{modelCalls++;throw new Error('Model cannot establish a callback receipt');}}};
 if(scenario!=='reconnected')harness.phone.proposals.set(harness.connection.id,{reason:'scheduling',expiresAt:Date.now()+(scenario==='expired'?-1000:60000)});
 if(scenario!=='unread'&&scenario!=='reconnected')harness.phone.ready.add(harness.connection.id);
 const answer=await harness.phone.onTurn('Yes. That’s correct.',{connection:harness.connection,signal:harness.controller.signal,messages:[{role:'assistant',content:'Say “yes, that is correct” to save the request.'}]});
 expect(modelCalls).toBe(0);expect(harness.phone.proposals.size).toBe(0);
 expect((await listCallbacks(env,actor)).callbacks).toHaveLength(scenario==='punctuated'?1:0);
 expect(answer).toContain(scenario==='punctuated'?'callback request is saved':'I have not made that change');
});
