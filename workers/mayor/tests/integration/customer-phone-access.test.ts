import {env as testEnv} from 'cloudflare:workers';
import {it,expect,vi} from 'vitest';
import type {Env,Actor} from '../../src/env';
import {createAuth} from '../../src/auth';
import {encryptCredential} from '../../src/auth/vault';
import {sealPhoneCredential} from '../../src/phone-connections';
import {prepareCustomer,confirmCustomer} from '../../src/customers';
import {prepareCustomerPhoneAccess,confirmCustomerPhoneAccess,phoneCustomer} from '../../src/customer-phone-access';
import {readPhoneAppointments,phoneAppointmentReadback} from '../../src/phone-appointments';
import {confirmSchedulingPolicy} from '../../src/scheduling-policy';
import {selectCalendar} from '../../src/calendars';
import {proposeBooking,confirmBooking,reconcileBooking} from '../../src/appointments';
import {proposeAppointmentChange,confirmAppointmentChange,reconcileAppointmentChange} from '../../src/appointment-changes';
import {proposePhoneAppointmentChange,confirmPhoneAppointmentChange,phoneChangeReadback} from '../../src/phone-appointment-changes';
import {phoneBookingOptions,findPhoneAvailability,proposePhoneBooking,confirmPhoneBooking,phoneBookingReadback} from '../../src/phone-bookings';
import {MayorVoice} from '../../src/voice';
import {MayorPhone} from '../../src/phone-voice';
import {preparePhoneRegistrationPolicy,confirmPhoneRegistrationPolicy} from '../../src/phone-registration-policy';
import {preparePhoneRegistration,confirmPhoneRegistration} from '../../src/phone-registration';
const env={...testEnv,PHONE_TEST_ENABLED:'true'} as unknown as Env;
async function fixture(provider:'google'|'microsoft'='google'){
 const user=await (await createAuth(env).$context).internalAdapter.createUser({email:`${crypto.randomUUID()}@example.test`,name:'Fixture',emailVerified:true});
 const actor:Actor={tenantId:crypto.randomUUID().replaceAll('-',''),userId:user.id},now=new Date().toISOString(),callId=crypto.randomUUID();
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Phone customer fixture',now).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
 const customer=await prepareCustomer(env,actor,{name:'Alex Fixture',phone:'+12025550123',email:'private@example.test'});await confirmCustomer(env,actor,customer);
 const credential={accountSid:'AC'+'1'.repeat(32),apiKeySid:'SK'+'2'.repeat(32),apiKeySecret:'3'.repeat(32),authToken:'4'.repeat(32),testCaller:customer.profile.phone!,verifyServiceSid:'VA'+'5'.repeat(32)};
 const cipher=await sealPhoneCredential(env,actor,'twilio',credential.accountSid,credential);
 await env.AGENT_DB.prepare("INSERT INTO mayor_phone_connections(id,tenant_id,provider,account_id,owner_user_id,ciphertext,status,selected_number,verified_at,updated_at) VALUES(?,?,'twilio',?,?,?,'authorized','+12025550124',?,?)").bind(crypto.randomUUID(),actor.tenantId,credential.accountSid,actor.userId,cipher,now,now).run();
 await env.AGENT_DB.prepare("INSERT INTO mayor_phone_calls(id,tenant_id,account_id,call_sid,connection_revision,state,stream_expires_at,expires_at,created_at,caller_number) VALUES(?,?,?,?,1,'streaming',?,?,?,?)").bind(callId,actor.tenantId,credential.accountSid,crypto.randomUUID(),now,new Date(Date.now()+600000).toISOString(),now,credential.testCaller).run();
 // A seeded verification receipt isolates customer authorization from the
 // separately tested signed webhook / Verify flow. No real SMS is sent.
 await env.AGENT_DB.prepare("INSERT INTO mayor_phone_verifications(call_id,tenant_id,connection_revision,state,nonce,expires_at,created_at) VALUES(?,?,1,'approved',?,?,?)").bind(callId,actor.tenantId,crypto.randomUUID(),new Date(Date.now()+300000).toISOString(),now).run();
 await confirmSchedulingPolicy(env,actor,{timeZone:'UTC',weeklyHours:Array.from({length:7},(_,day)=>({day,startMinute:0,endMinute:1440})),closedDates:[],appointmentTypes:[{name:'Consultation',durationMinutes:30,bufferBeforeMinutes:0,bufferAfterMinutes:0}],staff:[],minimumNoticeMinutes:0,maximumAdvanceDays:30,cancellationNoticeMinutes:0},0);
 const scopes=provider==='google'?['https://www.googleapis.com/auth/calendar']:['Calendars.ReadWrite'],grantId=crypto.randomUUID();
 const ciphertext=await encryptCredential({accountEmail:'fixture@example.test',accessToken:'fixture-token',accessTokenExpiresAt:new Date(Date.now()+3600000).toISOString(),grantedScopes:scopes},{...actor,provider,accountId:grantId},env.TOKEN_ENCRYPTION_KEY!);
 await env.AGENT_DB.prepare("INSERT INTO auth_provider_grants(id,user_id,provider,account_id,tenant_scope,ciphertext,granted_scopes,selected_capabilities,status,updated_at) VALUES(?,?,?,?,?,?,?,?,'authorized',?)").bind(grantId,user.id,provider,grantId,actor.tenantId,ciphertext,JSON.stringify(scopes),'["calendar_manage"]',now).run();
 const events=new Map<string,any>();let reads=0,writes=0,creates=0,loseCreate=false,afterAvailability:(()=>Promise<void>)|undefined,loseWrite=false,afterRead:(()=>Promise<void>)|undefined,altered=false;
 const transport=(async(url:RequestInfo|URL,init?:RequestInit)=>{
  const path=new URL(String(url)).pathname,method=init?.method??'GET';
  if(path.endsWith('/calendarList'))return Response.json({items:[{id:'calendar',summary:'Calendar',accessRole:'owner'}]});
  if(path.endsWith('/calendars'))return Response.json({value:[{id:'calendar',name:'Calendar',canEdit:true}]});
  if(path.endsWith('/freeBusy')){await afterAvailability?.();return Response.json({calendars:{calendar:{busy:[]}}});}
  if(path.endsWith('/calendarView')){await afterAvailability?.();return Response.json({value:[]});}
  if(path.endsWith('/events')&&method==='GET')return Response.json(provider==='google'?{items:[]}:{value:[...events.values()]});
  if(method==='POST'){
   creates++;const body=JSON.parse(String(init?.body)),event=provider==='google'?{...body,etag:'v1',status:'confirmed',organizer:{self:true},eventType:'default'}:{...body,id:crypto.randomUUID(),'@odata.etag':'v1',isOrganizer:true,isCancelled:false,isAllDay:false,type:'singleInstance',showAs:'busy'};
   events.set(event.id,event);if(loseCreate)throw new Error('synthetic_lost_create_response');return Response.json(event);
  }
  if(method==='PATCH'||method==='DELETE'){
   writes++;const id=decodeURIComponent(path.split('/').pop()!),event=events.get(id);expect(event).toBeTruthy();
   expect(new Headers(init?.headers).get('if-match')).toBe(provider==='google'?event.etag:event['@odata.etag']);
   if(method==='DELETE'){events.set(id,provider==='google'?{...event,status:'cancelled'}:{...event,isCancelled:true});if(loseWrite)throw new Error('synthetic_lost_write_response');return new Response(null,{status:204});}
   const body=JSON.parse(String(init?.body));expect(Object.keys(body).sort()).toEqual(['end','start']);const changed={...event,...body,...(provider==='google'?{etag:'v2'}:{'@odata.etag':'v2'})};events.set(id,changed);if(loseWrite)throw new Error('synthetic_lost_write_response');return Response.json(changed);
  }
  expect(method).toBe('GET');reads++;await afterRead?.();const event=events.get(decodeURIComponent(path.split('/').pop()!));
  return event?Response.json(altered?{...event,...(provider==='google'?{status:'cancelled'}:{isCancelled:true})}:event):new Response(null,{status:404});
 }) as typeof fetch;
 await selectCalendar(env,actor,{provider,grantId,calendarId:'calendar'},transport);
 const input={title:'private-title-do-not-speak',appointmentType:'Consultation',start:new Date(Math.ceil((Date.now()+86400000)/60000)*60000).toISOString(),end:new Date(Math.ceil((Date.now()+86400000)/60000)*60000+1800000).toISOString(),attendees:[]};
 const booking=await proposeBooking(env,actor,{...input,customerId:customer.id});await confirmBooking(env,actor,booking.id,transport);
 const grant=async(enabled=true,allowChanges=false,allowBookings=false)=>confirmCustomerPhoneAccess(env,actor,await prepareCustomerPhoneAccess(env,actor,{customerId:customer.id,enabled,allowChanges,allowBookings}));
 return {actor,customer,callId,input,grantId,booking,grant,transport,reads:()=>reads,writes:()=>writes,creates:()=>creates,loseCreate:()=>{loseCreate=true;},afterAvailability:(fn:()=>Promise<void>)=>{afterAvailability=fn;},loseWrite:()=>{loseWrite=true;},afterRead:(fn:()=>Promise<void>)=>{afterRead=fn;},alter:()=>{altered=true;}};
}
it.each(['google','microsoft'] as const)('returns only the permitted customer’s live %s appointment times',async provider=>{
 const f=await fixture(provider);await expect(readPhoneAppointments(env,f.callId,f.transport)).rejects.toThrow();expect(f.reads()).toBe(0);
 await f.grant();const result=await readPhoneAppointments(env,f.callId,f.transport);expect(result.appointments).toEqual([{id:f.booking.id,start:f.input.start,end:f.input.end}]);expect(f.reads()).toBe(1);
 const spoken=phoneAppointmentReadback(result);expect(spoken).toContain('I checked the calendar');
 for(const privateValue of ['private-title','private@example.test','Alex Fixture','+12025550123',f.grantId])expect(JSON.stringify(result)).not.toContain(privateValue);
});
it('rejects shared numbers both before granting access and after a new duplicate is added',async()=>{
 const f=await fixture();await f.grant();await confirmCustomer(env,f.actor,await prepareCustomer(env,f.actor,{name:'Shared Contact',phone:f.customer.profile.phone!}));
 await expect(prepareCustomerPhoneAccess(env,f.actor,{customerId:f.customer.id,enabled:true})).rejects.toThrow();
 await expect(phoneCustomer(env,f.callId)).rejects.toThrow();expect(f.reads()).toBe(0);
 await f.grant(false);
});
it.each(['contact','permission','owner','call','challenge','tenant','connection'] as const)('denies previously granted access after %s changes',async change=>{
 const f=await fixture();await f.grant();
 if(change==='contact')await confirmCustomer(env,f.actor,await prepareCustomer(env,f.actor,{id:f.customer.id,name:'Changed contact'}));
 if(change==='permission')await f.grant(false);
 if(change==='owner')await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=?").bind(f.actor.tenantId).run();
 if(change==='call')await env.AGENT_DB.prepare("UPDATE mayor_phone_calls SET state='ended' WHERE id=?").bind(f.callId).run();
 if(change==='challenge')await env.AGENT_DB.prepare("UPDATE mayor_phone_verifications SET expires_at='2000' WHERE call_id=?").bind(f.callId).run();
 if(change==='tenant')await env.AGENT_DB.prepare("UPDATE agent_tenants SET status='paused' WHERE id=?").bind(f.actor.tenantId).run();
 if(change==='connection')await env.AGENT_DB.prepare('UPDATE mayor_phone_connections SET revision=revision+1 WHERE tenant_id=?').bind(f.actor.tenantId).run();
 await expect(readPhoneAppointments(env,f.callId,f.transport)).rejects.toThrow();expect(f.reads()).toBe(0);
});
it('rejects stale or competing permission confirmations and unauthorized operators',async()=>{
 const f=await fixture(),proposal=await prepareCustomerPhoneAccess(env,f.actor,{customerId:f.customer.id,enabled:true});
 await expect(confirmCustomerPhoneAccess(env,{...f.actor,userId:crypto.randomUUID()},proposal)).rejects.toThrow();
 const results=await Promise.allSettled([confirmCustomerPhoneAccess(env,f.actor,proposal),confirmCustomerPhoneAccess(env,f.actor,proposal)]);expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
 const pending=await prepareCustomerPhoneAccess(env,f.actor,{customerId:f.customer.id,enabled:true});await confirmCustomer(env,f.actor,await prepareCustomer(env,f.actor,{id:f.customer.id,name:'Updated'}));await expect(confirmCustomerPhoneAccess(env,f.actor,pending)).rejects.toThrow();
});
it.each(['customer','calendar'] as const)('discards provider results when %s access is revoked during the read',async changed=>{
 const f=await fixture();await f.grant();f.afterRead(async()=>{if(changed==='customer')await f.grant(false);else await env.AGENT_DB.prepare("UPDATE auth_provider_grants SET status='revoked' WHERE id=?").bind(f.grantId).run();});
 await expect(readPhoneAppointments(env,f.callId,f.transport)).rejects.toThrow();
});
it.each(['google','microsoft'] as const)('rejects externally cancelled %s appointments instead of reading stale times',async provider=>{
 const f=await fixture(provider);await f.grant();f.alter();await expect(readPhoneAppointments(env,f.callId,f.transport)).rejects.toThrow();
});
it('does not return another customer’s appointment or unlinked appointments',async()=>{
 const f=await fixture();await f.grant();const other=await prepareCustomer(env,f.actor,{name:'Other',phone:'+12025550125'});await confirmCustomer(env,f.actor,other);
 await env.AGENT_DB.prepare('UPDATE mayor_appointment_customers SET customer_id=? WHERE booking_id=?').bind(other.id,f.booking.id).run();
 expect((await readPhoneAppointments(env,f.callId,f.transport)).appointments).toEqual([]);expect(f.reads()).toBe(0);
});
it.each(['confirm','interrupt','correction'] as const)('requires a separate spoken permission confirmation (%s)',async mode=>{
 const f=await fixture();let proposal=true;
 const ai={run:async()=>{const events=proposal?[{choices:[{delta:{tool_calls:[{id:'access-1',index:0,type:'function',function:{name:'proposeCustomerPhoneAccess',arguments:JSON.stringify({customerId:f.customer.id,enabled:true})}}]}}]}]:[{choices:[{delta:{tool_calls:[{id:'reply-1',index:0,type:'function',function:{name:'reply',arguments:'{"text":"No permission was changed."}'}}]}}]}];
 const bytes=new TextEncoder().encode(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join('')+'data: [DONE]\n\n');return new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}});}};
 const voice=Object.create(MayorVoice.prototype) as any;for(const field of ['generations','pending','pendingCalendar','pendingPolicy','pendingBooking','pendingChange','pendingCallback','pendingCustomer'])voice[field]=new Map();Object.assign(voice,{env:{...env,AI:ai},ready:new Set(),authorize:async()=>f.actor});
 const connection={id:'permission-fixture',send:()=>{}},signal=new AbortController().signal;
 const turn=async(text:string)=>{const response=await voice.onTurn(text,{connection,signal,messages:[]});if(typeof response==='string')return response;let answer='';for await(const chunk of response)answer+=chunk;return answer;};
 expect(await turn('Allow phone appointment-time access for this customer.')).toContain('not a shared number');await expect(phoneCustomer(env,f.callId)).rejects.toThrow();proposal=false;
 if(mode==='interrupt')voice.onInterrupt(connection);if(mode==='correction')await turn('No, do not allow that.');
 await turn('Yes.');if(mode==='confirm')expect((await phoneCustomer(env,f.callId)).customerId).toBe(f.customer.id);else await expect(phoneCustomer(env,f.callId)).rejects.toThrow();
});
it('checks customer permission again before phone synthesis after a previous lookup',async()=>{
 const f=await fixture();await f.grant();const scope=await phoneCustomer(env,f.callId),phone=Object.create(MayorPhone.prototype) as any,connection={id:'call',close:()=>{}};
 Object.assign(phone,{env,calls:new Map([['call',f.callId]]),customerScopes:new Map([['call',scope]]),forceEndCall:()=>{}});
 expect(await phone.beforeSynthesize('Appointment times',connection)).toBe('Appointment times');await f.grant(false);expect(await phone.beforeSynthesize('Appointment times',connection)).toBeNull();
});
it('rejects another tenant’s customer permission proposal',async()=>{
 const a=await fixture(),b=await fixture();const proposal=await prepareCustomerPhoneAccess(env,a.actor,{customerId:a.customer.id,enabled:true});
 await expect(confirmCustomerPhoneAccess(env,b.actor,proposal)).rejects.toThrow();await expect(prepareCustomerPhoneAccess(env,b.actor,{customerId:a.customer.id,enabled:true})).rejects.toThrow();
});
it.each([true,false])('uses a server phone readback and never speaks raw model appointment claims (allowed=%s)',async allowed=>{
 const f=await fixture();if(allowed)await f.grant();
 const ai={run:async()=>{const events=[{choices:[{delta:{content:'Your appointment has been cancelled.'}}]},{choices:[{delta:{tool_calls:[{id:'lookup-1',index:0,type:'function',function:{name:'readMyAppointmentTimes',arguments:'{}'}}]}}]}];const bytes=new TextEncoder().encode(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join('')+'data: [DONE]\n\n');return new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}});}};
 const phone=Object.create(MayorPhone.prototype) as any;
 Object.assign(phone,{env:{...env,AI:ai},proposals:new Map(),ready:new Set(),generations:new Map(),customerScopes:new Map(),appointmentChoices:new Map(),authorize:async()=>({id:f.callId,tenantId:f.actor.tenantId}),forceEndCall:()=>{}});
 const mock=vi.spyOn(globalThis,'fetch').mockImplementation(f.transport);
 try{
  const response=await phone.onTurn('When is my appointment?',{connection:{id:'lookup'},signal:new AbortController().signal,messages:[]});let spoken='';for await(const chunk of response)spoken+=chunk;
  expect(spoken).toContain(allowed?'I checked the calendar':'cannot securely verify');expect(spoken).not.toContain('has been cancelled');expect(spoken).not.toContain('private-title');expect(phone.ready.size).toBe(0);expect(f.reads()).toBe(allowed?1:0);
 }finally{mock.mockRestore();}
});
it('refuses to announce settled times while an appointment change is running',async()=>{
 const f=await fixture();await f.grant();const change=await proposeAppointmentChange(env,f.actor,{kind:'cancel',appointmentId:f.booking.id},f.transport);
 await env.AGENT_DB.prepare("UPDATE mayor_appointment_changes SET state='running' WHERE id=?").bind(change.id).run();
 const reads=f.reads();await expect(readPhoneAppointments(env,f.callId,f.transport)).rejects.toThrow('Appointment times cannot be verified');expect(f.reads()).toBe(reads);
});
it.each(['google','microsoft'] as const)('confirms call-bound %s cancellation once and audits the caller',async provider=>{
 const f=await fixture(provider);await f.grant(true,true);const proposal=await proposePhoneAppointmentChange(env,f.callId,{kind:'cancel',appointmentId:f.booking.id},f.transport);
 expect(f.writes()).toBe(0);expect(phoneChangeReadback(proposal)).not.toContain('private-title');expect(JSON.stringify(proposal)).not.toContain('private@example.test');
 expect(await confirmPhoneAppointmentChange(env,f.callId,proposal.id,()=>true,f.transport)).toMatchObject({status:'applied',kind:'cancel'});
 expect(await confirmPhoneAppointmentChange(env,f.callId,proposal.id,()=>true,f.transport)).toMatchObject({status:'applied'});expect(f.writes()).toBe(1);
 expect(await env.AGENT_DB.prepare("SELECT actor_id FROM mayor_audit WHERE resource_id=? AND event='appointment.cancel'").bind(proposal.id).first()).toEqual({actor_id:'phone:'+f.callId});
});
it.each(['google','microsoft'] as const)('reschedules through the existing %s executor without exposing appointment metadata',async provider=>{
 const f=await fixture(provider);await f.grant(true,true);
 const start=new Date(Date.parse(f.input.start)+3600000).toISOString(),end=new Date(Date.parse(f.input.end)+3600000).toISOString();
 const proposal=await proposePhoneAppointmentChange(env,f.callId,{kind:'reschedule',appointmentId:f.booking.id,start,end},f.transport);
 expect(f.writes()).toBe(0);expect(await confirmPhoneAppointmentChange(env,f.callId,proposal.id,()=>true,f.transport)).toMatchObject({status:'applied'});expect(f.writes()).toBe(1);
 expect((await readPhoneAppointments(env,f.callId,f.transport)).appointments).toEqual([{id:f.booking.id,start,end}]);
});
it('does not upgrade lookup permission or allow changes to another customer',async()=>{
 const f=await fixture();await f.grant();await expect(proposePhoneAppointmentChange(env,f.callId,{kind:'cancel',appointmentId:f.booking.id},f.transport)).rejects.toThrow('has not allowed');
 await f.grant(true,true);const other=await prepareCustomer(env,f.actor,{name:'Other',phone:'+12025550125'});await confirmCustomer(env,f.actor,other);await env.AGENT_DB.prepare('UPDATE mayor_appointment_customers SET customer_id=? WHERE booking_id=?').bind(other.id,f.booking.id).run();
 await expect(proposePhoneAppointmentChange(env,f.callId,{kind:'cancel',appointmentId:f.booking.id},f.transport)).rejects.toThrow('cannot change');expect(f.writes()).toBe(0);
});
it.each(['permission','call','interruption','contact'] as const)('does not dispatch a calendar write after %s changes during provider reads',async changed=>{
 const f=await fixture();await f.grant(true,true);const proposal=await proposePhoneAppointmentChange(env,f.callId,{kind:'cancel',appointmentId:f.booking.id},f.transport);let valid=true;
 f.afterRead(async()=>{if(changed==='permission')await f.grant(false);if(changed==='call')await env.AGENT_DB.prepare("UPDATE mayor_phone_calls SET state='ended' WHERE id=?").bind(f.callId).run();if(changed==='interruption')valid=false;if(changed==='contact')await confirmCustomer(env,f.actor,await prepareCustomer(env,f.actor,{id:f.customer.id,name:'Changed'}));});
 expect(await confirmPhoneAppointmentChange(env,f.callId,proposal.id,()=>valid,f.transport)).toMatchObject({status:'rejected'});expect(f.writes()).toBe(0);
});
it('enforces caller permission even through the shared confirmation executor',async()=>{
 const f=await fixture();await f.grant(true,true);const proposal=await proposePhoneAppointmentChange(env,f.callId,{kind:'cancel',appointmentId:f.booking.id},f.transport);await f.grant(false);
 await expect(confirmAppointmentChange(env,f.actor,proposal.id,f.transport)).rejects.toThrow();expect(f.writes()).toBe(0);
});
it('does not accept an unbound owner proposal as a phone change',async()=>{
 const f=await fixture();await f.grant(true,true);const proposal=await proposeAppointmentChange(env,f.actor,{kind:'cancel',appointmentId:f.booking.id},f.transport);
 await expect(confirmPhoneAppointmentChange(env,f.callId,proposal.id,()=>true,f.transport)).rejects.toThrow('cannot change');expect(f.writes()).toBe(0);
});
it.each(['google','microsoft'] as const)('reconciles an uncertain %s phone cancellation without repeating the write',async provider=>{
 const f=await fixture(provider);await f.grant(true,true);const proposal=await proposePhoneAppointmentChange(env,f.callId,{kind:'cancel',appointmentId:f.booking.id},f.transport);f.loseWrite();
 expect(await confirmPhoneAppointmentChange(env,f.callId,proposal.id,()=>true,f.transport)).toMatchObject({status:'uncertain'});expect(await confirmPhoneAppointmentChange(env,f.callId,proposal.id,()=>true,f.transport)).toMatchObject({status:'uncertain'});expect(f.writes()).toBe(1);
 expect(await reconcileAppointmentChange(env,f.actor,proposal.id,f.transport)).toMatchObject({status:'applied'});expect(f.writes()).toBe(1);
});
it.each(['confirmed','interrupted','expired','unread','uncertain'] as const)('executes a phone cancellation only after the complete readback and separate confirmation (%s)',async mode=>{
 const f=await fixture();await f.grant(true,true);const lookup=await readPhoneAppointments(env,f.callId,f.transport);
 const ai={run:async()=>{const events=[{choices:[{delta:{content:'I cancelled it already.'}}]},{choices:[{delta:{tool_calls:[{id:'change-1',index:0,type:'function',function:{name:'proposeMyAppointmentChange',arguments:JSON.stringify({kind:'cancel',appointmentId:f.booking.id})}}]}}]}];const bytes=new TextEncoder().encode(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join('')+'data: [DONE]\n\n');return new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}});}};
 const phone=Object.create(MayorPhone.prototype) as any,connection={id:'change-call'};
 Object.assign(phone,{env:{...env,AI:ai},proposals:new Map(),ready:new Set(),generations:new Map(),customerScopes:new Map([[connection.id,lookup.scope]]),appointmentChoices:new Map([[connection.id,lookup]]),authorize:async()=>({id:f.callId,tenantId:f.actor.tenantId}),forceEndCall:()=>{}});
 const mock=vi.spyOn(globalThis,'fetch').mockImplementation(f.transport);
 try{
  const response=await phone.onTurn('Cancel that appointment.',{connection,signal:new AbortController().signal,messages:[]});let readback='';for await(const chunk of response)readback+=chunk;
  expect(readback).toContain('Say yes to cancel');expect(readback).not.toContain('cancelled it already');expect(f.writes()).toBe(0);
  if(mode==='interrupted')phone.onInterrupt(connection);if(mode==='unread')phone.ready.clear();if(mode==='expired')phone.proposals.get(connection.id).expiresAt=0;if(mode==='uncertain')f.loseWrite();
  const answer=await phone.onTurn('Yes.',{connection,signal:new AbortController().signal,messages:[{role:'assistant',content:readback}]});
  expect(answer).toContain(mode==='confirmed'?'Your appointment is cancelled':mode==='uncertain'?'cannot yet verify':'I have not made that change');expect(f.writes()).toBe(mode==='confirmed'||mode==='uncertain'?1:0);
 }finally{mock.mockRestore();}
});
it('does not move a confirmed proposal to a different call for the same customer',async()=>{
 const f=await fixture();await f.grant(true,true);const proposal=await proposePhoneAppointmentChange(env,f.callId,{kind:'cancel',appointmentId:f.booking.id},f.transport),otherCall=crypto.randomUUID();
 await env.AGENT_DB.prepare('INSERT INTO mayor_phone_calls(id,tenant_id,account_id,call_sid,connection_revision,state,stream_expires_at,expires_at,created_at,caller_number) SELECT ?,tenant_id,account_id,?,connection_revision,state,stream_expires_at,expires_at,created_at,caller_number FROM mayor_phone_calls WHERE id=?').bind(otherCall,crypto.randomUUID(),f.callId).run();
 await env.AGENT_DB.prepare('INSERT INTO mayor_phone_verifications(call_id,tenant_id,connection_revision,state,nonce,expires_at,created_at) SELECT ?,tenant_id,connection_revision,state,?,expires_at,created_at FROM mayor_phone_verifications WHERE call_id=?').bind(otherCall,crypto.randomUUID(),f.callId).run();
 await expect(confirmPhoneAppointmentChange(env,otherCall,proposal.id,()=>true,f.transport)).rejects.toThrow('cannot change');expect(f.writes()).toBe(0);
});
function newPhoneSlot(f:Awaited<ReturnType<typeof fixture>>){return {appointmentType:'Consultation',start:new Date(Date.parse(f.input.start)+3600000).toISOString(),end:new Date(Date.parse(f.input.end)+3600000).toISOString()};}
it.each(['google','microsoft'] as const)('allows a newly registered caller to book, move and cancel only their own %s appointment',async provider=>{
 const f=await fixture(provider);
 await confirmCustomer(env,f.actor,await prepareCustomer(env,f.actor,{id:f.customer.id,phone:'+12025550129'}));
 await confirmPhoneRegistrationPolicy(env,f.actor,await preparePhoneRegistrationPolicy(env,f.actor,{enabled:true}));
 const registered=await confirmPhoneRegistration(env,f.callId,await preparePhoneRegistration(env,f.callId,{name:'New Caller'}),()=>true);
 expect((await readPhoneAppointments(env,f.callId,f.transport)).appointments).toEqual([]);
 await expect(proposePhoneAppointmentChange(env,f.callId,{kind:'cancel',appointmentId:f.booking.id},f.transport)).rejects.toThrow();
 expect((await phoneBookingOptions(env,f.callId)).appointmentTypes).toHaveLength(1);
 const booking=await proposePhoneBooking(env,f.callId,newPhoneSlot(f));
 expect(await confirmPhoneBooking(env,f.callId,booking.id,()=>true,f.transport)).toEqual({status:'applied'});
 expect(await env.AGENT_DB.prepare('SELECT customer_id FROM mayor_appointment_customers WHERE booking_id=?').bind(booking.id).first()).toEqual({customer_id:registered.customerId});
 const start=new Date(Date.parse(f.input.start)+7200000).toISOString(),end=new Date(Date.parse(f.input.end)+7200000).toISOString();
 const move=await proposePhoneAppointmentChange(env,f.callId,{kind:'reschedule',appointmentId:booking.id,start,end},f.transport);
 expect(await confirmPhoneAppointmentChange(env,f.callId,move.id,()=>true,f.transport)).toMatchObject({status:'applied'});
 const cancel=await proposePhoneAppointmentChange(env,f.callId,{kind:'cancel',appointmentId:booking.id},f.transport);
 expect(await confirmPhoneAppointmentChange(env,f.callId,cancel.id,()=>true,f.transport)).toMatchObject({status:'applied'});
 expect(f.creates()).toBe(2);expect(f.writes()).toBe(2);
});
it.each(['google','microsoft'] as const)('finds live %s options and books only for the verified customer after confirmation',async provider=>{
 const f=await fixture(provider);await f.grant(true,false,true);
 expect((await phoneBookingOptions(env,f.callId)).appointmentTypes).toEqual([{name:'Consultation',durationMinutes:30}]);
 const availability=await findPhoneAvailability(env,f.callId,{start:f.input.start,end:new Date(Date.parse(f.input.end)+7200000).toISOString(),appointmentType:'Consultation',limit:10},f.transport);
 expect(availability.slots).toHaveLength(3);expect(availability.slots.every(slot=>Date.parse(slot.start)>=Date.parse(f.input.end))).toBe(true);
 const proposal=await proposePhoneBooking(env,f.callId,newPhoneSlot(f));expect(f.creates()).toBe(1);
 expect(phoneBookingReadback(proposal)).toContain('Say yes to book');expect(JSON.stringify(proposal)).not.toContain('private@example.test');
 const stored=await env.AGENT_DB.prepare('SELECT input_json FROM mayor_appointment_jobs WHERE id=?').bind(proposal.id).first<{input_json:string}>();expect(JSON.parse(stored!.input_json)).toMatchObject({title:'Appointment',attendees:[]});
 expect(await confirmPhoneBooking(env,f.callId,proposal.id,()=>true,f.transport)).toEqual({status:'applied'});expect(await confirmPhoneBooking(env,f.callId,proposal.id,()=>true,f.transport)).toEqual({status:'applied'});expect(f.creates()).toBe(2);
 expect(await env.AGENT_DB.prepare('SELECT customer_id FROM mayor_appointment_customers WHERE booking_id=?').bind(proposal.id).first()).toEqual({customer_id:f.customer.id});
 expect(await env.AGENT_DB.prepare("SELECT actor_id FROM mayor_audit WHERE resource_id=? AND event='appointment.booked'").bind(proposal.id).first()).toEqual({actor_id:'phone:'+f.callId});
});
it('does not silently grant booking permission with lookup or change permission',async()=>{
 const f=await fixture();await f.grant(true,true);await expect(phoneBookingOptions(env,f.callId)).rejects.toThrow('booking is unavailable');await expect(proposePhoneBooking(env,f.callId,newPhoneSlot(f))).rejects.toThrow();expect(f.creates()).toBe(1);
});
it('preserves omitted permissions for unchanged contacts but never carries them across a contact correction',async()=>{
 const f=await fixture();await f.grant(true,true);
 await confirmCustomerPhoneAccess(env,f.actor,await prepareCustomerPhoneAccess(env,f.actor,{customerId:f.customer.id,enabled:true,allowBookings:true}));expect(await phoneCustomer(env,f.callId)).toMatchObject({allowChanges:true,allowBookings:true});
 await confirmCustomer(env,f.actor,await prepareCustomer(env,f.actor,{id:f.customer.id,name:'Corrected'}));
 await confirmCustomerPhoneAccess(env,f.actor,await prepareCustomerPhoneAccess(env,f.actor,{customerId:f.customer.id,enabled:true}));expect(await phoneCustomer(env,f.callId)).toMatchObject({allowChanges:false,allowBookings:false});
});
it.each(['permission','call','contact','interruption'] as const)('does not create an event after %s changes during final availability checking',async changed=>{
 const f=await fixture();await f.grant(true,false,true);const proposal=await proposePhoneBooking(env,f.callId,newPhoneSlot(f));let valid=true;
 f.afterAvailability(async()=>{if(changed==='permission')await f.grant(false);if(changed==='call')await env.AGENT_DB.prepare("UPDATE mayor_phone_calls SET state='ended' WHERE id=?").bind(f.callId).run();if(changed==='contact')await confirmCustomer(env,f.actor,await prepareCustomer(env,f.actor,{id:f.customer.id,name:'Changed'}));if(changed==='interruption')valid=false;});
 expect(await confirmPhoneBooking(env,f.callId,proposal.id,()=>valid,f.transport)).toEqual({status:'rejected'});expect(f.creates()).toBe(1);
});
it('checks persisted phone booking permission through the shared executor and rejects extra customer data',async()=>{
 const f=await fixture();await f.grant(true,false,true);
 await expect(proposePhoneBooking(env,f.callId,{...newPhoneSlot(f),customerId:crypto.randomUUID()} as any)).rejects.toThrow();await expect(proposePhoneBooking(env,f.callId,{...newPhoneSlot(f),attendees:['other@example.test']} as any)).rejects.toThrow();
 const proposal=await proposePhoneBooking(env,f.callId,newPhoneSlot(f));await f.grant(false);await expect(confirmBooking(env,f.actor,proposal.id,f.transport)).rejects.toThrow();expect(f.creates()).toBe(1);
});
it('does not allow two concurrent phone bookings to claim the same slot',async()=>{
 const f=await fixture();await f.grant(true,false,true);const a=await proposePhoneBooking(env,f.callId,newPhoneSlot(f)),b=await proposePhoneBooking(env,f.callId,newPhoneSlot(f));
 const results=await Promise.allSettled([confirmPhoneBooking(env,f.callId,a.id,()=>true,f.transport),confirmPhoneBooking(env,f.callId,b.id,()=>true,f.transport)]);
 expect(results.filter(result=>result.status==='fulfilled'&&result.value.status==='applied')).toHaveLength(1);expect(f.creates()).toBe(2);
});
it.each(['google','microsoft'] as const)('reconciles an uncertain %s phone booking without a second create',async provider=>{
 const f=await fixture(provider);await f.grant(true,false,true);const proposal=await proposePhoneBooking(env,f.callId,newPhoneSlot(f));f.loseCreate();
 expect(await confirmPhoneBooking(env,f.callId,proposal.id,()=>true,f.transport)).toEqual({status:'uncertain'});expect(await confirmPhoneBooking(env,f.callId,proposal.id,()=>true,f.transport)).toEqual({status:'uncertain'});
 expect(await reconcileBooking(env,f.actor,proposal.id,f.transport)).toEqual({status:'applied'});expect(f.creates()).toBe(2);
});
it.each(['confirmed','interrupted','expired','unread','uncertain','stale_options'] as const)('requires a live offered option and separate phone booking confirmation (%s)',async mode=>{
 const f=await fixture();await f.grant(true,false,true);let phase:'options'|'find'|'propose'='options';const slot=newPhoneSlot(f);
 const ai={run:async()=>{const name=phase==='options'?'getBookingOptions':phase==='find'?'findMyBookingSlots':'proposeMyBooking';const args=phase==='options'?{}:phase==='find'?{start:slot.start,end:new Date(Date.parse(slot.end)+3600000).toISOString(),appointmentType:'Consultation',limit:3}:{option:1};
 const events=[{choices:[{delta:{content:'Your booking is already confirmed.'}}]},{choices:[{delta:{tool_calls:[{id:'booking-1',index:0,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]}];const bytes=new TextEncoder().encode(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join('')+'data: [DONE]\n\n');return new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}});}};
 const phone=Object.create(MayorPhone.prototype) as any,connection={id:'booking-call'};
 Object.assign(phone,{env:{...env,AI:ai},proposals:new Map(),ready:new Set(),generations:new Map(),customerScopes:new Map(),appointmentChoices:new Map(),bookingChoices:new Map(),authorize:async()=>({id:f.callId,tenantId:f.actor.tenantId}),forceEndCall:()=>{}});
 const turn=async(text:string,messages:any[]=[])=>{const response=await phone.onTurn(text,{connection,signal:new AbortController().signal,messages});if(typeof response==='string')return response;let answer='';for await(const chunk of response)answer+=chunk;return answer;};
 const mock=vi.spyOn(globalThis,'fetch').mockImplementation(f.transport);
 try{
  expect(await turn('What can I book?')).toContain('Consultation');phase='find';const openings=await turn('Find consultation openings.');expect(openings).toContain('Option 1');expect(openings).not.toContain('already confirmed');expect(f.creates()).toBe(1);
  if(mode==='stale_options')phone.bookingChoices.get(connection.id).availability.checkedAt='2000-01-01T00:00:00Z';phase='propose';const readback=await turn('The first option.');
  if(mode==='stale_options'){expect(readback).toContain('could not prepare');expect(phone.proposals.size).toBe(0);return;}
  expect(readback).toContain('Say yes to book');expect(f.creates()).toBe(1);
  if(mode==='interrupted')phone.onInterrupt(connection);if(mode==='expired')phone.proposals.get(connection.id).expiresAt=0;if(mode==='unread')phone.ready.clear();if(mode==='uncertain')f.loseCreate();
  const answer=await turn('Yes.',[{role:'assistant',content:readback}]);expect(answer).toContain(mode==='confirmed'?'Your appointment is booked':mode==='uncertain'?'cannot yet verify':'I have not made that change');expect(f.creates()).toBe(mode==='confirmed'||mode==='uncertain'?2:1);
 }finally{mock.mockRestore();}
});
it('rejects another call and an unbound owner request at phone booking confirmation',async()=>{
 const f=await fixture();await f.grant(true,false,true);const proposal=await proposePhoneBooking(env,f.callId,newPhoneSlot(f)),otherCall=crypto.randomUUID();
 await env.AGENT_DB.prepare('INSERT INTO mayor_phone_calls(id,tenant_id,account_id,call_sid,connection_revision,state,stream_expires_at,expires_at,created_at,caller_number) SELECT ?,tenant_id,account_id,?,connection_revision,state,stream_expires_at,expires_at,created_at,caller_number FROM mayor_phone_calls WHERE id=?').bind(otherCall,crypto.randomUUID(),f.callId).run();
 await env.AGENT_DB.prepare('INSERT INTO mayor_phone_verifications(call_id,tenant_id,connection_revision,state,nonce,expires_at,created_at) SELECT ?,tenant_id,connection_revision,state,?,expires_at,created_at FROM mayor_phone_verifications WHERE call_id=?').bind(otherCall,crypto.randomUUID(),f.callId).run();
 await expect(confirmPhoneBooking(env,otherCall,proposal.id,()=>true,f.transport)).rejects.toThrow('cannot confirm');
 const ownerProposal=await proposeBooking(env,f.actor,{...newPhoneSlot(f),title:'Owner request',attendees:[],customerId:f.customer.id});await expect(confirmPhoneBooking(env,f.callId,ownerProposal.id,()=>true,f.transport)).rejects.toThrow('cannot confirm');expect(f.creates()).toBe(1);
});
