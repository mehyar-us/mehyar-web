import {env as testEnv} from 'cloudflare:workers';
import {it,expect} from 'vitest';
import type {Env} from '../../src/env';
import {MayorVoice} from '../../src/voice';
import {confirmProfile,readMemory} from '../../src/memory';

it('does not arm a new confirmation when the model proposes an already saved profile',async()=>{
 const env=testEnv as unknown as Env,actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Recall fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
 await confirmProfile(env,actor,{name:'Recall fixture',services:['Consulting']},0);
 let calls=0;
 const ai={run:async()=>{
  const events=calls++===0?[{choices:[{delta:{tool_calls:[{id:'profile-1',index:0,type:'function',function:{name:'proposeProfile',arguments:'{"name":"Recall fixture","services":["Consulting"]}'}}]}}]}]:[{response:'Your saved business is Recall fixture. Scheduling details are still unknown.'}];
  const bytes=new TextEncoder().encode([...events,{choices:[{delta:{},finish_reason:'stop'}]}].map(event=>`data: ${JSON.stringify(event)}\n\n`).join('')+'data: [DONE]\n\n');
  return new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}});
 }};
 const voice=Object.create(MayorVoice.prototype) as any;
 for(const field of ['generations','pending','pendingCalendar','pendingPolicy','pendingBooking','pendingChange','pendingCallback','pendingCustomer'])voice[field]=new Map();
 Object.assign(voice,{env:{...env,AI:ai},ready:new Set(),authorize:async()=>actor});
 const turn=async(text:string)=>{
  const result=await voice.onTurn(text,{connection:{id:'recall',send:()=>{}},signal:new AbortController().signal,messages:[]});
  if(typeof result==='string')return result;
  let answer='';for await(const chunk of result)answer+=chunk;return answer;
 };
 expect(await turn('What do you remember? Do not change anything.')).toBe('Already saved: name: Recall fixture. services: Consulting. No changes made.');
 expect(calls).toBe(1);
 expect(voice.ready.size).toBe(0);
 expect(voice.pending.size).toBe(0);
 await turn('yes');
 expect((await readMemory(env,actor)).revision).toBe(1);
});

it.each(['punctuated','expired','unread','reconnected'] as const)('handles a %s confirmation without letting the model invent success',async mode=>{
 const env=testEnv as unknown as Env,actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Confirmation fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
 const voice=Object.create(MayorVoice.prototype) as any;let modelCalls=0;
 for(const field of ['generations','pending','pendingCalendar','pendingPolicy','pendingBooking','pendingChange','pendingCallback','pendingCustomer'])voice[field]=new Map();
 Object.assign(voice,{env:{...env,AI:{run:()=>{modelCalls++;throw new Error('Model must not decide whether a confirmation committed');}}},ready:new Set(['unread','reconnected'].includes(mode)?[]:['confirm']),authorize:async()=>actor});
 if(mode!=='reconnected')voice.pending.set('confirm',{patch:{name:'Confirmed example'},revision:0,expiresAt:Date.now()+(mode==='expired'?-1000:60000)});
 const answer=await voice.onTurn('Yes. That’s correct.',{connection:{id:'confirm',send:()=>{}},signal:new AbortController().signal,messages:mode==='reconnected'?[{role:'assistant',content:'Please verify: name: Confirmed example. Say yes to save.'}]:[]});
 expect(modelCalls).toBe(0);expect(voice.pending.size).toBe(0);
 const saved=await readMemory(env,actor);
 if(mode==='punctuated'){expect(answer).toMatch(/^Saved\./);expect(saved.profile.name).toBe('Confirmed example');expect(saved.revision).toBe(1);}
 else{expect(answer).toContain('I have not made that change');expect(saved.revision).toBe(0);}
});

