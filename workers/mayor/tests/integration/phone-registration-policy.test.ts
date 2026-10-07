import {env as testEnv} from 'cloudflare:workers';
import {it,expect} from 'vitest';
import type {Env,Actor} from '../../src/env';
import {createAuth} from '../../src/auth';
import {MayorVoice} from '../../src/voice';
import {readPhoneRegistrationPolicy,preparePhoneRegistrationPolicy,confirmPhoneRegistrationPolicy,activePhoneRegistrationPolicy} from '../../src/phone-registration-policy';
const env=testEnv as unknown as Env;
async function fixture(){
 const user=await (await createAuth(env).$context).internalAdapter.createUser({email:`${crypto.randomUUID()}@example.test`,name:'Policy fixture',emailVerified:true});
 const actor:Actor={tenantId:crypto.randomUUID().replaceAll('-',''),userId:user.id};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Policy fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();return actor;
}
it('defaults off, does not enable on proposal, and revokes live authority on disable',async()=>{
 const actor=await fixture();expect(await readPhoneRegistrationPolicy(env,actor)).toEqual({enabled:false,revision:0});
 const proposal=await preparePhoneRegistrationPolicy(env,actor,{enabled:true});
 await expect(activePhoneRegistrationPolicy(env,actor.tenantId)).rejects.toThrow();
 expect(await confirmPhoneRegistrationPolicy(env,actor,proposal)).toEqual({enabled:true,revision:1});
 expect(await activePhoneRegistrationPolicy(env,actor.tenantId)).toEqual({revision:1,grantor:actor.userId});
 await confirmPhoneRegistrationPolicy(env,actor,await preparePhoneRegistrationPolicy(env,actor,{enabled:false}));
 await expect(activePhoneRegistrationPolicy(env,actor.tenantId)).rejects.toThrow();
});
it('rejects a stale enable after a newer disable and records only applied settings',async()=>{
 const actor=await fixture();const stale=await preparePhoneRegistrationPolicy(env,actor,{enabled:true});
 await confirmPhoneRegistrationPolicy(env,actor,await preparePhoneRegistrationPolicy(env,actor,{enabled:false}));
 await expect(confirmPhoneRegistrationPolicy(env,actor,stale)).rejects.toThrow();
 const audit=await env.AGENT_DB.prepare('SELECT event FROM mayor_audit WHERE tenant_id=?').bind(actor.tenantId).all();
 expect(audit.results).toEqual([{event:'phone.registration_disabled'}]);
});
it('denies another tenant and revoked grantors before confirmation and use',async()=>{
 const actor=await fixture(),other=await fixture();
 await expect(readPhoneRegistrationPolicy(env,{...actor,tenantId:other.tenantId})).rejects.toThrow();
 const proposal=await preparePhoneRegistrationPolicy(env,actor,{enabled:true});
 await confirmPhoneRegistrationPolicy(env,actor,proposal);
 const next=await preparePhoneRegistrationPolicy(env,actor,{enabled:false});
 await env.AGENT_DB.prepare("UPDATE agent_memberships SET role='staff' WHERE tenant_id=?").bind(actor.tenantId).run();
 await expect(confirmPhoneRegistrationPolicy(env,actor,next)).rejects.toThrow();
 await expect(activePhoneRegistrationPolicy(env,actor.tenantId)).rejects.toThrow();
});
it.each(['confirm','interrupt','correction','unread','expired','revoked'] as const)('requires a complete readback and a separate valid spoken confirmation (%s)',async mode=>{
 const actor=await fixture();let proposing=true;
 const ai={run:async()=>{
  const call=proposing?{name:'proposePhoneRegistrationSetting',arguments:'{"enabled":true}'}:{name:'reply',arguments:'{"text":"No registration setting was changed."}'};
  const bytes=new TextEncoder().encode(`data: ${JSON.stringify({choices:[{delta:{tool_calls:[{id:'registration-1',index:0,type:'function',function:call}]}}]})}\n\ndata: [DONE]\n\n`);
  return new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}});
 }};
 const voice=Object.create(MayorVoice.prototype) as any;
 for(const field of ['generations','pending','pendingCalendar','pendingPolicy','pendingBooking','pendingChange','pendingCallback','pendingCustomer'])voice[field]=new Map();
 Object.assign(voice,{env:{...env,AI:ai},ready:new Set(),authorize:async()=>actor});
 const connection={id:'registration-fixture',send:()=>{}},context={connection,signal:new AbortController().signal,messages:[]};
 const consume=async(response:any)=>{if(typeof response==='string')return response;let text='';for await(const part of response)text+=part;return text;};
 const response=await voice.onTurn('Allow new callers to register by phone.',context);
 if(mode==='unread'){
  const iterator=response[Symbol.asyncIterator]();await iterator.next();await iterator.return();
 }else expect(await consume(response)).toContain('verifies number possession, not personal identity');
 expect((await readPhoneRegistrationPolicy(env,actor)).enabled).toBe(false);proposing=false;
 if(mode==='interrupt')voice.onInterrupt(connection);
 if(mode==='correction')await consume(await voice.onTurn('No, leave registration disabled.',context));
 if(mode==='expired')voice.pendingCustomer.get(connection.id).expiresAt=Date.now()-1;
 if(mode==='revoked')await env.AGENT_DB.prepare("UPDATE agent_memberships SET role='staff' WHERE tenant_id=?").bind(actor.tenantId).run();
 await consume(await voice.onTurn('Yes.',context));
 if(mode==='confirm')expect(await activePhoneRegistrationPolicy(env,actor.tenantId)).toEqual({revision:1,grantor:actor.userId});
 else await expect(activePhoneRegistrationPolicy(env,actor.tenantId)).rejects.toThrow();
});
