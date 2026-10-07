import {env as testEnv} from 'cloudflare:workers';
import {beforeEach,it,expect} from 'vitest';
import type {Actor,Env} from '../../src/env';
import {proposeSchedulingSetup,confirmSchedulingSetup,readSchedulingSetup,schedulingDetailsPatchSchema,schedulingSetupReadback} from '../../src/scheduling-setup';
import {confirmSchedulingPolicy,readSchedulingPolicy,type SchedulingPolicy} from '../../src/scheduling-policy';
import {MayorVoice} from '../../src/voice';
import {confirmProfile} from '../../src/memory';
import {handleOperationsRequest} from '../../src/operations';
const env=testEnv as unknown as Env;
let actor:Actor;
const full:SchedulingPolicy={timeZone:'America/New_York',weeklyHours:[{day:1,startMinute:540,endMinute:1020}],appointmentTypes:[{name:'Consultation',durationMinutes:30,bufferBeforeMinutes:0,bufferAfterMinutes:10}],staff:[],closedDates:[],minimumNoticeMinutes:60,maximumAdvanceDays:30,cancellationNoticeMinutes:120};
beforeEach(async()=>{
 actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Setup fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
});
it('offers the confirmed profile timezone without saving or completing booking setup',async()=>{
 await confirmProfile(env,actor,{timeZone:full.timeZone},0);
 const before=await env.AGENT_DB.prepare('SELECT field,value_json,revision FROM mayor_memory WHERE tenant_id=? ORDER BY field').bind(actor.tenantId).all();
 const setup=await readSchedulingSetup(env,actor);
 expect(setup).toMatchObject({details:{},revision:0,active:false,readyForReview:false,nextQuestion:'Use America/New_York for appointments too?'});
 for(const field of ['time zone','weekly hours','appointment types','staff'])expect(setup.missing).toContain(field);
 expect(setup.lines).toEqual([]);
 expect((await readSchedulingPolicy(env,actor)).policy).toBeNull();
 expect((await env.AGENT_DB.prepare('SELECT field,value_json,revision FROM mayor_memory WHERE tenant_id=? ORDER BY field').bind(actor.tenantId).all()).results).toEqual(before.results);
});
it.each(['absent','unconfirmed','invalid'] as const)('keeps the timezone unknown for an %s profile candidate',async kind=>{
 if(kind!=='absent'){
  await confirmProfile(env,actor,{timeZone:full.timeZone},0);
  if(kind==='unconfirmed')await env.AGENT_DB.prepare("UPDATE mayor_memory SET confirmed_at=NULL WHERE tenant_id=? AND field='profile'").bind(actor.tenantId).run();
  else await env.AGENT_DB.prepare("UPDATE mayor_memory SET value_json=? WHERE tenant_id=? AND field='profile'").bind(JSON.stringify({timeZone:'Invalid/Zone'}),actor.tenantId).run();
 }
 expect(await readSchedulingSetup(env,actor)).toMatchObject({details:{},revision:0,active:false,readyForReview:false,nextQuestion:'What time zone does your business use?'});
});
it('preserves explicit setup and active-policy timezones ahead of the profile candidate',async()=>{
 await confirmProfile(env,actor,{timeZone:full.timeZone},0);
 await confirmSchedulingSetup(env,actor,await proposeSchedulingSetup(env,actor,{timeZone:'Europe/Paris'}));
 expect(await readSchedulingSetup(env,actor)).toMatchObject({details:{timeZone:'Europe/Paris'},revision:1,nextQuestion:'Which days and hours should be open for appointments?'});
 await confirmSchedulingPolicy(env,actor,{...full,timeZone:'Asia/Tokyo'},0);
 expect(await readSchedulingSetup(env,actor)).toMatchObject({details:null,active:true,nextQuestion:null,lines:expect.arrayContaining(['Time zone: Asia/Tokyo'])});
});
it('requires an explicit timezone proposal and separate confirmation without filling other unknown rules',async()=>{
 await confirmProfile(env,actor,{timeZone:full.timeZone},0);
 const hours=await proposeSchedulingSetup(env,actor,{weeklyHours:full.weeklyHours});
 expect(hours.details).not.toHaveProperty('timeZone');
 const savedHours=await confirmSchedulingSetup(env,actor,hours);
 expect(savedHours).toMatchObject({revision:1,readyForReview:false,nextQuestion:'Use America/New_York for appointments too?'});
 expect(savedHours.details).not.toHaveProperty('timeZone');
 const timezone=await proposeSchedulingSetup(env,actor,{timeZone:full.timeZone});
 expect((await readSchedulingSetup(env,actor)).details).toEqual({weeklyHours:full.weeklyHours});
 expect(schedulingSetupReadback(timezone)).toContain('Time zone: America/New_York');
 expect(schedulingSetupReadback(timezone)).toContain('booking rules are not activated');
 const confirmed=await confirmSchedulingSetup(env,actor,timezone);
 expect(confirmed).toMatchObject({revision:2,details:{weeklyHours:full.weeklyHours,timeZone:full.timeZone},readyForReview:false,nextQuestion:'What kind of appointment should clients be able to book first?'});
 expect(confirmed.details).not.toHaveProperty('appointmentTypes');expect(confirmed.details).not.toHaveProperty('staff');
 expect((await readSchedulingPolicy(env,actor)).policy).toBeNull();
});
it('uses the shared candidate question in Today without treating it as a confirmed scheduling rule',async()=>{
 const identity={...actor,tenantId:crypto.randomUUID().replaceAll('-','')};
 await env.AGENT_DB.batch([
  env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(identity.tenantId,'Today setup fixture',new Date().toISOString()),
  env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(identity.tenantId,identity.userId),
 ]);
 await confirmProfile(env,identity,{timeZone:full.timeZone},0);
 const response=await handleOperationsRequest(new Request(`${env.APP_ORIGIN}/api/businesses/${identity.tenantId}/overview`),env,identity);
 const overview=await response!.json() as any;
 expect(overview.business).toMatchObject({timeZone:full.timeZone,timeZoneKnown:true,timeZoneSource:'profile'});
 expect(overview.attention.find((item:any)=>item.id==='scheduling-rules')).toMatchObject({detail:'Use America/New_York for appointments too?',action:'chat'});
 expect(overview.attention.some((item:any)=>item.id==='business-timezone')).toBe(false);
 expect(overview.setup.schedulingReady).toBe(false);
 expect((await readSchedulingSetup(env,identity)).revision).toBe(0);
});
it('keeps profile candidates isolated across businesses and does not grant a viewer setup authority',async()=>{
 await confirmProfile(env,actor,{timeZone:full.timeZone},0);
 const other={...actor,tenantId:crypto.randomUUID()};
 await env.AGENT_DB.batch([
  env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(other.tenantId,'Other timezone fixture',new Date().toISOString()),
  env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(other.tenantId,other.userId),
 ]);
 await confirmProfile(env,other,{timeZone:'Europe/London'},0);
 expect((await readSchedulingSetup(env,actor)).nextQuestion).toBe('Use America/New_York for appointments too?');
 expect((await readSchedulingSetup(env,other)).nextQuestion).toBe('Use Europe/London for appointments too?');
 const viewer={...actor,userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'viewer')").bind(viewer.tenantId,viewer.userId).run();
 expect((await readSchedulingSetup(env,viewer)).nextQuestion).toBe('Use America/New_York for appointments too?');
 await expect(proposeSchedulingSetup(env,viewer,{timeZone:full.timeZone})).rejects.toThrow('Your role cannot perform this action.');
 await expect(confirmSchedulingSetup(env,viewer,await proposeSchedulingSetup(env,actor,{timeZone:full.timeZone}))).rejects.toThrow('Your role cannot perform this action.');
 expect((await readSchedulingSetup(env,actor)).revision).toBe(0);
});
it('resumes the candidate question through the deterministic voice path with no model or setup write',async()=>{
 await confirmProfile(env,actor,{timeZone:full.timeZone},0);
 const voice=Object.create(MayorVoice.prototype) as any;
 for(const field of ['generations','pending','pendingCalendar','pendingPolicy','pendingBooking','pendingChange','pendingCallback','pendingCustomer'])voice[field]=new Map();
 let modelCalls=0;
 Object.assign(voice,{env:{...env,AI:{run:async()=>{modelCalls++;throw new Error('This read-only path must not call a model.');}}},ready:new Set(),authorize:async()=>actor});
 const connection={id:'timezone-candidate',send:()=>{}},signal=new AbortController().signal;
 expect(await voice.onTurn('Help me finish my appointment scheduling rules. Ask one missing question at a time.',{connection,signal,messages:[]})).toBe('Use America/New_York for appointments too?');
 expect(modelCalls).toBe(0);expect((await readSchedulingSetup(env,actor)).revision).toBe(0);
 expect((await readSchedulingPolicy(env,actor)).policy).toBeNull();
});
it.each(['revoked','expired','tenant_suspended'] as const)('discards the profile timezone candidate when access is %s during its read',async mode=>{
 await confirmProfile(env,actor,{timeZone:full.timeZone},0);
 let intercepted=false;
 const guarded={...env,AGENT_DB:{prepare:(sql:string)=>{
  const statement=env.AGENT_DB.prepare(sql);
  if(!sql.includes("field='profile'"))return statement;
  return {bind:(...values:unknown[])=>({first:async()=>{
   const row=await statement.bind(...values).first();intercepted=true;
   const revoke=mode==='revoked'?"UPDATE agent_memberships SET status='revoked' WHERE tenant_id=?":mode==='expired'?"UPDATE agent_memberships SET expires_at='2000-01-01T00:00:00.000Z' WHERE tenant_id=?":"UPDATE agent_tenants SET status='suspended' WHERE id=?";
   await env.AGENT_DB.prepare(revoke).bind(actor.tenantId).run();return row;
  }})};
 },batch:env.AGENT_DB.batch.bind(env.AGENT_DB)}} as unknown as Env;
 await expect(readSchedulingSetup(guarded,actor)).rejects.toThrow('This workspace is not available.');
 expect(intercepted).toBe(true);
});
it('resumes confirmed partial details without guessing defaults or activating rules',async()=>{
 const proposal=await proposeSchedulingSetup(env,actor,{timeZone:full.timeZone,appointmentTypes:[{name:'Consultation',durationMinutes:30}]});
 expect((await readSchedulingSetup(env,actor)).revision).toBe(0);
 await confirmSchedulingSetup(env,actor,proposal);
 const resumed=await readSchedulingSetup(env,actor);
 expect(resumed).toMatchObject({revision:1,readyForReview:false,active:false,details:proposal.details});
 expect(resumed.details?.appointmentTypes?.[0]).not.toHaveProperty('bufferBeforeMinutes');
 expect(resumed.missing).toContain('appointment types / 1 / buffer before minutes');
 expect((await readSchedulingPolicy(env,actor)).policy).toBeNull();
 expect(schedulingSetupReadback(proposal)).toContain('buffer before unknown');
 expect(schedulingSetupReadback(proposal)).toContain('booking rules are not activated');
});
it('merges explicit answers and requires a separate full-policy activation',async()=>{
 await confirmSchedulingSetup(env,actor,await proposeSchedulingSetup(env,actor,{timeZone:full.timeZone}));
 const {timeZone,...remaining}=full;
 const second=await proposeSchedulingSetup(env,actor,remaining);
 expect(second.details.timeZone).toBe(timeZone);
 expect((await confirmSchedulingSetup(env,actor,second)).readyForReview).toBe(true);
 expect((await readSchedulingPolicy(env,actor)).policy).toBeNull();
 await confirmSchedulingPolicy(env,actor,full,0);
 expect(await readSchedulingSetup(env,actor)).toMatchObject({active:true,details:null});
 const activeLines=(await readSchedulingSetup(env,actor)).lines.join('\n');
 expect(activeLines).toContain('America/New_York');expect(activeLines).toContain('Monday 09:00 to 17:00');
 expect(activeLines).toContain('buffer after 10 minutes');expect(activeLines).toContain('Cancellation notice: 120 minutes');
 await expect(proposeSchedulingSetup(env,actor,{maximumAdvanceDays:60})).rejects.toThrow('already active');
});
it('rejects stale concurrent confirmations and audits only the winning revision',async()=>{
 const first=await proposeSchedulingSetup(env,actor,{minimumNoticeMinutes:60});
 const second=await proposeSchedulingSetup(env,actor,{minimumNoticeMinutes:120});
 const results=await Promise.allSettled([confirmSchedulingSetup(env,actor,first),confirmSchedulingSetup(env,actor,second)]);
 expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
 expect((await readSchedulingSetup(env,actor)).revision).toBe(1);
 const audit=await env.AGENT_DB.prepare("SELECT event,resource_id FROM mayor_audit WHERE tenant_id=?").bind(actor.tenantId).all();
 expect(audit.results).toEqual([{event:'scheduling_setup.confirmed',resource_id:'1'}]);
});
it('omits unchanged details from a new readback and refuses an empty confirmation',async()=>{
 await confirmSchedulingSetup(env,actor,await proposeSchedulingSetup(env,actor,{timeZone:full.timeZone}));
 const next=await proposeSchedulingSetup(env,actor,{timeZone:full.timeZone,closedDates:[]});
 expect(next.patch).toEqual({closedDates:[]});
 expect(next.details).toEqual({timeZone:full.timeZone,closedDates:[]});
 const repeated=await proposeSchedulingSetup(env,actor,{timeZone:full.timeZone});
 expect(repeated.patch).toEqual({});
 await expect(confirmSchedulingSetup(env,actor,repeated)).rejects.toThrow('already saved');
 expect((await readSchedulingSetup(env,actor)).revision).toBe(1);
});
it('does not save a pending setup after a policy becomes active',async()=>{
 const proposal=await proposeSchedulingSetup(env,actor,{weeklyHours:full.weeklyHours});
 await confirmSchedulingPolicy(env,actor,full,0);
 await expect(confirmSchedulingSetup(env,actor,proposal)).rejects.toThrow('changed');
 expect(await env.AGENT_DB.prepare("SELECT revision FROM mayor_memory WHERE tenant_id=? AND field='scheduling_setup'").bind(actor.tenantId).first()).toBeNull();
});
it('enforces tenant, role and revoked-membership boundaries',async()=>{
 const proposal=await proposeSchedulingSetup(env,actor,{timeZone:full.timeZone});
 const outsider={...actor,userId:crypto.randomUUID()};
 await expect(readSchedulingSetup(env,outsider)).rejects.toThrow();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'viewer')").bind(actor.tenantId,outsider.userId).run();
 expect((await readSchedulingSetup(env,outsider)).revision).toBe(0);
 await expect(confirmSchedulingSetup(env,outsider,proposal)).rejects.toThrow();
 await expect(proposeSchedulingSetup(env,outsider,{timeZone:full.timeZone})).rejects.toThrow();
 await expect(readSchedulingSetup(env,{...actor,tenantId:crypto.randomUUID()})).rejects.toThrow();
 await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=? AND user_id=?").bind(actor.tenantId,actor.userId).run();
 await expect(confirmSchedulingSetup(env,actor,proposal)).rejects.toThrow();
});
it('rejects malformed or contradictory partial details',()=>{
 for(const input of [{},{timeZone:'Invalid/Zone'},{minimumNoticeMinutes:-1},{extra:'ignored?'},{appointmentTypes:[{name:'A'},{name:'a'}]},{weeklyHours:[{day:1,startMinute:600,endMinute:500}]},{appointmentTypes:[{name:'A'}],staff:[{name:'Person',appointmentTypes:['B']}]}])expect(schedulingDetailsPatchSchema.safeParse(input).success).toBe(false);
 expect(schedulingDetailsPatchSchema.safeParse({appointmentTypes:[{name:'A'}]}).success).toBe(true);
});
it.each(['confirmed','interrupted'] as const)('uses the real conversational readback gate for %s setup',async mode=>{
 const voice=Object.create(MayorVoice.prototype) as any;
 for(const field of ['generations','pending','pendingCalendar','pendingPolicy','pendingBooking','pendingChange','pendingCallback','pendingCustomer'])voice[field]=new Map();
 const ai={run:async()=>{
  const events=[{choices:[{delta:{tool_calls:[{id:'setup-1',index:0,type:'function',function:{name:'proposeSchedulingDetails',arguments:'{"timeZone":"America/New_York"}'}}]}}]},{choices:[{delta:{},finish_reason:'stop'}]}];
  const bytes=new TextEncoder().encode(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join('')+'data: [DONE]\n\n');
  return new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}});
 }};
 Object.assign(voice,{env:{...env,AI:ai},ready:new Set(),authorize:async()=>actor});
 const connection={id:'setup',send:()=>{}},signal=new AbortController().signal;
 const response=await voice.onTurn('Use New York time for scheduling.',{connection,signal,messages:[]});
 let text='';for await(const chunk of response)text+=chunk;
 expect(text).toContain('America/New_York');expect((await readSchedulingSetup(env,actor)).revision).toBe(0);
 if(mode==='interrupted')voice.onInterrupt(connection);
 const answer=await voice.onTurn('Yes. That is correct.',{connection,signal,messages:[{role:'assistant',content:text}]});
 expect(answer).toContain(mode==='confirmed'?'Your scheduling setup is saved':'I have not made that change');
 expect((await readSchedulingSetup(env,actor)).revision).toBe(mode==='confirmed'?1:0);
 expect((await readSchedulingPolicy(env,actor)).policy).toBeNull();
});
it.each(['confirmed','interrupted','changed'] as const)('keeps complete setup inactive until its policy review is %s',async mode=>{
 await confirmSchedulingSetup(env,actor,await proposeSchedulingSetup(env,actor,full));
 const voice=Object.create(MayorVoice.prototype) as any;
 for(const field of ['generations','pending','pendingCalendar','pendingPolicy','pendingBooking','pendingChange','pendingCallback','pendingCustomer'])voice[field]=new Map();
 const ai={run:async()=>{
  const events=[{choices:[{delta:{tool_calls:[{id:'policy-1',index:0,type:'function',function:{name:'reviewSchedulingSetup',arguments:'{}'}}]}}]},{choices:[{delta:{},finish_reason:'stop'}]}];
  const bytes=new TextEncoder().encode(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join('')+'data: [DONE]\n\n');
  return new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}});
 }};
 Object.assign(voice,{env:{...env,AI:ai},ready:new Set(),authorize:async()=>actor});
 const connection={id:'activate',send:()=>{}},signal=new AbortController().signal;
 const response=await voice.onTurn('Review and activate my completed scheduling setup.',{connection,signal,messages:[]});
 let text='';for await(const chunk of response)text+=chunk;
 expect(text).toContain('America/New_York');expect(text).toContain('Consultation');
 expect((await readSchedulingPolicy(env,actor)).policy).toBeNull();
 if(mode==='interrupted')voice.onInterrupt(connection);
 if(mode==='changed')await confirmSchedulingSetup(env,actor,await proposeSchedulingSetup(env,actor,{maximumAdvanceDays:31}));
 const answer=await voice.onTurn('Yes. That is correct.',{connection,signal,messages:[{role:'assistant',content:text}]});
 expect(answer).toContain(mode==='confirmed'?'Your scheduling rules are saved':mode==='changed'?'Your rules could not be saved':'I have not made that change');
 expect((await readSchedulingPolicy(env,actor)).policy).toEqual(mode==='confirmed'?full:null);
 expect((await readSchedulingSetup(env,actor)).active).toBe(mode==='confirmed');
});
it.each(['direct','wrong_setup','wrong_setup_and_schema'] as const)('changes active hours after %s routing while preserving other confirmed rules',async mode=>{
 await confirmSchedulingPolicy(env,actor,full,0);
 const voice=Object.create(MayorVoice.prototype) as any;
 for(const field of ['generations','pending','pendingCalendar','pendingPolicy','pendingBooking','pendingChange','pendingCallback','pendingCustomer'])voice[field]=new Map();
 let modelCalls=0;
 const ai={run:async(_model:unknown,request:any)=>{
  modelCalls++;
  const available=request.tools.map((item:any)=>item.function?.name??item.name);
  expect(available).toContain('proposeSchedulingRules');
  expect(available).not.toContain('proposeSchedulingDetails');
  expect(available).not.toContain('reviewSchedulingSetup');
  const toolName=mode!=='direct'&&modelCalls===1?'proposeSchedulingDetails':'proposeSchedulingRules';
  const input=mode==='wrong_setup_and_schema'&&modelCalls===2?{weeklyHours:[{day:2,startMinute:600,endMinute:960}]}:{weeklyHours:[{day:'Tuesday',opens:'10 AM',closes:'4 PM'}]};
  const events=[{choices:[{delta:{tool_calls:[{id:'hours-1',index:0,type:'function',function:{name:toolName,arguments:JSON.stringify(input)}}]}}]},{choices:[{delta:{},finish_reason:'stop'}]}];
  const bytes=new TextEncoder().encode(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join('')+'data: [DONE]\n\n');
  return new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}});
 }};
 Object.assign(voice,{env:{...env,AI:ai},ready:new Set(),authorize:async()=>actor});
 const connection={id:'change-hours',send:()=>{}},signal=new AbortController().signal;
 const response=await voice.onTurn('Change appointments to Tuesday only, ten AM to four PM.',{connection,signal,messages:[]});
 let text='';for await(const chunk of response)text+=chunk;
 expect(modelCalls).toBe(mode==='direct'?1:mode==='wrong_setup'?2:3);
 expect(text).toContain('Tuesday 10:00 to 16:00');expect(text).toContain('All other rules stay as confirmed');
 expect((await readSchedulingPolicy(env,actor)).policy).toEqual(full);
 expect(await voice.onTurn('Yes. That is correct.',{connection,signal,messages:[{role:'assistant',content:text}]})).toContain('Your scheduling rules are saved');
 expect(await readSchedulingPolicy(env,actor)).toEqual({revision:2,policy:{...full,weeklyHours:[{day:2,startMinute:600,endMinute:960}]}});
});


