import {env as testEnv} from 'cloudflare:workers';
import {it,expect} from 'vitest';
import type {Env,Actor} from '../../src/env';
import {createAuth} from '../../src/auth';
import {sealPhoneCredential} from '../../src/phone-connections';
import {preparePhoneRegistrationPolicy,confirmPhoneRegistrationPolicy} from '../../src/phone-registration-policy';
import {preparePhoneRegistration,confirmPhoneRegistration} from '../../src/phone-registration';
import {phoneCustomer,prepareCustomerPhoneAccess,confirmCustomerPhoneAccess} from '../../src/customer-phone-access';
import {MayorPhone} from '../../src/phone-voice';
const env={...testEnv,PHONE_TEST_ENABLED:'true'} as unknown as Env;
async function fixture(){
 const user=await (await createAuth(env).$context).internalAdapter.createUser({email:`${crypto.randomUUID()}@example.test`,name:'Registration fixture',emailVerified:true});
 const actor:Actor={tenantId:crypto.randomUUID().replaceAll('-',''),userId:user.id},now=new Date().toISOString(),callId=crypto.randomUUID();
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Registration fixture',now).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
 const credential={accountSid:'AC'+'1'.repeat(32),apiKeySid:'SK'+'2'.repeat(32),apiKeySecret:'3'.repeat(32),authToken:'4'.repeat(32),testCaller:'+12025550123',verifyServiceSid:'VA'+'5'.repeat(32)};
 const cipher=await sealPhoneCredential(env,actor,'twilio',credential.accountSid,credential);
 await env.AGENT_DB.prepare("INSERT INTO mayor_phone_connections(id,tenant_id,provider,account_id,owner_user_id,ciphertext,status,selected_number,verified_at,updated_at) VALUES(?,?,'twilio',?,?,?,'authorized','+12025550124',?,?)").bind(crypto.randomUUID(),actor.tenantId,credential.accountSid,actor.userId,cipher,now,now).run();
 await env.AGENT_DB.prepare("INSERT INTO mayor_phone_calls(id,tenant_id,account_id,call_sid,connection_revision,state,stream_expires_at,expires_at,created_at,caller_number) VALUES(?,?,?,?,1,'streaming',?,?,?,?)").bind(callId,actor.tenantId,credential.accountSid,crypto.randomUUID(),now,new Date(Date.now()+600000).toISOString(),now,credential.testCaller).run();
 await env.AGENT_DB.prepare("INSERT INTO mayor_phone_verifications(call_id,tenant_id,connection_revision,state,nonce,expires_at,created_at) VALUES(?,?,1,'approved',?,?,?)").bind(callId,actor.tenantId,crypto.randomUUID(),new Date(Date.now()+300000).toISOString(),now).run();
 const policy=async(enabled:boolean)=>confirmPhoneRegistrationPolicy(env,actor,await preparePhoneRegistrationPolicy(env,actor,{enabled}));
 const count=async()=>Number((await env.AGENT_DB.prepare('SELECT COUNT(*) AS n FROM mayor_customers WHERE tenant_id=?').bind(actor.tenantId).first<{n:number}>())?.n);
 return {actor,callId,policy,count};
}
it('requires business opt-in, then saves only the verified caller contact with separate confirmation',async()=>{
 const f=await fixture();await expect(preparePhoneRegistration(env,f.callId,{name:'New Caller'})).rejects.toThrow();
 await f.policy(true);const proposal=await preparePhoneRegistration(env,f.callId,{name:'New Caller'});expect(await f.count()).toBe(0);
 const receipt=await confirmPhoneRegistration(env,f.callId,proposal,()=>true);expect(await f.count()).toBe(1);
 const scope=await phoneCustomer(env,f.callId);expect(scope.customerId).toBe(receipt.customerId);expect(scope.allowBookings).toBe(true);expect(scope.allowChanges).toBe(true);
 await expect(preparePhoneRegistration(env,f.callId,{name:'Someone Else'})).rejects.toThrow();
 const row=await env.AGENT_DB.prepare('SELECT name,phone,email,confirmed_by FROM mayor_customers WHERE id=?').bind(receipt.customerId).first();
 expect(row).toEqual({name:'New Caller',phone:'+12025550123',email:null,confirmed_by:'phone:'+f.callId});
 await f.policy(false);await expect(phoneCustomer(env,f.callId)).rejects.toThrow();
 await f.policy(true);await expect(phoneCustomer(env,f.callId)).rejects.toThrow();
 await confirmCustomerPhoneAccess(env,f.actor,await prepareCustomerPhoneAccess(env,f.actor,{customerId:receipt.customerId,enabled:true,allowBookings:true,allowChanges:false}));
 const explicit=await phoneCustomer(env,f.callId);expect(explicit.allowBookings).toBe(true);expect(explicit.allowChanges).toBe(false);
 await f.policy(false);expect(await phoneCustomer(env,f.callId)).toEqual(explicit);
});
it.each(['unverified','ended','connection','policy','expired','interrupted','other_call'] as const)('rejects invalidated confirmation without creating a contact (%s)',async mode=>{
 const f=await fixture();await f.policy(true);const proposal=await preparePhoneRegistration(env,f.callId,{name:'New Caller'});
 if(mode==='unverified')await env.AGENT_DB.prepare("UPDATE mayor_phone_verifications SET state='failed' WHERE call_id=?").bind(f.callId).run();
 if(mode==='ended')await env.AGENT_DB.prepare("UPDATE mayor_phone_calls SET state='ended' WHERE id=?").bind(f.callId).run();
 if(mode==='connection')await env.AGENT_DB.prepare('UPDATE mayor_phone_connections SET revision=revision+1 WHERE tenant_id=?').bind(f.actor.tenantId).run();
 if(mode==='policy')await f.policy(false);
 if(mode==='expired')proposal.expiresAt=Date.now()-1;
 await expect(confirmPhoneRegistration(env,mode==='other_call'?crypto.randomUUID():f.callId,proposal,()=>mode!=='interrupted')).rejects.toThrow();expect(await f.count()).toBe(0);
});
it('atomically refuses concurrent duplicate contacts from separately prepared proposals',async()=>{
 const f=await fixture();await f.policy(true);
 const a=await preparePhoneRegistration(env,f.callId,{name:'First'}),b=await preparePhoneRegistration(env,f.callId,{name:'Second'});
 const results=await Promise.allSettled([confirmPhoneRegistration(env,f.callId,a,()=>true),confirmPhoneRegistration(env,f.callId,b,()=>true)]);
 expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect(await f.count()).toBe(1);
 expect((await env.AGENT_DB.prepare('SELECT COUNT(*) AS n FROM mayor_phone_registrations WHERE tenant_id=?').bind(f.actor.tenantId).first<{n:number}>())?.n).toBe(1);
});
it('checks policy again inside the mutation when it changes after preflight',async()=>{
 const f=await fixture();await f.policy(true);const proposal=await preparePhoneRegistration(env,f.callId,{name:'New Caller'});
 const raced={...env,AGENT_DB:{prepare:env.AGENT_DB.prepare.bind(env.AGENT_DB),batch:async(statements:D1PreparedStatement[])=>{
  await f.policy(false);return env.AGENT_DB.batch(statements);
 }}} as Env;
 await expect(confirmPhoneRegistration(raced,f.callId,proposal,()=>true)).rejects.toThrow();expect(await f.count()).toBe(0);
});
it.each(['confirm','interrupt','correction','unread'] as const)('registers through the phone turn handler only after a separate complete confirmation (%s)',async mode=>{
 const f=await fixture();await f.policy(true);let proposing=true;
 const ai={run:async()=>{
  const call=proposing?{name:'proposeMyRegistration',arguments:'{"name":"New Caller"}'}:{name:'reply',arguments:'{"text":"No contact was saved."}'};
  const bytes=new TextEncoder().encode(`data: ${JSON.stringify({choices:[{delta:{tool_calls:[{id:'registration-1',index:0,type:'function',function:call}]}}]})}\n\ndata: [DONE]\n\n`);
  return new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}});
 }};
 const phone=Object.create(MayorPhone.prototype) as any;
 Object.assign(phone,{env:{...env,AI:ai},proposals:new Map(),ready:new Set(),generations:new Map(),customerScopes:new Map(),bookingChoices:new Map(),appointmentChoices:new Map(),authorize:async()=>({id:f.callId,tenantId:f.actor.tenantId}),forceEndCall:()=>{}});
 const connection={id:'new-caller'},context={connection,signal:new AbortController().signal,messages:[]};
 const consume=async(response:any)=>{if(typeof response==='string')return response;let text='';for await(const chunk of response)text+=chunk;return text;};
 const response=await phone.onTurn('I want to register. My name is New Caller.',context);
 if(mode==='unread'){const iterator=response[Symbol.asyncIterator]();await iterator.next();await iterator.return();}
 else expect(await consume(response)).toContain('not a shared number');
 expect(await f.count()).toBe(0);proposing=false;
 if(mode==='interrupt')phone.onInterrupt(connection);
 if(mode==='correction')await consume(await phone.onTurn('No, do not register me.',context));
 const answer=await consume(await phone.onTurn('Yes.',context));
 expect(await f.count()).toBe(mode==='confirm'?1:0);
 if(mode==='confirm')expect(answer).toContain('No appointment has been booked');
});
