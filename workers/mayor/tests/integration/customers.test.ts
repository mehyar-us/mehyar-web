import {env as testEnv} from 'cloudflare:workers';
import {beforeEach,it,expect} from 'vitest';
import type {Actor,Env} from '../../src/env';
import {prepareCustomer,confirmCustomer,searchCustomers,readCustomer,customerReadback} from '../../src/customers';
import {MayorVoice} from '../../src/voice';
const env=testEnv as unknown as Env;
let actor:Actor;
beforeEach(async()=>{
 actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Customer fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
});
it('keeps proposals read-only and persists an explicit confirmation with a content-free audit',async()=>{
 const proposal=await prepareCustomer(env,actor,{name:'Alex Smith',phone:'+12025550102'});
 expect((await searchCustomers(env,actor,{query:'Alex'})).customers).toEqual([]);
 expect(customerReadback(proposal)).toContain('does not verify the person or send a message');
 expect(await confirmCustomer(env,actor,proposal)).toMatchObject({saved:true,revision:1,identityVerified:false});
 expect(await confirmCustomer(env,actor,proposal)).toMatchObject({saved:true,revision:1});
 expect(await readCustomer(env,actor,proposal.id)).toMatchObject({name:'Alex Smith',phone:'+12025550102',email:null,identityVerified:false});
 const audit=await env.AGENT_DB.prepare('SELECT event,resource_id,actor_id FROM mayor_audit WHERE tenant_id=?').bind(actor.tenantId).all();
 expect(audit.results).toEqual([{event:'customer.created',resource_id:proposal.id,actor_id:actor.userId}]);
 expect(JSON.stringify(audit)).not.toContain('+12025550102');
});
it('rejects tenant and role violations on search, proposal and confirmation',async()=>{
 const proposal=await prepareCustomer(env,actor,{name:'Alex',email:'alex@example.test'});await confirmCustomer(env,actor,proposal);
 const outsider={...actor,userId:crypto.randomUUID()};
 await expect(searchCustomers(env,outsider,{query:'Alex'})).rejects.toThrow();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'staff')").bind(actor.tenantId,outsider.userId).run();
 await expect(readCustomer(env,outsider,proposal.id)).rejects.toThrow();
 await expect(prepareCustomer(env,outsider,{name:'Another',phone:'+12025550103'})).rejects.toThrow();
 await expect(confirmCustomer(env,outsider,proposal)).rejects.toThrow();
 const other={tenantId:crypto.randomUUID(),userId:actor.userId};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(other.tenantId,'Other',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(other.tenantId,other.userId).run();
 await expect(readCustomer(env,other,proposal.id)).rejects.toThrow('not available');
 expect((await searchCustomers(env,other,{query:'alex'})).customers).toEqual([]);
 await expect(prepareCustomer(env,other,{id:proposal.id,name:'Changed'})).rejects.toThrow();
});
it('preserves omitted contacts, supports explicit removal, and rejects stale conflicting edits',async()=>{
 const first=await prepareCustomer(env,actor,{name:'Alex',email:'ALEX@example.test',phone:'+12025550102'});await confirmCustomer(env,actor,first);
 const edit=await prepareCustomer(env,actor,{id:first.id,name:'Alex Smith'}),stale=await prepareCustomer(env,actor,{id:first.id,name:'Alex Jones'});
 expect(edit.profile.email).toBe('alex@example.test');expect(edit.profile.phone).toBe('+12025550102');
 await confirmCustomer(env,actor,edit);await expect(confirmCustomer(env,actor,stale)).rejects.toThrow('changed');
 const removal=await prepareCustomer(env,actor,{id:first.id,phone:null});await confirmCustomer(env,actor,removal);
 expect(await readCustomer(env,actor,first.id)).toMatchObject({name:'Alex Smith',phone:null,email:'alex@example.test',revision:3});
 await expect(prepareCustomer(env,actor,{id:first.id,email:null})).rejects.toThrow('contact method');
});
it('blocks exact copies while allowing different people to share a phone number',async()=>{
 const first=await prepareCustomer(env,actor,{name:'Alex Smith',phone:'+12025550102'});await confirmCustomer(env,actor,first);
 await expect(prepareCustomer(env,actor,{name:'  ALEX   SMITH  ',phone:'+12025550102'})).rejects.toThrow('already exists');
 const family=await prepareCustomer(env,actor,{name:'Jamie Smith',phone:'+12025550102'});await confirmCustomer(env,actor,family);
 expect((await searchCustomers(env,actor,{query:'+12025550102'})).customers).toHaveLength(2);
 expect((await searchCustomers(env,actor,{query:'%_'})).customers).toHaveLength(0);
});
it('deduplicates two independently prepared identical contacts at confirmation',async()=>{
 const a=await prepareCustomer(env,actor,{name:'Alex',phone:'+12025550102'}),b=await prepareCustomer(env,actor,{name:'Alex',phone:'+12025550102'});
 const outcomes=await Promise.allSettled([confirmCustomer(env,actor,a),confirmCustomer(env,actor,b)]);
 expect(outcomes.filter(result=>result.status==='fulfilled')).toHaveLength(1);
 expect((await searchCustomers(env,actor,{query:'Alex'})).customers).toHaveLength(1);
});
it.each(['membership','tenant'] as const)('refuses a saved proposal after %s revocation',async changed=>{
 const proposal=await prepareCustomer(env,actor,{name:'Alex',phone:'+12025550102'});
 if(changed==='membership')await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=?").bind(actor.tenantId).run();
 else await env.AGENT_DB.prepare("UPDATE agent_tenants SET status='paused' WHERE id=?").bind(actor.tenantId).run();
 await expect(confirmCustomer(env,actor,proposal)).rejects.toThrow();
 expect(await env.AGENT_DB.prepare('SELECT id FROM mayor_customers WHERE id=?').bind(proposal.id).first()).toBeNull();
});
it('rejects unverifiable contact shapes and extra sensitive fields',async()=>{
 for(const input of [{name:'Alex'},{name:'Alex',phone:'2025550102'},{name:'Alex',email:'bad'},{name:'Alex',email:'a@example.test',clinicalNotes:'private'}])await expect(prepareCustomer(env,actor,input as any)).rejects.toThrow();
});
function conversation(){
 let propose=true;
 const ai={run:async()=>{
  const events=propose?[{choices:[{delta:{tool_calls:[{id:'contact-1',index:0,type:'function',function:{name:'proposeCustomer',arguments:'{"name":"Alex Smith","phone":"+12025550102"}'}}]}}]},{choices:[{delta:{},finish_reason:'stop'}]}]:[{response:'What would you like to change?'},{choices:[{delta:{},finish_reason:'stop'}]}];
  const bytes=new TextEncoder().encode(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join('')+'data: [DONE]\n\n');
  return new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}});
 }};
 const voice=Object.create(MayorVoice.prototype) as any;
 for(const field of ['generations','pending','pendingCalendar','pendingPolicy','pendingBooking','pendingChange','pendingCallback','pendingCustomer'])voice[field]=new Map();
 Object.assign(voice,{env:{...env,AI:ai},ready:new Set(),authorize:async()=>actor});
 const connection={id:'fixture-connection',send:()=>{}},signal=new AbortController().signal;
 return {voice,connection,noProposal:()=>{propose=false;},turn:async(text:string)=>{
  const result=await voice.onTurn(text,{connection,signal,messages:[]});
  if(typeof result==='string')return result;
  let answer='';for await(const chunk of result)answer+=chunk;return answer;
 }};
}
it('saves through the actual conversation handler only after the separate readback confirmation',async()=>{
 const chat=conversation();expect(await chat.turn('Save Alex Smith at +12025550102.')).toContain('Say yes to save');
 expect((await searchCustomers(env,actor,{query:'Alex'})).customers).toHaveLength(0);
 chat.noProposal();expect(await chat.turn('yes')).toContain('contact details are saved');
 expect((await searchCustomers(env,actor,{query:'Alex'})).customers).toHaveLength(1);
});
it.each(['interrupt','correction'] as const)('does not save a stale customer confirmation after %s',async event=>{
 const chat=conversation();await chat.turn('Save Alex Smith at +12025550102.');chat.noProposal();
 if(event==='interrupt')chat.voice.onInterrupt(chat.connection);else await chat.turn('No, that is the wrong number.');
 await chat.turn('yes');expect((await searchCustomers(env,actor,{query:'Alex'})).customers).toHaveLength(0);
});
