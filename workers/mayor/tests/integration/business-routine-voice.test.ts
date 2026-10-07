import {env as testEnv} from 'cloudflare:workers';
import {expect,it} from 'vitest';
import type {Actor,Env} from '../../src/env';
import {MayorVoice} from '../../src/voice';
import {confirmProfile,readMemory} from '../../src/memory';
import {confirmBusinessRoutines,prepareBusinessRoutines,readBusinessRoutines} from '../../src/business-routines';
import {routineVoiceTools} from '../../src/business-routine-voice';
const env=testEnv as unknown as Env,schedule={timeZone:'America/New_York',frequency:'weekdays' as const,hour:9,minute:0};
async function business(role='owner'){
 const actor={tenantId:crypto.randomUUID().replaceAll('-',''),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Routine voice fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare('INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,?)').bind(actor.tenantId,actor.userId,role).run();return actor;
}
type Call={name:string;args:unknown};
function instance(actor:Actor,calls:Call[]){
 const captured:any[]=[],voice=Object.create(MayorVoice.prototype) as any,connection={id:crypto.randomUUID(),send:()=>{}};
 const ai={run:async(_model:unknown,input:any)=>{captured.push(input);const call=calls.shift()??{name:'reply',args:{text:'The requested action could not be prepared. Please review the missing details.'}},delta={tool_calls:[{id:crypto.randomUUID(),index:0,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}]};const bytes=new TextEncoder().encode(`data: ${JSON.stringify({choices:[{delta}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);return new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}});}};
 for(const key of ['generations','pending','pendingCalendar','pendingPolicy','pendingBooking','pendingChange','pendingCallback','pendingCustomer'])voice[key]=new Map();
 Object.assign(voice,{env:{...env,AI:ai},ready:new Set(),authorize:async()=>actor});
 const turn=async(text:string,messages:any[]=[])=>{const result=await voice.onTurn(text,{connection,messages,signal:new AbortController().signal});if(typeof result==='string')return result;let answer='';for await(const part of result)answer+=part;return answer;};
 return {voice,connection,captured,turn};
}
async function count(actor:Actor,table:string){return (await env.AGENT_DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id=? AND user_id=?`).bind(actor.tenantId,actor.userId).first<{n:number}>())!.n;}
async function save(actor:Actor){return confirmBusinessRoutines(env,actor,await prepareBusinessRoutines(env,actor,{revision:0,enabled:false,templateIds:['daily-priorities']}));}
it('grounds a fresh first-use snapshot in local records and business context without saving config or a brief',async()=>{
 const actor=await business(),other=await business(),now=new Date().toISOString();
 await confirmProfile(env,actor,{name:'Garden kitchen',industry:'Restaurant',services:['Lunch catering'],businessGoals:['Repeat catering orders'],bottlenecks:['Quote follow-up'],currentTools:['Spreadsheet']},0);
 for(const [who,title] of [[actor,'Prepare catering quote'],[other,'Private unrelated task']] as const)await env.AGENT_DB.prepare('INSERT INTO mayor_tasks(id,tenant_id,title,due_at,priority,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),who.tenantId,title,'2020-01-01T00:00:00Z','high',who.userId,who.userId,now,now).run();
 const f=instance(actor,[{name:'readWorkdaySnapshot',args:{templateIds:['daily-priorities','service-offer-review']}},{name:'reply',args:{text:'Your overdue catering quote needs attention. Would you like to draft the next step?'}}]);
 expect(await f.turn('Daily priorities')).toContain('catering quote');
 const receipts=JSON.stringify(f.captured.at(-1).messages);expect(receipts).toContain('Prepare catering quote');expect(receipts).not.toContain('Private unrelated task');expect(receipts).toContain('revenue');
 const system=f.captured[0].messages.find((message:any)=>message.role==='system').content;expect(system).toContain('Restaurant');expect(system).toContain('Lunch catering');expect(system).toContain('Quote follow-up');expect(system).toContain('Spreadsheet');expect(system).toContain('Tailor draft language');
 expect(await count(actor,'mayor_business_routines')).toBe(0);expect(await count(actor,'mayor_business_routine_runs')).toBe(0);expect((await readMemory(env,actor)).profile.assistantName).toBeUndefined();expect(f.voice.ready.has(f.connection.id)).toBe(false);
});
it.each(['owner','manager'])('requires a separate %s confirmation for the complete local routine schedule',async role=>{
 const actor=await business(role),f=instance(actor,[{name:'proposeBusinessRoutines',args:{enabled:true,templateIds:['daily-priorities','callback-follow-up'],schedule}}]);
 const readback=await f.turn('Enable daily business briefs for priorities and callbacks, weekdays at 9 am New York.');
 expect(readback).toContain('Monday through Friday');expect(readback).toContain('09:00');expect(readback).toContain('America/New_York');expect(readback).toContain('Say yes');expect(await count(actor,'mayor_business_routines')).toBe(0);
 expect(await f.turn('yes')).toContain('automatic business briefs are saved');expect((await readBusinessRoutines(env,actor)).config).toMatchObject({enabled:true,revision:1,schedule,templateIds:['daily-priorities','callback-follow-up']});expect(await count(actor,'mayor_business_routine_runs')).toBe(0);
});
it('does not save interrupted or stale schedule confirmations',async()=>{
 const actor=await business(),f=instance(actor,[{name:'proposeBusinessRoutines',args:{enabled:true,templateIds:['daily-priorities'],schedule}}]);
 await f.turn('Schedule daily business briefs weekdays at 9 am New York.');f.voice.onInterrupt(f.connection);await f.turn('yes');expect(await count(actor,'mayor_business_routines')).toBe(0);
 const again=instance(actor,[{name:'proposeBusinessRoutines',args:{enabled:true,templateIds:['daily-priorities'],schedule}}]);await again.turn('Schedule daily business briefs weekdays at 9 am New York.');await save(actor);
 expect(await again.turn('yes')).toContain('could not save');expect((await readBusinessRoutines(env,actor)).config.enabled).toBe(false);
});
it('runs saved paused routines only on an explicit request and reads the recorded brief without another run',async()=>{
 const actor=await business();await save(actor);const f=instance(actor,[{name:'runBusinessReview',args:{}}]);
 expect(await f.turn('Run my business review now.')).toContain('Business brief recorded');expect(await count(actor,'mayor_business_routine_runs')).toBe(1);expect(f.voice.ready.has(f.connection.id)).toBe(false);
 const reader=instance(actor,[{name:'readDailyBrief',args:{}}]);expect(await reader.turn('Read my latest daily brief.')).toContain('Business brief recorded');expect(await count(actor,'mayor_business_routine_runs')).toBe(1);expect(reader.voice.ready.has(reader.connection.id)).toBe(false);
});
it('rejects model-invented automatic schedule and run intent without early writes',async()=>{
 const actor=await business();await save(actor);
 const scheduleCall=instance(actor,[{name:'proposeBusinessRoutines',args:{enabled:true,templateIds:['daily-priorities'],schedule}}]);await scheduleCall.turn('Help me plan today.');expect((await readBusinessRoutines(env,actor)).config.enabled).toBe(false);expect(scheduleCall.voice.pendingCustomer.size).toBe(0);
 const runCall=instance(actor,[{name:'runBusinessReview',args:{}}]);await runCall.turn('Do not run a business review. Show the priorities only.');expect(await count(actor,'mayor_business_routine_runs')).toBe(0);
});
it('keeps routine tools out of a staff model request and independently rejects a forged tool invocation',async()=>{
 const actor=await business('staff'),f=instance(actor,[{name:'proposeBusinessRoutines',args:{enabled:false,templateIds:['daily-priorities']}}]);await f.turn('Pause my business routines.');
 const tools=JSON.stringify(f.captured[0].tools);for(const name of routineVoiceTools)expect(tools).not.toContain(name);expect(tools).not.toContain('proposeAssistantName');expect(await count(actor,'mayor_business_routines')).toBe(0);expect(f.voice.pendingCustomer.size).toBe(0);
});
