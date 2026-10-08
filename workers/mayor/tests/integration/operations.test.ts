import {env as testEnv} from 'cloudflare:workers';
import {beforeEach,it,expect,vi} from 'vitest';
import type {Actor,Env} from '../../src/env';
import {handleOperationsRequest} from '../../src/operations';
import {prepareCustomer,confirmCustomer} from '../../src/customers';
import {confirmProfile} from '../../src/memory';
import {createAuth} from '../../src/auth';
import {encryptCredential} from '../../src/auth/vault';
import {confirmSchedulingPolicy} from '../../src/scheduling-policy';
import {selectCalendar} from '../../src/calendars';

const env=testEnv as unknown as Env;
let actor:Actor;
async function workspace(userId=crypto.randomUUID(),role='owner'){
 const identity={tenantId:crypto.randomUUID().replaceAll('-',''),userId};
 await env.AGENT_DB.batch([
  env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(identity.tenantId,'Local business',new Date().toISOString()),
  env.AGENT_DB.prepare('INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,?)').bind(identity.tenantId,userId,role),
 ]);
 return identity;
}
beforeEach(async()=>{actor=await workspace();});
function request(identity:Actor,path:string,body?:unknown,origin=env.APP_ORIGIN){
 return new Request(`${env.APP_ORIGIN}/api/businesses/${identity.tenantId}/${path}`,body===undefined?{}:{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
}
async function call(path:string,body?:unknown,identity=actor,runtime=env){
 const response=await handleOperationsRequest(request(identity,path,body),runtime,identity);
 if(!response)throw new Error('Route was not handled.');
 return {status:response.status,...await response.json() as any};
}
async function customer(name:string,identity=actor){
 const proposal=await prepareCustomer(env,identity,{name,email:`${crypto.randomUUID()}@example.test`});
 await confirmCustomer(env,identity,proposal);return proposal.id;
}
async function storedAppointment(start:string,end:string,options:{identity?:Actor;state?:string;jobState?:string;title?:string}={}){
 const identity=options.identity??actor,id=crypto.randomUUID(),now=new Date().toISOString();
 const input={title:options.title??'Service visit',appointmentType:'Consultation',start,end,attendees:[]};
 await env.AGENT_DB.batch([
  env.AGENT_DB.prepare(`INSERT INTO mayor_appointment_jobs(id,tenant_id,actor_id,provider,grant_id,calendar_id,authorization_stamp,policy_revision,input_json,reserved_start,reserved_end,state,expires_at,created_at,updated_at)
   VALUES(?,?,?,'google','fixture-grant','fixture-calendar','fixture-stamp',1,?,?,?,?,?,?,?)`).bind(id,identity.tenantId,identity.userId,JSON.stringify(input),new Date(start).toISOString(),new Date(end).toISOString(),options.jobState??'applied',now,now,now),
  env.AGENT_DB.prepare('INSERT INTO mayor_appointments(id,tenant_id,provider,calendar_id,event_id,input_json,state,created_at,updated_at) VALUES(?,?,\'google\',\'fixture-calendar\',?,?,?,?,?)')
   .bind(id,identity.tenantId,crypto.randomUUID(),JSON.stringify(input),options.state??'confirmed',now,now),
 ]);
 return id;
}
async function storedCallback(identity=actor){
 const callId=crypto.randomUUID(),id=crypto.randomUUID(),now=new Date().toISOString();
 await env.AGENT_DB.batch([
  env.AGENT_DB.prepare(`INSERT INTO mayor_phone_calls(id,tenant_id,account_id,call_sid,connection_revision,state,stream_expires_at,expires_at,created_at,caller_number)
   VALUES(?,?,'fixture-account',?,1,'ended',?,?,?,'+12025550102')`).bind(callId,identity.tenantId,crypto.randomUUID(),now,now,now),
  env.AGENT_DB.prepare("INSERT INTO mayor_callbacks(id,tenant_id,call_id,number,reason,created_at) VALUES(?,?,?,'+12025550102','scheduling',?)").bind(id,identity.tenantId,callId,now),
 ]);return id;
}

it('retains completed tasks, reopens them and applies exactly one concurrent revision',async()=>{
 const id=await customer('Jordan');
 const created=await call('tasks',{title:'  Prepare estimate  ',dueAt:'2026-10-03T09:00:00-04:00',priority:'high',customerId:id});
 expect(created).toMatchObject({status:201,task:{title:'Prepare estimate',dueAt:'2026-10-03T13:00:00.000Z',priority:'high',status:'open',revision:1,customer:{id,identityVerified:false}}});
 const outcomes=await Promise.allSettled([
  call(`tasks/${created.task.id}`,{revision:1,status:'completed'}),
  call(`tasks/${created.task.id}`,{revision:1,title:'Different edit'}),
 ]);
 expect(outcomes.filter(result=>result.status==='fulfilled')).toHaveLength(1);
 expect(outcomes.filter(result=>result.status==='rejected')).toHaveLength(1);
 let list=await call('tasks?status=all');expect(list.tasks).toHaveLength(1);expect(list.tasks[0].revision).toBe(2);
 const completed=await call(`tasks/${created.task.id}`,{revision:2,status:'completed'});
 expect(completed.task.completedAt).toBeTruthy();
 const reopened=await call(`tasks/${created.task.id}`,{revision:3,status:'open',customerId:null});
 expect(reopened.task).toMatchObject({status:'open',completedAt:null,customer:null,revision:4});
 const audits=await env.AGENT_DB.prepare("SELECT event FROM mayor_audit WHERE resource_id=? ORDER BY created_at,id").bind(created.task.id).all();
 expect(audits.results).toHaveLength(4);expect(JSON.stringify(audits)).not.toContain('Prepare estimate');
});

it('makes task retries idempotent and rejects a reused request with different content',async()=>{
 const requestId=crypto.randomUUID(),input={requestId,title:'Follow up'};
 const first=await call('tasks',input),retry=await call('tasks',input);
 expect(first.status).toBe(201);expect(retry.status).toBe(200);expect(first.task.id).toBe(retry.task.id);
 await expect(call('tasks',{...input,title:'Changed'})).rejects.toMatchObject({code:'request_changed'});
 expect((await call('tasks')).counts.total).toBe(1);
});

it('paginates tasks with and without due times and binds cursors to their filters',async()=>{
 for(let index=0;index<7;index++)await call('tasks',{title:`Task ${index}`,dueAt:index<4?`2026-10-0${index+1}T14:00:00Z`:null});
 const ids:string[]=[];let cursor:string|null=null;
 do{
  const page=await call(`tasks?limit=2${cursor?`&cursor=${cursor}`:''}`);expect(page.counts).toMatchObject({total:7,open:7,completed:0});
  ids.push(...page.tasks.map((item:any)=>item.id));cursor=page.nextCursor;
 }while(cursor);
 expect(ids).toHaveLength(7);expect(new Set(ids).size).toBe(7);
 const first=await call('tasks?limit=2');
 await expect(call(`tasks?status=all&cursor=${first.nextCursor}`)).rejects.toMatchObject({code:'invalid_cursor'});
 await expect(call('tasks?cursor=not_a_valid_cursor')).rejects.toMatchObject({code:'invalid_cursor'});
 expect((await call('tasks?dueBefore=2026-10-03T00:00:00Z')).tasks).toHaveLength(2);
});

it('enforces task customer tenant links in both the API and the database',async()=>{
 const other=await workspace(actor.userId),customerId=await customer('Other contact',other);
 await expect(call('tasks',{title:'Cross tenant',customerId})).rejects.toMatchObject({code:'customer_unavailable'});
 const created=await call('tasks',{title:'Local task'});
 await expect(call(`tasks/${created.task.id}`,{revision:1,customerId})).rejects.toMatchObject({code:'customer_unavailable'});
 await expect(env.AGENT_DB.prepare('UPDATE mayor_tasks SET customer_id=?,revision=revision+1 WHERE id=?').bind(customerId,created.task.id).run()).rejects.toThrow('FOREIGN KEY');
 await expect(call(`tasks/${created.task.id}`,{revision:1,status:'completed'},other)).rejects.toMatchObject({code:'task_unavailable'});
 expect((await call('tasks',undefined,other)).tasks).toEqual([]);
});

it('requires a server-held customer receipt and a separate explicit actor-bound confirmation',async()=>{
 const prepared=await call('customers/prepare',{name:'Alex',phone:'+12025550102'});
 expect(prepared).toMatchObject({status:201,proposal:{profile:{name:'Alex',phone:'+12025550102'},expectedRevision:0}});
 expect(prepared.proposal.readback).toContain('Say yes to save');expect((await call('customers')).total).toBe(0);
 const colleague={...actor,userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'manager')").bind(actor.tenantId,colleague.userId).run();
 await expect(call('customers/confirm',{id:prepared.proposal.id,confirm:true},colleague)).rejects.toMatchObject({code:'confirmation_unavailable'});
 await expect(call('customers/confirm',{id:prepared.proposal.id,confirm:true,proposal:{name:'Injected'}})).rejects.toThrow();
 await expect(call('customers/confirm',{id:prepared.proposal.id,confirm:false})).rejects.toThrow();
 const confirmed=await call('customers/confirm',{id:prepared.proposal.id,confirm:true});
 expect(confirmed.result).toMatchObject({id:prepared.proposal.customerId,revision:1,saved:true,identityVerified:false});
 expect(await call('customers/confirm',{id:prepared.proposal.id,confirm:true})).toEqual(confirmed);
 expect((await call(`customers/${confirmed.result.id}`)).customer).toMatchObject({name:'Alex',revision:1});
 const audit=await env.AGENT_DB.prepare("SELECT event FROM mayor_audit WHERE resource_id=?").bind(confirmed.result.id).all();expect(audit.results).toEqual([{event:'customer.created'}]);
});

it('rejects expired and stale customer receipts and concurrent confirmations audit once',async()=>{
 const expired=await call('customers/prepare',{name:'Expired',email:'expired@example.test'});
 await env.AGENT_DB.prepare("UPDATE mayor_customer_proposals SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(expired.proposal.id).run();
 await expect(call('customers/confirm',{id:expired.proposal.id,confirm:true})).rejects.toMatchObject({code:'confirmation_expired'});
 const prepared=await call('customers/prepare',{name:'Concurrent',email:'concurrent@example.test'});
 const outcomes=await Promise.allSettled([call('customers/confirm',{id:prepared.proposal.id,confirm:true}),call('customers/confirm',{id:prepared.proposal.id,confirm:true})]);
 expect(outcomes.every(result=>result.status==='fulfilled')).toBe(true);
 const editA=await call('customers/prepare',{id:prepared.proposal.customerId,name:'New name'}),editB=await call('customers/prepare',{id:prepared.proposal.customerId,name:'Stale name'});
 await call('customers/confirm',{id:editA.proposal.id,confirm:true});
 await expect(call('customers/confirm',{id:editB.proposal.id,confirm:true})).rejects.toMatchObject({code:'customer_changed'});
 expect((await call('customers')).total).toBe(1);
 const audit=await env.AGENT_DB.prepare("SELECT event FROM mayor_audit WHERE resource_id=?").bind(prepared.proposal.customerId).all();expect(audit.results).toHaveLength(2);
});

it('browses all customers with literal search and tenant/actor/filter-bound cursors',async()=>{
 for(let index=0;index<14;index++)await customer(`Alex ${String(index).padStart(2,'0')}`);
 await customer('Zoë');const other=await workspace(actor.userId);await customer('Other private contact',other);
 let cursor:string|null=null;const ids:string[]=[];
 do{
  const page=await call(`customers?limit=4${cursor?`&cursor=${cursor}`:''}`);expect(page.total).toBe(15);
  ids.push(...page.customers.map((item:any)=>item.id));cursor=page.nextCursor;
 }while(cursor);
 expect(ids).toHaveLength(15);expect(new Set(ids).size).toBe(15);
 const searched=await call('customers?q=alex&limit=3');expect(searched.total).toBe(14);
 await expect(call(`customers?q=zo&cursor=${searched.nextCursor}`)).rejects.toMatchObject({code:'invalid_cursor'});
 await expect(call(`customers?q=alex&cursor=${searched.nextCursor}`,undefined,other)).rejects.toMatchObject({code:'invalid_cursor'});
 expect((await call('customers?q=%25_')).customers).toEqual([]);
 expect((await call('customers?q=zo%C3%AB')).customers).toHaveLength(1);
});

it('uses business-local DST boundaries and orders offset-bearing appointment instants',async()=>{
 await confirmProfile(env,actor,{name:'Salon',services:['Haircut'],timeZone:'America/New_York'},0);
 const later=await storedAppointment('2026-11-01T01:00:00-05:00','2026-11-01T01:30:00-05:00');
 const earlier=await storedAppointment('2026-11-01T01:30:00-04:00','2026-11-01T01:45:00-04:00');
 const endOfDay=await storedAppointment('2026-11-01T23:30:00-05:00','2026-11-02T00:00:00-05:00');
 await storedAppointment('2026-11-02T00:00:00-05:00','2026-11-02T00:30:00-05:00');
 const first=await call('agenda?date=2026-11-01&limit=1');
 expect(first).toMatchObject({start:'2026-11-01T04:00:00.000Z',end:'2026-11-02T05:00:00.000Z',timeZone:'America/New_York',timeZoneKnown:true,total:3,source:{label:'Mayor appointments'}});
 expect(first.appointments[0].id).toBe(earlier);expect(first.source.scope).toContain('not imported');
 const second=await call(`agenda?date=2026-11-01&limit=1&cursor=${first.nextCursor}`);expect(second.appointments[0].id).toBe(later);
 const third=await call(`agenda?date=2026-11-01&limit=1&cursor=${second.nextCursor}`);expect(third.appointments[0].id).toBe(endOfDay);expect(third.hasMore).toBe(false);
 await expect(call(`agenda?date=2026-11-02&cursor=${first.nextCursor}`)).rejects.toMatchObject({code:'invalid_cursor'});
 const spring=await call('agenda?date=2026-03-08');expect(Date.parse(spring.end)-Date.parse(spring.start)).toBe(23*3600000);
 await expect(call('agenda?date=2026-02-30')).rejects.toThrow();
 await expect(call('agenda?start=2026-10-01T00:00:00Z&end=2027-10-01T00:00:00Z')).rejects.toMatchObject({code:'invalid_range'});
});

it('keeps agenda customer filters private and projections current after a reschedule',async()=>{
 const customerId=await customer('Linked customer'),id=await storedAppointment('2026-10-03T10:00:00Z','2026-10-03T10:30:00Z');
 await env.AGENT_DB.prepare('INSERT INTO mayor_appointment_customers(booking_id,tenant_id,customer_id,customer_revision) VALUES(?,?,?,1)').bind(id,actor.tenantId,customerId).run();
 expect((await call(`agenda?date=2026-10-03&customerId=${customerId}`)).appointments).toMatchObject([{id,customer:{id:customerId,identityVerified:false}}]);
 const other=await workspace(actor.userId);await expect(call(`agenda?date=2026-10-03&customerId=${customerId}`,undefined,other)).rejects.toMatchObject({code:'customer_unavailable'});
 const input={title:'Moved visit',appointmentType:'Consultation',start:'2026-10-04T12:00:00Z',end:'2026-10-04T12:30:00Z',attendees:[]};
 await env.AGENT_DB.prepare('UPDATE mayor_appointments SET input_json=? WHERE id=?').bind(JSON.stringify(input),id).run();
 expect((await call('agenda?date=2026-10-03')).total).toBe(0);expect((await call('agenda?date=2026-10-04')).appointments[0].input.title).toBe('Moved visit');
});

it('returns complete overview counts independently from its six-row previews',async()=>{
 await confirmProfile(env,actor,{name:'Repair shop',services:['Repairs'],timeZone:'UTC'},0);
 for(let index=0;index<12;index++){await customer(`Customer ${index}`);await call('tasks',{title:`Follow up ${index}`,dueAt:'2026-01-01T09:00:00Z'});}
 for(let index=0;index<35;index++)await storedAppointment(`2026-10-03T10:${String(index).padStart(2,'0')}:00Z`,`2026-10-03T11:${String(index).padStart(2,'0')}:00Z`);
 await storedAppointment('2026-10-03T12:00:00Z','2026-10-03T12:30:00Z',{state:'cancelled'});
 await storedCallback();await storedCallback();
 const other=await workspace(actor.userId);await storedAppointment('2026-10-03T10:00:00Z','2026-10-03T10:30:00Z',{identity:other});await call('tasks',{title:'Other task'},other);
 const result=await call('overview?date=2026-10-03');
 expect(result.business).toMatchObject({id:actor.tenantId,name:'Repair shop',timeZone:'UTC',timeZoneKnown:true});
 expect(result.counts).toMatchObject({customers:12,appointmentsToday:35,tasksOpen:12,tasksOverdue:12,callbacksPending:2});
 expect(result.tasks).toHaveLength(6);expect(result.appointments).toHaveLength(6);
 expect(result.attention).toEqual(expect.arrayContaining([expect.objectContaining({kind:'task',count:12,action:'tasks'}),expect.objectContaining({kind:'callback',count:2,action:'callbacks'})]));
 expect(result.setup).toMatchObject({profileComplete:true,schedulingReady:false,calendarConnected:false});
});

it('surfaces pending missed calls as a text-back attention item',async()=>{
 const now=new Date().toISOString();
 // Simpler explicit insert (avoids brittle date arithmetic).
 await env.AGENT_DB.prepare('INSERT INTO mayor_missed_calls(id,tenant_id,caller_number,business_number,occurred_at,source,status) VALUES(?,?,?,?,\'now\',\'test\',\'missed\')').bind(crypto.randomUUID(),actor.tenantId,'+15550131234','+15550139876').run();
 await env.AGENT_DB.prepare('INSERT INTO mayor_missed_calls(id,tenant_id,caller_number,business_number,occurred_at,source,status) VALUES(?,?,?,?,\'now\',\'test\',\'missed\')').bind(crypto.randomUUID(),actor.tenantId,'+15550135555','+15550139876').run();
 const result=await call('overview?date=2026-10-03');
 const item=result.attention.find((entry:any)=>entry.action==='missed-calls');
 expect(item).toMatchObject({id:'missed-calls',kind:'missed_call',count:2,action:'missed-calls'});
 expect(item.title).toBe('2 missed calls need text-back');
 // Texted calls drop out of attention.
 await env.AGENT_DB.prepare("UPDATE mayor_missed_calls SET status='texted',textback_sent_at=? WHERE tenant_id=?").bind(now,actor.tenantId).run();
 expect((await call('overview?date=2026-10-03')).attention.some((entry:any)=>entry.action==='missed-calls')).toBe(false);
});

it('labels an unknown timezone fallback and exposes actual uncertain appointment reviews',async()=>{
 const id=await storedAppointment('2026-10-03T10:00:00Z','2026-10-03T10:30:00Z',{jobState:'uncertain'});
 await env.AGENT_DB.prepare("INSERT INTO mayor_recovery_attempts(kind,request_id,tenant_id,attempts,state,next_attempt_at,lease_until,last_result,updated_at) VALUES('booking',?,?,6,'review',0,0,'uncertain',?)").bind(id,actor.tenantId,new Date().toISOString()).run();
 const result=await call('overview?date=2026-10-03');
 expect(result.business).toMatchObject({timeZone:'UTC',timeZoneKnown:false,timeZoneSource:'fallback'});
 expect(result.counts).toMatchObject({bookingsPending:1,appointmentReviews:1});
 expect(result.attention).toEqual(expect.arrayContaining([expect.objectContaining({id:'business-timezone'}),expect.objectContaining({kind:'appointment_review',count:1})]));
 const agenda=await call('agenda?date=2026-10-03');expect(agenda.appointments[0].recovery).toMatchObject({status:'review',attempts:6,nextCheckAt:null});
});

it('paginates pending callbacks and handles only an explicitly confirmed tenant request',async()=>{
 const ids=await Promise.all([storedCallback(),storedCallback(),storedCallback()]);
 const first=await call('callbacks?limit=2');expect(first).toMatchObject({total:3,hasMore:true,identityVerified:false});
 const second=await call(`callbacks?limit=2&cursor=${first.nextCursor}`);expect(second.callbacks).toHaveLength(1);
 expect(new Set([...first.callbacks,...second.callbacks].map((item:any)=>item.id)).size).toBe(3);
 await expect(call(`callbacks/${ids[0]}/handled`,{confirm:false})).rejects.toThrow();
 const other=await workspace(actor.userId);await expect(call(`callbacks/${ids[0]}/handled`,{confirm:true},other)).rejects.toThrow();
 expect(await call(`callbacks/${ids[0]}/handled`,{confirm:true})).toMatchObject({callback:{id:ids[0],status:'handled'}});
 expect((await call('callbacks')).total).toBe(2);
});

it.each(['staff','viewer','billing'])('denies %s operations and enforces the mutation origin and routed tenant',async role=>{
 const denied={...actor,userId:crypto.randomUUID()};await env.AGENT_DB.prepare('INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,?)').bind(actor.tenantId,denied.userId,role).run();
 for(const path of ['overview','tasks','customers','agenda','callbacks'])await expect(call(path,undefined,denied)).rejects.toMatchObject({code:'permission_denied'});
 await expect(handleOperationsRequest(request(actor,'tasks',{title:'Wrong origin'},'https://unrelated.example'),env,actor)).rejects.toMatchObject({code:'invalid_origin'});
 const other=await workspace(actor.userId);await expect(handleOperationsRequest(request(other,'tasks'),env,actor)).rejects.toMatchObject({code:'workspace_not_found'});
 expect(await handleOperationsRequest(new Request(`${env.APP_ORIGIN}/api/other`),env,actor)).toBeNull();
});

it('discards private task data if the management membership is revoked during the read',async()=>{
 await call('tasks',{title:'Private work'});let intercepted=false;
 const guarded={...env,AGENT_DB:{prepare:(sql:string)=>{
  const statement=env.AGENT_DB.prepare(sql);
  if(!sql.startsWith('SELECT t.id,t.title'))return statement;
  return {bind:(...values:unknown[])=>({all:async()=>{
   const result=await statement.bind(...values).all();intercepted=true;
   await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=? AND user_id=?").bind(actor.tenantId,actor.userId).run();return result;
  }})};
 }}} as unknown as Env;
 await expect(call('tasks',undefined,actor,guarded)).rejects.toMatchObject({code:'workspace_not_found'});expect(intercepted).toBe(true);
});

it('reuses prerequisite and actor checks for booking, change, reconciliation and availability routes',async()=>{
 const id=crypto.randomUUID();
 await expect(call('appointments/propose',{title:'Visit',appointmentType:'Consultation',start:'2026-10-03T10:00:00Z',end:'2026-10-03T10:30:00Z',attendees:[]})).rejects.toMatchObject({code:'policy_required'});
 await expect(call('appointments/confirm',{id,confirm:true})).rejects.toMatchObject({code:'appointment_unavailable'});
 await expect(call('appointment-changes/propose',{kind:'cancel',appointmentId:id})).rejects.toMatchObject({code:'appointment_unavailable'});
 await expect(call('appointment-changes/confirm',{id,confirm:true})).rejects.toMatchObject({code:'change_unavailable'});
 await expect(call('appointment-changes/reconcile',{id})).rejects.toMatchObject({code:'change_unavailable'});
 await expect(call('availability',{start:'2026-10-03T10:00:00Z',end:'2026-10-03T11:00:00Z',appointmentType:'Consultation'})).rejects.toMatchObject({code:'policy_required'});
});

it('books, reschedules and cancels through reviewed forms with provider writes only after confirmation',async()=>{
 const user=await(await createAuth(env).$context).internalAdapter.createUser({email:`${crypto.randomUUID()}@example.test`,name:'Operator',emailVerified:true});
 actor=await workspace(user.id);
 await confirmSchedulingPolicy(env,actor,{timeZone:'UTC',weeklyHours:Array.from({length:7},(_,day)=>({day,startMinute:0,endMinute:1440})),closedDates:[],appointmentTypes:[{name:'Consultation',durationMinutes:30,bufferBeforeMinutes:0,bufferAfterMinutes:0}],staff:[],minimumNoticeMinutes:0,maximumAdvanceDays:30,cancellationNoticeMinutes:0},0);
 const grantId=crypto.randomUUID(),scopes=['https://www.googleapis.com/auth/calendar'];
 const ciphertext=await encryptCredential({accountEmail:'operator@example.test',accessToken:'fixture-token',accessTokenExpiresAt:new Date(Date.now()+3600000).toISOString(),grantedScopes:scopes},{...actor,provider:'google',accountId:grantId},env.TOKEN_ENCRYPTION_KEY!);
 await env.AGENT_DB.prepare(`INSERT INTO auth_provider_grants(id,user_id,provider,account_id,tenant_scope,ciphertext,granted_scopes,selected_capabilities,status,updated_at) VALUES(?,?,'google',?,?,?,?,?,'authorized',?)`)
  .bind(grantId,user.id,grantId,actor.tenantId,ciphertext,JSON.stringify(scopes),'["calendar_manage"]',new Date().toISOString()).run();
 let event:any=null,creates=0,patches=0,deletes=0;
 const transport=(async(url:RequestInfo|URL,init?:RequestInit)=>{
  const path=new URL(String(url)).pathname,method=init?.method??'GET';
  if(path.endsWith('/calendarList'))return Response.json({items:[{id:'calendar',summary:'Appointments',accessRole:'owner'}]});
  if(path.endsWith('/freeBusy'))return Response.json({calendars:{calendar:{busy:[]}}});
  if(path.endsWith('/events')&&method==='GET')return Response.json({items:event?[event]:[]});
  if(method==='POST'){creates++;event={...JSON.parse(String(init?.body)),etag:'v1',status:'confirmed',organizer:{self:true},eventType:'default'};return Response.json(event);}
  if(method==='PATCH'){patches++;event={...event,...JSON.parse(String(init?.body)),etag:'v2'};return Response.json(event);}
  if(method==='DELETE'){deletes++;event=null;return new Response(null,{status:204});}
  if(event)return Response.json(event);
  throw new Error(`Unexpected fixture provider read: ${path}`);
 }) as typeof fetch;
 await selectCalendar(env,actor,{provider:'google',grantId,calendarId:'calendar'},transport);
 const network=vi.spyOn(globalThis,'fetch').mockImplementation(transport);
 try{
  const start=Math.ceil((Date.now()+86400000)/60000)*60000;
  const input={title:'Repair consultation',appointmentType:'Consultation',start:new Date(start).toISOString(),end:new Date(start+1800000).toISOString(),attendees:[]};
  const availability=await call('availability',{start:input.start,end:new Date(start+7200000).toISOString(),appointmentType:'Consultation'});expect(availability.slots.length).toBeGreaterThan(0);
  const booking=await call('appointments/propose',input);expect(booking.proposal.readback).toContain('Say yes to book');expect(creates).toBe(0);
  const colleague={...actor,userId:crypto.randomUUID()};await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'manager')").bind(actor.tenantId,colleague.userId).run();
  await expect(call('appointments/confirm',{id:booking.proposal.id,confirm:true},colleague)).rejects.toMatchObject({code:'appointment_unavailable'});
  await expect(call('appointments/confirm',{id:booking.proposal.id,confirm:false})).rejects.toThrow();expect(creates).toBe(0);
  expect((await call('appointments/confirm',{id:booking.proposal.id,confirm:true})).result.status).toBe('applied');
  expect((await call('appointments/confirm',{id:booking.proposal.id,confirm:true})).result.status).toBe('applied');expect(creates).toBe(1);
  const movedStart=new Date(start+3600000).toISOString(),movedEnd=new Date(start+5400000).toISOString();
  const change=await call('appointment-changes/propose',{kind:'reschedule',appointmentId:booking.proposal.id,start:movedStart,end:movedEnd});
  expect(change.proposal.readback).toContain('Say yes to reschedule');expect(patches).toBe(0);
  expect((await call('appointment-changes/confirm',{id:change.proposal.id,confirm:true})).result).toMatchObject({status:'applied',kind:'reschedule'});expect(patches).toBe(1);
  const agenda=await call(`agenda?start=${encodeURIComponent(input.start)}&end=${encodeURIComponent(new Date(start+7200000).toISOString())}`);expect(agenda.appointments[0].input.start).toBe(movedStart);
  expect((await call('appointment-changes/reconcile',{id:change.proposal.id})).result.status).toBe('applied');expect(patches).toBe(1);
  const cancellation=await call('appointment-changes/propose',{kind:'cancel',appointmentId:booking.proposal.id});expect(deletes).toBe(0);
  expect((await call('appointment-changes/confirm',{id:cancellation.proposal.id,confirm:true})).result.status).toBe('applied');expect(deletes).toBe(1);
  const cancelled=await call(`agenda?start=${encodeURIComponent(input.start)}&end=${encodeURIComponent(new Date(start+7200000).toISOString())}&status=cancelled`);expect(cancelled.total).toBe(1);
 }finally{network.mockRestore();}
});
