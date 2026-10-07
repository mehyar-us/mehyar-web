import {env as testEnv} from 'cloudflare:workers';
import {describe,it,expect} from 'vitest';
import type {Env,Actor} from '../../src/env';
import {createAuth} from '../../src/auth';
import {encryptCredential} from '../../src/auth/vault';
import {selectCalendar} from '../../src/calendars';
import {confirmSchedulingPolicy} from '../../src/scheduling-policy';
import {proposeBooking,confirmBooking,listBookingRequests} from '../../src/appointments';
import {proposeAppointmentChange,confirmAppointmentChange,listAppointments,reconcileAppointmentChange} from '../../src/appointment-changes';
import {prepareCustomer,confirmCustomer} from '../../src/customers';
import {bookingReadback,changeReadback} from '../../src/confirmation';
const env=testEnv as unknown as Env;
async function fixture(provider:'google'|'microsoft',linkCustomer=false){
 const user=await (await createAuth(env).$context).internalAdapter.createUser({email:`${crypto.randomUUID()}@example.test`,name:'Fixture',emailVerified:true});
 const actor:Actor={tenantId:crypto.randomUUID().replaceAll('-',''),userId:user.id};
 await env.AGENT_DB.batch([
  env.AGENT_DB.prepare("INSERT INTO agent_tenants(id,name,status,created_at) VALUES(?,'Fixture','active',?)").bind(actor.tenantId,new Date().toISOString()),
  env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role,status) VALUES(?,?,'owner','active')").bind(actor.tenantId,actor.userId),
 ]);
 await confirmSchedulingPolicy(env,actor,{timeZone:'UTC',weeklyHours:Array.from({length:7},(_,day)=>({day,startMinute:0,endMinute:1440})),closedDates:[],appointmentTypes:[{name:'Consultation',durationMinutes:30,bufferBeforeMinutes:10,bufferAfterMinutes:10}],staff:[],minimumNoticeMinutes:0,maximumAdvanceDays:30,cancellationNoticeMinutes:0},0);
 const scopes=provider==='google'?['https://www.googleapis.com/auth/calendar']:['Calendars.ReadWrite'],grantId=crypto.randomUUID();
 const ciphertext=await encryptCredential({accountEmail:'fixture@example.test',accessToken:'fixture-token',accessTokenExpiresAt:new Date(Date.now()+3600000).toISOString(),grantedScopes:scopes},{...actor,provider,accountId:grantId},env.TOKEN_ENCRYPTION_KEY!);
 await env.AGENT_DB.prepare(`INSERT INTO auth_provider_grants(id,user_id,provider,account_id,tenant_scope,ciphertext,granted_scopes,selected_capabilities,status,updated_at) VALUES(?,?,?,?,?,?,?,?,'authorized',?)`).bind(grantId,user.id,provider,grantId,actor.tenantId,ciphertext,JSON.stringify(scopes),'["calendar_manage"]',new Date().toISOString()).run();
 const customer=linkCustomer?await prepareCustomer(env,actor,{name:'Alex Customer',phone:'+12025550102',email:'alex@example.test'}):null;
 if(customer)await confirmCustomer(env,actor,customer);
 let event:any=null,patches=0,deletes=0,creates=0,lost=false,busy=false;
 const transport=(async(url:RequestInfo|URL,init?:RequestInit)=>{
  const path=new URL(String(url)).pathname,method=init?.method??'GET';
  if(path.endsWith('/calendarList'))return Response.json({items:[{id:'calendar',summary:'Calendar',accessRole:'owner'}]});
  if(path.endsWith('/calendars'))return Response.json({value:[{id:'calendar',name:'Calendar',canEdit:true}]});
  if(path.endsWith('/freeBusy'))return Response.json({calendars:{calendar:{busy:[]}}});
  if(path.endsWith('/calendarView')||path.endsWith('/events')&&method==='GET'){
   const items=event?[event]:[];
   if(busy)items.push(provider==='google'?{...event,id:'other',start:{dateTime:new Date(start+1800000).toISOString()},end:{dateTime:new Date(start+2400000).toISOString()}}:{...event,id:'other',start:{dateTime:new Date(start+1800000).toISOString().replace('Z',''),timeZone:'UTC'},end:{dateTime:new Date(start+2400000).toISOString().replace('Z',''),timeZone:'UTC'}});
   return Response.json(provider==='google'?{items}:{value:items});
  }
  if(method==='POST'){
   creates++;
   const body=JSON.parse(String(init?.body));
   if(customer){expect(JSON.stringify(body)).not.toContain(customer.id);expect(JSON.stringify(body)).not.toContain('+12025550102');expect(body.attendees).toEqual([]);}
   event=provider==='google'?{...body,etag:'v1',status:'confirmed',organizer:{self:true},eventType:'default'}:{...body,id:crypto.randomUUID(),'@odata.etag':'v1',isOrganizer:true,isCancelled:false,isAllDay:false,type:'singleInstance',showAs:'busy'};
   return Response.json(event);
  }
  if(method==='PATCH'){
   patches++;if(lost)throw new Error('synthetic_lost_response');
   expect((init?.headers as Record<string,string>)['if-match']).toBe(provider==='google'?event.etag:event['@odata.etag']);
   const body=JSON.parse(String(init?.body));expect(Object.keys(body).sort()).toEqual(['end','start']);
   event={...event,...body,...(provider==='google'?{etag:'v2'}:{'@odata.etag':'v2'})};return Response.json(event);
  }
  if(method==='DELETE'){deletes++;if(lost)throw new Error('synthetic_lost_response');event=null;return new Response(null,{status:204});}
  return event?Response.json(event):new Response(null,{status:404});
 }) as typeof fetch;
 const start=Math.ceil((Date.now()+86400000)/60000)*60000;
 const input={title:'Fixture visit',appointmentType:'Consultation',start:new Date(start).toISOString(),end:new Date(start+1800000).toISOString(),attendees:[]};
 await selectCalendar(env,actor,{provider,grantId,calendarId:'calendar'},transport);
 const booking=await proposeBooking(env,actor,{...input,...(customer?{customerId:customer.id}:{})});expect((await confirmBooking(env,actor,booking.id,transport)).status).toBe('applied');
 return {actor,transport,input,id:booking.id,start,customer,booking,counts:()=>({patches,deletes,creates}),lose:()=>{lost=true;},busy:()=>{busy=true;},
  missing:()=>{const old=event;event=null;return ()=>{event=old;};},
  cancelEvidence:()=>{event=provider==='google'?{id:event.id,status:'cancelled'}:{id:event.id,isCancelled:true};},
  moveEvidence:(start:string,end:string)=>{event={...event,...(provider==='google'?{start:{dateTime:start},end:{dateTime:end},etag:'recovered'}:{start:{dateTime:start.replace('Z',''),timeZone:'UTC'},end:{dateTime:end.replace('Z',''),timeZone:'UTC'},'@odata.etag':'recovered'})};},
  changeEtag:()=>{if(provider==='google')event.etag='external';else event['@odata.etag']='external';}};
}
describe.each(['google','microsoft'] as const)('%s appointment changes',provider=>{
 it.each(['revoked','downgraded'] as const)('discards appointment lists after access is %s during the database read',async mode=>{
  for(const read of [listAppointments,listBookingRequests]){
   const f=await fixture(provider,true);let intercepted=false;
   const guarded={...env,AGENT_DB:{prepare:(sql:string)=>{
    const statement=env.AGENT_DB.prepare(sql);
    if(!sql.startsWith('SELECT a.id,a.input_json')&&!sql.startsWith('SELECT j.id,'))return statement;
    return {bind:(...values:unknown[])=>({all:async()=>{
     const rows=await statement.bind(...values).all();expect(rows.results.length).toBeGreaterThan(0);intercepted=true;
     await env.AGENT_DB.prepare(mode==='revoked'?"UPDATE agent_memberships SET status='revoked' WHERE tenant_id=?":"UPDATE agent_memberships SET role='viewer' WHERE tenant_id=?").bind(f.actor.tenantId).run();return rows;
    }})};
   }}} as unknown as Env;
   await expect(read(guarded,f.actor)).rejects.toThrow();expect(intercepted).toBe(true);
  }
 });

 it('keeps the customer link through rescheduling and cancellation without adding invitees',async()=>{
  const f=await fixture(provider,true);
  expect(bookingReadback(f.booking)).toContain('Linked customer: Alex Customer');
  expect(bookingReadback(f.booking)).toContain('does not add an invitee');
  expect((await listAppointments(env,f.actor,f.customer!.id))[0].customer).toEqual({id:f.customer!.id,name:'Alex Customer',identityVerified:false});
  const another=await prepareCustomer(env,f.actor,{name:'Other Customer',phone:'+12025550103'});await confirmCustomer(env,f.actor,another);
  expect(await listAppointments(env,f.actor,another.id)).toEqual([]);
  const change=await proposeAppointmentChange(env,f.actor,{kind:'reschedule',appointmentId:f.id,start:new Date(f.start+3600000).toISOString(),end:new Date(f.start+5400000).toISOString()},f.transport);
  expect(changeReadback(change)).toContain('Linked customer: Alex Customer');
  expect((await confirmAppointmentChange(env,f.actor,change.id,f.transport)).status).toBe('applied');
  const cancel=await proposeAppointmentChange(env,f.actor,{kind:'cancel',appointmentId:f.id},f.transport);
  expect((await confirmAppointmentChange(env,f.actor,cancel.id,f.transport)).status).toBe('applied');
  expect((await listAppointments(env,f.actor,f.customer!.id))[0]).toMatchObject({status:'cancelled',customer:{id:f.customer!.id}});
 });
 it('rejects customer edits after a booking or change readback before dispatch',async()=>{
  const f=await fixture(provider,true);
  const booking=await proposeBooking(env,f.actor,{...f.input,start:new Date(f.start+7200000).toISOString(),end:new Date(f.start+9000000).toISOString(),customerId:f.customer!.id});
  const cancel=await proposeAppointmentChange(env,f.actor,{kind:'cancel',appointmentId:f.id},f.transport);
  await confirmCustomer(env,f.actor,await prepareCustomer(env,f.actor,{id:f.customer!.id,phone:'+12025550103'}));
  await expect(confirmBooking(env,f.actor,booking.id,f.transport)).rejects.toThrow('customer contact changed');
  await expect(confirmAppointmentChange(env,f.actor,cancel.id,f.transport)).rejects.toThrow('customer contact changed');
  expect(f.counts()).toEqual({creates:1,patches:0,deletes:0});
  // A fresh review uses the new revision; old bookings are not permanently locked.
  const fresh=await proposeAppointmentChange(env,f.actor,{kind:'cancel',appointmentId:f.id},f.transport);
  expect((await confirmAppointmentChange(env,f.actor,fresh.id,f.transport)).status).toBe('applied');
 });
 it('rechecks the customer after provider reads and before calendar mutation',async()=>{
  const f=await fixture(provider,true);
  const booking=await proposeBooking(env,f.actor,{...f.input,start:new Date(f.start+7200000).toISOString(),end:new Date(f.start+9000000).toISOString(),customerId:f.customer!.id});
  let changed=false;
  const duringRead=(async(url:RequestInfo|URL,init?:RequestInit)=>{
   const response=await f.transport(url,init);
   if(!changed){changed=true;await confirmCustomer(env,f.actor,await prepareCustomer(env,f.actor,{id:f.customer!.id,name:'Alex Corrected'}));}
   return response;
  }) as typeof fetch;
  expect((await confirmBooking(env,f.actor,booking.id,duringRead)).status).toBe('rejected');expect(f.counts().creates).toBe(1);
  const cancel=await proposeAppointmentChange(env,f.actor,{kind:'cancel',appointmentId:f.id},f.transport);changed=false;
  expect((await confirmAppointmentChange(env,f.actor,cancel.id,duringRead)).status).toBe('rejected');expect(f.counts().deletes).toBe(0);
 });
 it('enforces tenant boundaries in both application lookup and database links',async()=>{
  const f=await fixture(provider,true),other=await fixture(provider,true);
  await expect(proposeBooking(env,f.actor,{...f.input,customerId:other.customer!.id})).rejects.toThrow('not available');
  await expect(listAppointments(env,f.actor,other.customer!.id)).rejects.toThrow('not available');
  const unlinked=await proposeBooking(env,f.actor,f.input);
  await expect(env.AGENT_DB.prepare('INSERT INTO mayor_appointment_customers(booking_id,tenant_id,customer_id,customer_revision) VALUES(?,?,?,1)').bind(unlinked.id,f.actor.tenantId,other.customer!.id).run()).rejects.toThrow('FOREIGN KEY');
 });
 it('reconciles a committed reschedule after response loss without dispatching it again',async()=>{
  const f=await fixture(provider),start=new Date(f.start+3600000).toISOString(),end=new Date(f.start+5400000).toISOString();
  const proposal=await proposeAppointmentChange(env,f.actor,{kind:'reschedule',appointmentId:f.id,start,end},f.transport);
  const lostAfterCommit=(async(url:RequestInfo|URL,init?:RequestInit)=>{
   const response=await f.transport(url,init);if(init?.method==='PATCH')throw new Error('synthetic_response_lost_after_commit');return response;
  }) as typeof fetch;
  expect((await confirmAppointmentChange(env,f.actor,proposal.id,lostAfterCommit)).status).toBe('uncertain');
  expect((await confirmAppointmentChange(env,f.actor,proposal.id,lostAfterCommit)).status).toBe('uncertain');
  expect(f.counts().patches).toBe(1);
  expect((await reconcileAppointmentChange(env,f.actor,proposal.id,f.transport)).status).toBe('applied');
  expect((await reconcileAppointmentChange(env,f.actor,proposal.id,f.transport)).status).toBe('applied');
  expect(f.counts().patches).toBe(1);expect((await listAppointments(env,f.actor))[0].input.start).toBe(start);
  expect((await env.AGENT_DB.prepare('SELECT count(*) AS n FROM mayor_audit WHERE resource_id=?').bind(proposal.id).first<{n:number}>())?.n).toBe(1);
 });
 it('recovers only matching reschedule or explicit cancellation evidence without another write',async()=>{
  const f=await fixture(provider),start=new Date(f.start+3600000).toISOString(),end=new Date(f.start+5400000).toISOString();
  const change=await proposeAppointmentChange(env,f.actor,{kind:'reschedule',appointmentId:f.id,start,end},f.transport);f.lose();
  expect((await confirmAppointmentChange(env,f.actor,change.id,f.transport)).status).toBe('uncertain');
  expect((await reconcileAppointmentChange(env,f.actor,change.id,f.transport)).status).toBe('uncertain');
  f.moveEvidence(start,end);
  const results=await Promise.all([reconcileAppointmentChange(env,f.actor,change.id,f.transport),reconcileAppointmentChange(env,f.actor,change.id,f.transport)]);
  expect(results.every(r=>r.status==='applied')).toBe(true);expect(f.counts().patches).toBe(1);
  expect((await env.AGENT_DB.prepare('SELECT count(*) AS n FROM mayor_audit WHERE resource_id=?').bind(change.id).first<{n:number}>())?.n).toBe(1);
  const cancel=await proposeAppointmentChange(env,f.actor,{kind:'cancel',appointmentId:f.id},f.transport);
  expect((await confirmAppointmentChange(env,f.actor,cancel.id,f.transport)).status).toBe('uncertain');
  const restore=f.missing();expect((await reconcileAppointmentChange(env,f.actor,cancel.id,f.transport)).status).toBe('uncertain');restore();
  f.cancelEvidence();expect((await reconcileAppointmentChange(env,f.actor,cancel.id,f.transport)).status).toBe('applied');expect(f.counts().deletes).toBe(1);
  expect((await listAppointments(env,f.actor))[0].status).toBe('cancelled');
 });
 it('reschedules an overlapping original time once and cancels with reservation release',async()=>{
  const f=await fixture(provider);
  const moved={kind:'reschedule' as const,appointmentId:f.id,start:new Date(f.start+900000).toISOString(),end:new Date(f.start+2700000).toISOString()};
  const proposal=await proposeAppointmentChange(env,f.actor,moved,f.transport);
  expect((await confirmAppointmentChange(env,f.actor,proposal.id,f.transport)).status).toBe('applied');
  expect((await confirmAppointmentChange(env,f.actor,proposal.id,f.transport)).status).toBe('applied');expect(f.counts().patches).toBe(1);
  expect((await listAppointments(env,f.actor))[0].input.start).toBe(moved.start);
  const cancel=await proposeAppointmentChange(env,f.actor,{kind:'cancel',appointmentId:f.id},f.transport);
  const secondCancel=await proposeAppointmentChange(env,f.actor,{kind:'cancel',appointmentId:f.id},f.transport);
  const outcomes=await Promise.allSettled([confirmAppointmentChange(env,f.actor,cancel.id,f.transport),confirmAppointmentChange(env,f.actor,secondCancel.id,f.transport)]);
  expect(outcomes.filter(r=>r.status==='fulfilled'&&r.value.status==='applied')).toHaveLength(1);expect(f.counts().deletes).toBe(1);
  expect((await listAppointments(env,f.actor))[0].status).toBe('cancelled');
  const replacement=await proposeBooking(env,f.actor,{...f.input,start:moved.start,end:moved.end});expect((await confirmBooking(env,f.actor,replacement.id,f.transport)).status).toBe('applied');
 });
 it('rejects stale provider versions and cross-tenant requests before writing',async()=>{
  const f=await fixture(provider);
  await expect(proposeAppointmentChange(env,{...f.actor,tenantId:'other'},{kind:'cancel',appointmentId:f.id},f.transport)).rejects.toThrow();
  const cancel=await proposeAppointmentChange(env,f.actor,{kind:'cancel',appointmentId:f.id},f.transport);f.changeEtag();
  expect((await confirmAppointmentChange(env,f.actor,cancel.id,f.transport)).status).toBe('rejected');expect(f.counts().deletes).toBe(0);
 });
 it('blocks busy destination buffers and preserves reservations after a lost change',async()=>{
  const f=await fixture(provider);
  const moved={kind:'reschedule' as const,appointmentId:f.id,start:new Date(f.start+2400000).toISOString(),end:new Date(f.start+4200000).toISOString()};
  const proposal=await proposeAppointmentChange(env,f.actor,moved,f.transport);f.lose();
  expect((await confirmAppointmentChange(env,f.actor,proposal.id,f.transport)).status).toBe('uncertain');expect(f.counts().patches).toBe(1);
  const other=await proposeBooking(env,f.actor,{...f.input,start:moved.start,end:moved.end});await expect(confirmBooking(env,f.actor,other.id,f.transport)).rejects.toThrow();
  const cancel=await proposeAppointmentChange(env,f.actor,{kind:'cancel',appointmentId:f.id},f.transport);await expect(confirmAppointmentChange(env,f.actor,cancel.id,f.transport)).rejects.toThrow();expect(f.counts().deletes).toBe(0);
  const g=await fixture(provider);g.busy();
  const blocked=await proposeAppointmentChange(env,g.actor,{...moved,appointmentId:g.id,start:new Date(g.start+2400000).toISOString(),end:new Date(g.start+4200000).toISOString()},g.transport);
  expect((await confirmAppointmentChange(env,g.actor,blocked.id,g.transport)).status).toBe('rejected');expect(g.counts().patches).toBe(0);
 });
});