for(const kind of ['setup','policy'] as const){
 it.each(['revoked','expired','tenant_suspended'] as const)(`discards ${kind} details when access is %s while reading`,async mode=>{
  await confirmSchedulingSetup(env,actor,await proposeSchedulingSetup(env,actor,full));
  if(kind==='policy')await confirmSchedulingPolicy(env,actor,full,0);
  let intercepted=false;
  const guarded={...env,AGENT_DB:{prepare:(sql:string)=>{
   const statement=env.AGENT_DB.prepare(sql);
   if(!sql.startsWith('SELECT value_json,revision FROM mayor_memory')||!sql.includes(`field='scheduling_${kind}'`))return statement;
   return {bind:(...values:unknown[])=>({first:async()=>{
    const row=await statement.bind(...values).first();intercepted=true;
    const revoke=mode==='revoked'?"UPDATE agent_memberships SET status='revoked' WHERE tenant_id=?":mode==='expired'?"UPDATE agent_memberships SET expires_at='2000-01-01T00:00:00.000Z' WHERE tenant_id=?":"UPDATE agent_tenants SET status='suspended' WHERE id=?";
    await env.AGENT_DB.prepare(revoke).bind(actor.tenantId).run();return row;
   }})};
  },batch:env.AGENT_DB.batch.bind(env.AGENT_DB)}} as unknown as Env;
  await expect(kind==='setup'?readSchedulingSetup(guarded,actor):readSchedulingPolicy(guarded,actor)).rejects.toThrow('This workspace is not available.');
  expect(intercepted).toBe(true);
 });
}
