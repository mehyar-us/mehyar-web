import {env as testEnv} from 'cloudflare:workers';
import {beforeEach,it,expect,vi} from 'vitest';
import type {Actor,Env} from '../../src/env';
import {confirmProfile} from '../../src/memory';
import {prepareCustomer,confirmCustomer} from '../../src/customers';
import {handleOperationsRequest} from '../../src/operations';
import {BUSINESS_ROUTINE_CATALOG,buildBusinessRoutineBrief,businessRoutineConfigSchema,readBusinessRoutines,prepareBusinessRoutines,confirmBusinessRoutines,runBusinessRoutineNow,runBusinessRoutines,routineNotifications,markRoutineBriefRead,handleBusinessRoutinesRequest} from '../../src/business-routines';

const env=testEnv as unknown as Env,schedule={timeZone:'America/New_York',frequency:'daily' as const,hour:8,minute:0};
let actor:Actor;
async function workspace(role='owner',userId=crypto.randomUUID()){
 const identity={tenantId:crypto.randomUUID().replaceAll('-',''),userId},now=new Date().toISOString();
 await env.AGENT_DB.batch([env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(identity.tenantId,'Routine fixture',now),env.AGENT_DB.prepare('INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,?)').bind(identity.tenantId,userId,role)]);return identity;
}
beforeEach(async()=>{actor=await workspace();});
async function save(identity=actor,enabled=false,extra:Record<string,unknown>={}){
 const current=await readBusinessRoutines(env,identity);
 return confirmBusinessRoutines(env,identity,await prepareBusinessRoutines(env,identity,{revision:current.config.revision,enabled,templateIds:['daily-priorities','customer-retention'],...(enabled?{schedule}:{}),...extra} as any));
}
function request(path:string,body?:unknown,identity=actor,origin=env.APP_ORIGIN){return new Request(`${env.APP_ORIGIN}/api/businesses/${identity.tenantId}/routines${path}`,body===undefined?{}:{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});}
async function due(identity=actor,time=Date.now()){
 const next=new Date(Math.floor(time/300000)*300000).toISOString(),date=new Intl.DateTimeFormat('en-CA',{timeZone:schedule.timeZone}).format(new Date(time));
 await env.AGENT_DB.prepare('UPDATE mayor_business_routines SET next_run_at=?,due_local_date=? WHERE tenant_id=? AND user_id=?').bind(next,date,identity.tenantId,identity.userId).run();return Date.parse(next);
}
async function scopedScheduled(identity=actor,options:{now:number;build?:typeof buildBusinessRoutineBrief}){
 // Each test owns its due row; unrelated persisted schedules must not enter its assertions.
 const runtime={...env,AGENT_DB:{prepare:(sql:string)=>{
  const statement=env.AGENT_DB.prepare(sql.startsWith('SELECT * FROM mayor_business_routines r WHERE')?sql.replace('ORDER BY next_run_at LIMIT 10',`AND r.tenant_id='${identity.tenantId}' AND r.user_id='${identity.userId}' ORDER BY next_run_at LIMIT 10`):sql);return statement;
 },batch:(statements:D1PreparedStatement[])=>env.AGENT_DB.batch(statements)}} as unknown as Env;
 return runBusinessRoutines(runtime,options);
}
async function task(title:string,identity=actor,dueAt:string|null=null){const id=crypto.randomUUID(),now=new Date().toISOString();await env.AGENT_DB.prepare('INSERT INTO mayor_tasks(id,tenant_id,title,due_at,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,identity.tenantId,title,dueAt,identity.userId,identity.userId,now,now).run();return id;}
async function callback(identity=actor){const call=crypto.randomUUID(),id=crypto.randomUUID(),now=new Date().toISOString();await env.AGENT_DB.batch([env.AGENT_DB.prepare("INSERT INTO mayor_phone_calls(id,tenant_id,account_id,call_sid,connection_revision,state,stream_expires_at,expires_at,created_at) VALUES(?,?,'fixture-account',?,1,'ended',?,?,?)").bind(call,identity.tenantId,crypto.randomUUID(),now,now,now),env.AGENT_DB.prepare("INSERT INTO mayor_callbacks(id,tenant_id,call_id,number,reason,created_at) VALUES(?,?,?,'+12025550102','scheduling',?)").bind(id,identity.tenantId,call,now)]);return id;}
async function booking(identity=actor,state='confirmed',jobState='applied'){
 const id=crypto.randomUUID(),now=new Date().toISOString(),start=new Date(Date.now()+3600000).toISOString(),end=new Date(Date.now()+7200000).toISOString(),input={title:'Recorded consultation',appointmentType:'Consultation',start,end,attendees:[]};
 await env.AGENT_DB.batch([env.AGENT_DB.prepare("INSERT INTO mayor_appointment_jobs(id,tenant_id,actor_id,provider,grant_id,calendar_id,authorization_stamp,policy_revision,input_json,reserved_start,reserved_end,state,expires_at,created_at,updated_at) VALUES(?,?,?,'google','fixture-grant','fixture-calendar','fixture-stamp',1,?,?,?,?,?,?,?)").bind(id,identity.tenantId,identity.userId,JSON.stringify(input),start,end,jobState,now,now,now),env.AGENT_DB.prepare("INSERT INTO mayor_appointments(id,tenant_id,provider,calendar_id,event_id,input_json,state,created_at,updated_at) VALUES(?,?,'google','fixture-calendar',?,?,?,?,?)").bind(id,identity.tenantId,crypto.randomUUID(),JSON.stringify(input),state,now,now)]);return id;
}

it('exposes eight truthful templates, starts paused and requires a saved configuration',async()=>{
 const state=await readBusinessRoutines(env,actor);expect(state.catalog).toHaveLength(8);expect(new Set(state.catalog.map(item=>item.id)).size).toBe(8);
 expect(state.config).toMatchObject({enabled:false,templateIds:['daily-priorities'],revision:0,schedule:null});expect(state.latestBrief).toBeNull();
 await expect(runBusinessRoutineNow(env,actor,{requestId:crypto.randomUUID()})).rejects.toMatchObject({code:'routine_config_required'});
 expect(businessRoutineConfigSchema.safeParse({revision:0,enabled:true,templateIds:['unknown'],schedule}).success).toBe(false);
 expect(businessRoutineConfigSchema.safeParse({revision:0,enabled:true,templateIds:['daily-priorities'],schedule:{...schedule,minute:3}}).success).toBe(false);
 expect(businessRoutineConfigSchema.safeParse({revision:0,enabled:true,templateIds:['daily-priorities','daily-priorities'],schedule}).success).toBe(false);
});
it('runs paused saved routines with actual records, excludes unconfirmed bookings and labels missing metrics',async()=>{
 await confirmProfile(env,actor,{name:'Grounded practice',services:['Consultation'],businessGoals:['Improve preparation']},0);
 const customer=await prepareCustomer(env,actor,{name:'Recorded contact',email:'routine-contact@example.test'});await confirmCustomer(env,actor,customer);
 const taskId=await task('Prepare actual estimate',actor,new Date(Date.now()-3600000).toISOString()),callbackId=await callback(),bookingId=await booking();await booking(actor,'cancelled');await booking(actor,'confirmed','uncertain');
 await save(actor,false,{templateIds:BUSINESS_ROUTINE_CATALOG.map(item=>item.id)});
 const result=await runBusinessRoutineNow(env,actor,{requestId:crypto.randomUUID()});expect(result.replay).toBe(false);
 expect(Object.fromEntries(result.brief.metrics.map(metric=>[metric.key,metric.value]))).toMatchObject({open_tasks:1,overdue_tasks:1,pending_callbacks:1,bookings_next_7_days:1,saved_customers:1,customers_with_contact:1,revenue:null});
 expect(result.brief.priorities.map(item=>item.source.id)).toEqual(expect.arrayContaining([taskId,callbackId,bookingId]));expect(result.brief.suggestions).toHaveLength(8);
 expect(JSON.stringify(result.brief)).not.toContain('routine-contact@example.test');expect(JSON.stringify(result.brief)).not.toContain('+12025550102');expect(result.brief.scope).toContain('nothing is sent');
 expect((await readBusinessRoutines(env,actor)).config.enabled).toBe(false);expect((await routineNotifications(env,actor))[0].id).toBe(result.brief.id);
 expect((await env.AGENT_DB.prepare('SELECT status FROM mayor_tasks WHERE id=?').bind(taskId).first<any>()).status).toBe('open');
});
it('isolates business evidence and operator-specific briefs and notifications',async()=>{
 const other=await workspace(),manager={...actor,userId:crypto.randomUUID()};await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'manager')").bind(manager.tenantId,manager.userId).run();
 await task('Private other tenant fact',other);await task('Local fact');await save();const result=await runBusinessRoutineNow(env,actor,{requestId:crypto.randomUUID()});
 expect(JSON.stringify(result.brief)).not.toContain('Private other tenant fact');expect((await readBusinessRoutines(env,manager)).latestBrief).toBeNull();expect(await routineNotifications(env,manager)).toEqual([]);expect(await markRoutineBriefRead(env,manager,result.brief.id)).toBeNull();
 await expect(readBusinessRoutines(env,{tenantId:other.tenantId,userId:actor.userId})).rejects.toMatchObject({code:'workspace_not_found'});
});
it.each(['staff','viewer','billing'])('denies %s configuration, runs and private history',async role=>{
 const denied=await workspace(role);await expect(readBusinessRoutines(env,denied)).rejects.toMatchObject({code:'permission_denied'});await expect(runBusinessRoutineNow(env,denied,{requestId:crypto.randomUUID()})).rejects.toMatchObject({code:'permission_denied'});
});
it('requires the app origin and optimistic revision for explicit configuration saves',async()=>{
 await expect(handleBusinessRoutinesRequest(request('',{revision:0,enabled:false,templateIds:['daily-priorities']},actor,'https://other.example'),env,actor)).rejects.toMatchObject({code:'invalid_origin'});
 const prepared=await prepareBusinessRoutines(env,actor,{revision:0,enabled:true,templateIds:['daily-priorities'],schedule});await save();await expect(confirmBusinessRoutines(env,actor,prepared)).rejects.toMatchObject({code:'routine_config_changed'});
 const stolen=await workspace();await expect(confirmBusinessRoutines(env,stolen,{...prepared,expiresAt:Date.now()+10000})).rejects.toMatchObject({code:'confirmation_expired'});
});
it('deduplicates a manual retry without reopening its read notice or creating another brief',async()=>{
 await save();const input={requestId:crypto.randomUUID()},first=await runBusinessRoutineNow(env,actor,input);await markRoutineBriefRead(env,actor,first.brief.id);
 const retry=await runBusinessRoutineNow(env,actor,input);expect(retry).toEqual({...first,replay:true});expect(await routineNotifications(env,actor)).toEqual([]);expect((await readBusinessRoutines(env,actor)).history).toHaveLength(1);
});
it('shows one ready brief in Today attention and removes it after reading',async()=>{
 await save();const first=await runBusinessRoutineNow(env,actor,{requestId:crypto.randomUUID()}),second=await runBusinessRoutineNow(env,actor,{requestId:crypto.randomUUID()});
 const overview=async()=>{const response=await handleOperationsRequest(new Request(`${env.APP_ORIGIN}/api/businesses/${actor.tenantId}/overview`),env,actor);return await response!.json() as any;};
 const before=await overview();expect(before.counts.unreadNotifications).toBe(1);expect(before.attention.filter((item:any)=>item.id==='business-routine-ready')).toEqual([expect.objectContaining({title:'Your business brief is ready',action:'tasks',count:1,resourceId:second.brief.id})]);
 expect((await routineNotifications(env,actor)).map(item=>item.id)).toEqual([second.brief.id]);expect((await env.AGENT_DB.prepare('SELECT read_at FROM mayor_business_routine_runs WHERE id=?').bind(first.brief.id).first<any>()).read_at).toBeTruthy();
 await markRoutineBriefRead(env,actor,second.brief.id);const after=await overview();expect(after.counts.unreadNotifications).toBe(0);expect(after.attention.some((item:any)=>item.id==='business-routine-ready')).toBe(false);
});
it('claims concurrent scheduled delivery once and deduplicates another occurrence of the same local day',async()=>{
 await save(actor,true);const now=await due(actor,Date.parse('2026-10-03T12:00:00-04:00')),build=vi.fn(buildBusinessRoutineBrief);
 const results=await Promise.all([scopedScheduled(actor,{now,build}),scopedScheduled(actor,{now,build})]);expect(build).toHaveBeenCalledTimes(1);expect(results.reduce((sum,result)=>sum+result.completed,0)).toBe(1);
 await due(actor,now+3600000);await scopedScheduled(actor,{now:now+3600000,build});expect(build).toHaveBeenCalledTimes(1);expect((await readBusinessRoutines(env,actor)).history).toHaveLength(1);expect(Date.parse((await readBusinessRoutines(env,actor)).config.nextRunAt!)).toBeGreaterThan(now+3600000);
});
it('creates a new scheduled brief across local midnight and deduplicates further delivery on that new date',async()=>{
 await save(actor,true);const first=await due(actor,Date.parse('2026-10-03T23:30:00-04:00')),second=first+3600000,build=vi.fn(buildBusinessRoutineBrief);
 expect((await scopedScheduled(actor,{now:first,build})).completed).toBe(1);
 await due(actor,second);expect((await scopedScheduled(actor,{now:second,build})).completed).toBe(1);
 expect(build).toHaveBeenCalledTimes(2);expect((await readBusinessRoutines(env,actor)).history).toHaveLength(2);
 const rows=await env.AGENT_DB.prepare('SELECT dedupe_key,due_local_date FROM mayor_business_routine_runs WHERE tenant_id=? AND user_id=? ORDER BY due_local_date').bind(actor.tenantId,actor.userId).all();
 expect(rows.results).toEqual([{dedupe_key:'scheduled:2026-10-03',due_local_date:'2026-10-03'},{dedupe_key:'scheduled:2026-10-04',due_local_date:'2026-10-04'}]);
 await due(actor,second+3600000);await scopedScheduled(actor,{now:second+3600000,build});expect(build).toHaveBeenCalledTimes(2);
 expect((await readBusinessRoutines(env,actor)).config.nextRunAt).toBe('2026-10-05T12:00:00.000Z');
});
it('skips paused and revoked schedules without reading their business facts',async()=>{
 await save(actor,true);const now=await due();await save(actor,false);const build=vi.fn(buildBusinessRoutineBrief);await scopedScheduled(actor,{now,build});expect(build).not.toHaveBeenCalled();
 await save(actor,true);await due(actor,now);await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=? AND user_id=?").bind(actor.tenantId,actor.userId).run();await scopedScheduled(actor,{now,build});expect(build).not.toHaveBeenCalled();
});
it.each(['pause','edit','revoke','role','lease'] as const)('discards in-flight scheduled evidence and notice after %s',async change=>{
 await save(actor,true);const now=await due();const result=await scopedScheduled(actor,{now,build:async(runtime,identity,selected,time)=>{
  const content=await buildBusinessRoutineBrief(runtime,identity,selected,time);
  if(change==='pause')await save(actor,false);else if(change==='edit')await save(actor,true,{templateIds:['weekly-growth']});else if(change==='revoke')await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=? AND user_id=?").bind(actor.tenantId,actor.userId).run();else if(change==='role')await env.AGENT_DB.prepare("UPDATE agent_memberships SET role='staff' WHERE tenant_id=? AND user_id=?").bind(actor.tenantId,actor.userId).run();else await env.AGENT_DB.prepare('UPDATE mayor_business_routines SET lease_until=? WHERE tenant_id=? AND user_id=?').bind(new Date(now-1).toISOString(),actor.tenantId,actor.userId).run();return content;
 }});
 expect(result).toMatchObject({completed:0,discarded:1});const runs=await env.AGENT_DB.prepare('SELECT state,brief_json FROM mayor_business_routine_runs WHERE tenant_id=? AND user_id=?').bind(actor.tenantId,actor.userId).all<any>();expect(runs.results).toEqual([{state:'discarded',brief_json:null}]);
 if(['pause','edit','lease'].includes(change))expect(await routineNotifications(env,actor)).toEqual([]);
});
it('does not reuse an interrupted manual request for a different configuration',async()=>{
 await save();const input={requestId:crypto.randomUUID()};await expect(runBusinessRoutineNow(env,actor,input,{build:async(runtime,identity,selected,time)=>{const brief=await buildBusinessRoutineBrief(runtime,identity,selected,time);await save(actor,false,{templateIds:['weekly-growth']});return brief;}})).rejects.toMatchObject({code:'routine_result_discarded'});
 await expect(runBusinessRoutineNow(env,actor,input)).rejects.toMatchObject({code:'routine_request_changed'});expect((await runBusinessRoutineNow(env,actor,{requestId:crypto.randomUUID()})).brief.templateIds).toEqual(['weekly-growth']);
});
it('makes a retried older request the latest generated brief without losing its request identity',async()=>{
 await save();const input={requestId:crypto.randomUUID()},now=Date.now();
 await expect(runBusinessRoutineNow(env,actor,input,{now,build:async()=>{throw new Error('read unavailable');}})).rejects.toMatchObject({code:'routine_brief_unavailable'});
 const earlier=await runBusinessRoutineNow(env,actor,{requestId:crypto.randomUUID()},{now:now+1000});
 const recovered=await runBusinessRoutineNow(env,actor,input,{now:now+2000});const current=await readBusinessRoutines(env,actor);
 expect(current.latestBrief?.id).toBe(recovered.brief.id);expect(current.history.map(item=>item.id)).toEqual([recovered.brief.id,earlier.brief.id]);expect(current.history[0].generatedAt).toBe(new Date(now+2000).toISOString());expect((await routineNotifications(env,actor)).map(item=>item.id)).toEqual([recovered.brief.id]);
 expect((await runBusinessRoutineNow(env,actor,input)).brief.id).toBe(recovered.brief.id);
});
it('retries failed scheduled reads with bounded backoff and no ready notice',async()=>{
 await save(actor,true);const now=await due(),build=vi.fn(async()=>{throw new Error('private record payload');});
 for(const offset of [0,300000,600000])expect((await scopedScheduled(actor,{now:now+offset,build})).failed).toBe(1);
 expect(build).toHaveBeenCalledTimes(3);expect((await readBusinessRoutines(env,actor)).config.lastStatus).toBe('failed');expect(Date.parse((await readBusinessRoutines(env,actor)).config.nextRunAt!)).toBeGreaterThan(now+600000);expect(await routineNotifications(env,actor)).toEqual([]);
 const row=await env.AGENT_DB.prepare('SELECT state,brief_json FROM mayor_business_routine_runs WHERE tenant_id=?').bind(actor.tenantId).first<any>();expect(row).toEqual({state:'failed',brief_json:null});
});
