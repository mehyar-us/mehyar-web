import {env as testEnv} from 'cloudflare:workers';
import {it,expect} from 'vitest';
import type {Env} from '../../src/env';
import {createAuth} from '../../src/auth';
import {storeProviderGrant} from '../../src/auth/vault';
import {selectCalendar} from '../../src/calendars';
import {confirmSchedulingPolicy} from '../../src/scheduling-policy';
import {proposeBooking,confirmBooking,reconcileBooking} from '../../src/appointments';
import {proposeAppointmentChange,confirmAppointmentChange} from '../../src/appointment-changes';
async function fixture(){
 const env=testEnv as unknown as Env,user=await(await createAuth(env).$context).internalAdapter.createUser({email:crypto.randomUUID()+'@example.test',name:'Fixture',emailVerified:true});
 const actor={userId:user.id,tenantId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Zoho fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,user.id).run();
 const grantId=await storeProviderGrant(env,{...actor,provider:'zoho',accountId:'us:fixture'}, {accountEmail:'fixture@example.test',accessToken:'synthetic',refreshToken:'synthetic-refresh',accessTokenExpiresAt:new Date(Date.now()+3600000).toISOString(),grantedScopes:['ZohoCalendar.calendar.READ','ZohoCalendar.event.ALL'],zohoRegion:'us'},['calendar_manage']);
 await confirmSchedulingPolicy(env,actor,{timeZone:'UTC',weeklyHours:Array.from({length:7},(_,day)=>({day,startMinute:0,endMinute:1440})),closedDates:[],appointmentTypes:[{name:'Visit',durationMinutes:30,bufferBeforeMinutes:0,bufferAfterMinutes:0}],staff:[],minimumNoticeMinutes:0,maximumAdvanceDays:30,cancellationNoticeMinutes:0},0);
 let event:any=null,creates=0,updates=0,deletes=0,lose=false;
 const transport=(async(url:any,init:any)=>{
  expect(new URL(url).origin).toBe('https://calendar.zoho.com');
  const path=new URL(url).pathname;
  if(path.endsWith('/calendars'))return Response.json({calendars:[{uid:'calendar',name:'Appointments',privilege:'owner',timezone:'UTC'}]});
  if(init.method==='POST'){
   creates++;event={...JSON.parse(new URLSearchParams(init.body).get('eventdata')!),uid:'event@zoho.com',caluid:'calendar',etag:'1',role:'organizer',organizer:'fixture@example.test',transparency:0};
   if(lose)throw new Error('lost response');return Response.json({events:[event]});
  }
  if(init.method==='PUT'){updates++;event={...event,...JSON.parse(new URLSearchParams(init.body).get('eventdata')!),etag:'2'};return Response.json({events:[event]});}
  if(init.method==='DELETE'){deletes++;event={uid:event.uid,caluid:'calendar',estatus:'deleted'};return Response.json({events:[event]});}
  return Response.json({events:event?[event]:[]});
 }) as typeof fetch;
 await selectCalendar(env,actor,{provider:'zoho',grantId,calendarId:'calendar'},transport);
 const start=Math.ceil((Date.now()+86400000)/60000)*60000;
 const input={title:'Fixture visit',appointmentType:'Visit',start:new Date(start).toISOString(),end:new Date(start+1800000).toISOString(),attendees:[]};
 return {env,actor,transport,input,start,grantId,counts:()=>({creates,updates,deletes}),lose:()=>{lose=true;}};
}
it('runs the Zoho appointment lifecycle through actual tenant policy, authorization and D1 state transitions',async()=>{
 const f=await fixture(),proposal=await proposeBooking(f.env,f.actor,f.input);
 expect((await confirmBooking(f.env,f.actor,proposal.id,f.transport)).status).toBe('applied');
 const change=await proposeAppointmentChange(f.env,f.actor,{kind:'reschedule',appointmentId:proposal.id,start:new Date(f.start+3600000).toISOString(),end:new Date(f.start+5400000).toISOString()},f.transport);
 expect((await confirmAppointmentChange(f.env,f.actor,change.id,f.transport)).status).toBe('applied');
 const cancel=await proposeAppointmentChange(f.env,f.actor,{kind:'cancel',appointmentId:proposal.id},f.transport);
 expect((await confirmAppointmentChange(f.env,f.actor,cancel.id,f.transport)).status).toBe('applied');
 expect(f.counts()).toEqual({creates:1,updates:1,deletes:1});
 expect((await f.env.AGENT_DB.prepare('SELECT state FROM mayor_appointments WHERE id=?').bind(proposal.id).first<any>()).state).toBe('cancelled');
});
it('recovers a lost Zoho creation response by reference without creating a duplicate',async()=>{
 const f=await fixture(),proposal=await proposeBooking(f.env,f.actor,f.input);f.lose();
 expect((await confirmBooking(f.env,f.actor,proposal.id,f.transport)).status).toBe('uncertain');
 expect((await confirmBooking(f.env,f.actor,proposal.id,f.transport)).status).toBe('uncertain');
 expect((await reconcileBooking(f.env,f.actor,proposal.id,f.transport)).status).toBe('applied');expect(f.counts().creates).toBe(1);
});
it('revoking the selected Zoho grant prevents booking dispatch',async()=>{
 const f=await fixture(),proposal=await proposeBooking(f.env,f.actor,f.input);
 await f.env.AGENT_DB.prepare("UPDATE auth_provider_grants SET status='revoked' WHERE id=?").bind(f.grantId).run();
 await expect(confirmBooking(f.env,f.actor,proposal.id,f.transport)).rejects.toThrow();expect(f.counts().creates).toBe(0);
});
