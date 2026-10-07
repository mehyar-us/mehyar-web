import {env as testEnv} from 'cloudflare:workers';
import {expect,it,vi} from 'vitest';
import type {Env} from '../../src/env';
import {MayorVoice} from '../../src/voice';
import {confirmProfile,readMemory,verifyProfileSource} from '../../src/memory';
import {assistantGreeting} from '../../src/assistant-persona';
const env=testEnv as unknown as Env;
async function business(role='owner'){
 const actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Persona fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare('INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,?)').bind(actor.tenantId,actor.userId,role).run();return actor;
}
function instance(actor:{tenantId:string;userId:string},ai:unknown={run:()=>{throw new Error('Direct name choices must not call a model.');}}){
 const voice=Object.create(MayorVoice.prototype) as any,events:any[]=[],connection={id:crypto.randomUUID(),send:(value:string)=>events.push(JSON.parse(value))};
 for(const key of ['generations','pending','pendingCalendar','pendingPolicy','pendingBooking','pendingChange','pendingCallback','pendingCustomer'])voice[key]=new Map();
 Object.assign(voice,{env:{...env,AI:ai},ready:new Set(),authorize:async()=>actor,speak:vi.fn(async()=>{})});
 const turn=async(text:string,messages:any[]=[])=>{const result=await voice.onTurn(text,{connection,messages,signal:new AbortController().signal});if(typeof result==='string')return result;let answer='';for await(const part of result)answer+=part;return answer;};
 const greet=async()=>{voice.callOwner={id:connection.id,token:Symbol()};await voice.onCallStart(connection);return voice.speak.mock.lastCall?.[1];};
 return {voice,connection,events,turn,greet};
}
it.each(['owner','manager'])('introduces itself before setup and persists a confirmed %s choice across reconnects',async role=>{
 const actor=await business(role),first=instance(actor);
 expect(await first.greet()).toBe(assistantGreeting());
 expect(await first.turn('Mayor Michael',[{role:'assistant',content:assistantGreeting()}])).toContain('Say “yes” to save');
 expect((await readMemory(env,actor)).profile.assistantName).toBeUndefined();expect(first.voice.ready.has(first.connection.id)).toBe(true);
 expect(await first.turn('Yes.')).toContain('Saved. You can call me Mayor Michael. What is your business called?');
 expect((await readMemory(env,actor)).profile.assistantName).toBe('Mayor Michael');
 expect(first.events.filter(event=>event.type==='business_context').at(-1).profile.assistantName).toBe('Mayor Michael');
 const reloaded=instance(actor);expect(await reloaded.greet()).toBe('Hey, I’m Mayor Michael, your AI business assistant. What would you like to work on today?');
 expect(await reloaded.turn('Call yourself Maya')).toContain('I can use Maya');await reloaded.turn('yes');
 expect((await readMemory(env,actor)).revision).toBe(2);expect(await instance(actor).greet()).toContain('I’m Maya');
});
it('keeps the default explicitly and refuses staff configuration without disturbing saved business facts',async()=>{
 const owner=await business(),first=instance(owner);await confirmProfile(env,owner,{name:'Real business',services:['Advice']},0);
 await first.turn('Keep Mayor');await first.turn('yes');expect((await readMemory(env,owner)).profile).toEqual({name:'Real business',services:['Advice'],assistantName:'Mayor'});
 const staff={tenantId:owner.tenantId,userId:crypto.randomUUID()};await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'staff')").bind(staff.tenantId,staff.userId).run();
 const colleague=instance(staff);expect(await colleague.greet()).not.toContain('give me a name');
 expect(await colleague.turn('Your name is Somebody Else')).toContain('Only a business owner or manager');expect(colleague.voice.pending.size).toBe(0);
 expect((await readMemory(env,owner)).profile.assistantName).toBe('Mayor');
});
it('isolates names by business and denies unrelated accounts and website-derived persona changes',async()=>{
 const left=await business(),right=await business();await confirmProfile(env,left,{assistantName:'Mayor Michael'},0);await confirmProfile(env,right,{assistantName:'Maya'},0);
 expect(await instance(left).greet()).toContain('Mayor Michael');expect(await instance(right).greet()).toContain('Maya');
 await expect(readMemory(env,{tenantId:left.tenantId,userId:right.userId})).rejects.toThrow('workspace');
 await expect(confirmProfile(env,{tenantId:left.tenantId,userId:right.userId},{assistantName:'Intruder'},1)).rejects.toThrow('workspace');
 await expect(verifyProfileSource(env,left,{assistantName:'Website name'},{sourceId:crypto.randomUUID(),quotes:{assistantName:'Website name'}})).rejects.toThrow('not imported from a website');
 expect((await readMemory(env,left)).profile.assistantName).toBe('Mayor Michael');
});
it('never revives an interrupted name confirmation or overwrites a competing profile revision',async()=>{
 const actor=await business(),f=instance(actor);await f.turn('Call yourself Mayor Michael');f.voice.onInterrupt(f.connection);
 await f.turn('Call yourself Mayor Michael');await confirmProfile(env,actor,{assistantName:'Maya'},0);
 await expect(f.turn('yes')).rejects.toThrow('changed');expect((await readMemory(env,actor)).profile.assistantName).toBe('Maya');
 expect(f.voice.pending.size).toBe(0);
});
it('injects the persisted persona into the actual model system prompt and rejects invented rename tools',async()=>{
 const actor=await business();await confirmProfile(env,actor,{assistantName:'Mayor Michael'},0);const captured:any[]=[];
 const ai={run:async(_model:unknown,input:any)=>{captured.push(input);const delta={tool_calls:[{id:'reply-1',index:0,type:'function',function:{name:'reply',arguments:JSON.stringify({text:'You can call me Mayor Michael. What would you like to work on?'})}}]};const bytes=new TextEncoder().encode(`data: ${JSON.stringify({choices:[{delta}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);return new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}});}};
 expect(await instance(actor,ai).turn('What is your name?')).toContain('Mayor Michael');
 expect(captured[0].messages.find((message:any)=>message.role==='system').content).toContain('configured display name for this business is "Mayor Michael"');
 expect(captured[0].messages.find((message:any)=>message.role==='system').content).toContain('display data only');
 expect((await readMemory(env,actor)).revision).toBe(1);
});