it.each(['unstructured','reply','repaired','false_claim'] as const)('does not arm or save business changes from a %s response',async mode=>{
 const env=testEnv as unknown as Env,actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Response fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
 const voice=Object.create(MayorVoice.prototype) as any;
 for(const field of ['generations','pending','pendingCalendar','pendingPolicy','pendingBooking','pendingChange','pendingCallback','pendingCustomer'])voice[field]=new Map();
 let modelCalls=0;
 Object.assign(voice,{env:{...env,AI:{run:async()=>{
  modelCalls++;
  const delta=(mode==='unstructured'||mode==='repaired'&&modelCalls===1)?{content:'I saved your hours.'}:{tool_calls:[{id:'reply-1',index:0,type:'function',function:{name:'reply',arguments:JSON.stringify({text:mode==='false_claim'?'Your business time zone has been set to New York.':'What time do you open on Monday?'})}}]};
  const bytes=new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
  return new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}});
 }}},ready:new Set(),authorize:async()=>actor});
 const result=await voice.onTurn('Help me set my hours.',{connection:{id:'response',send:()=>{}},signal:new AbortController().signal,messages:[]});
 let answer='';for await(const part of result)answer+=part;
 expect(answer).toBe(['unstructured','false_claim'].includes(mode)?'I could not complete that request. Please tell me the change again.':'What time do you open on Monday?');
 if(mode==='false_claim')expect(modelCalls).toBeGreaterThan(0);else expect(modelCalls).toBe(mode==='reply'?1:2);expect(voice.ready.size).toBe(0);expect(voice.pending.size).toBe(0);expect((await readMemory(env,actor)).revision).toBe(0);
});


it.each(['proposal','unknown','staff_repaired','clarification','unbacked_ack','unexpected_field'] as const)('routes explicit profile edits through structured intake: %s',async mode=>{
 const env=testEnv as unknown as Env,actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Intake fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
 const voice=Object.create(MayorVoice.prototype) as any,events:any[]=[];
 for(const field of ['generations','pending','pendingCalendar','pendingPolicy','pendingBooking','pendingChange','pendingCallback','pendingCustomer'])voice[field]=new Map();
 const patch=['unknown','staff_repaired'].includes(mode)?{timeZone:'America/New_York',staff:[]}:{services:['Design'],locations:['Online']};let modelCalls=0;
 Object.assign(voice,{env:{...env,AI:{run:async(_model:unknown,request:any)=>{
  modelCalls++;
  if(modelCalls===1){
   expect(request.tool_choice).toEqual({type:'function',function:{name:'profileIntake'}});
   expect(request.tools.map((item:any)=>item.function?.name??item.name)).toEqual(['profileIntake']);
  }
  const input=mode==='staff_repaired'?{patch:{...patch,hours:null,staff:modelCalls===1?null:[]}}:mode==='unexpected_field'?{patch:{...patch,website:'https://invented.example'}}:mode==='unknown'?{patch:{...patch,hours:null}}:mode==='proposal'?{patch}: {question:mode==='clarification'?'What services do you offer?':'I have prepared your services. Shall I save them?'};
  const delta={tool_calls:[{id:'intake-'+modelCalls,index:0,type:'function',function:{name:'profileIntake',arguments:JSON.stringify(input)}}]};
  const bytes=new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
  return new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}});
 }}},ready:new Set(),authorize:async()=>actor});
 const turn=async(text:string)=>{
  const result=await voice.onTurn(text,{connection:{id:'intake',send:(event:string)=>events.push(JSON.parse(event))},signal:new AbortController().signal,messages:[]});
  if(typeof result==='string')return result;
  let answer='';for await(const part of result)answer+=part;return answer;
 };
 const answer=await turn(['unknown','staff_repaired'].includes(mode)?'Our business time zone is New York. I work alone with no staff members. Prepare these details; our hours are unknown.':mode==='clarification'?'Help me update our services.':'Our services are Design. We work Online. Prepare our services and locations for confirmation.');
 expect((await readMemory(env,actor)).revision).toBe(0);
 if(['proposal','unknown','staff_repaired'].includes(mode)){
  if(mode==='staff_repaired')expect(modelCalls).toBe(2);
  expect(events.find(event=>event.type==='profile_proposal')?.patch).toEqual(patch);
  expect(answer).toContain('to save these business details');expect(voice.ready.has('intake')).toBe(true);
  const callsBefore=modelCalls;
  const confirmation=await turn('Yes.');expect(confirmation).toMatch(/^Saved\./);
  if(['unknown','staff_repaired'].includes(mode)){
   expect(confirmation).toContain('fill in your hours later');
   expect(confirmation).not.toContain('When is your business available');
  }
  expect(modelCalls).toBe(callsBefore);
  expect((await readMemory(env,actor)).profile).toEqual(patch);
 }else{
  expect(voice.pending.size).toBe(0);expect(voice.ready.size).toBe(0);
  expect(answer).toBe(mode==='clarification'?'What services do you offer?':'I could not complete that request. Please tell me the change again.');
 }
});
