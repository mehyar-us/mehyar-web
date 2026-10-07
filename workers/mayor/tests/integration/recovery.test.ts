import {env as testEnv} from 'cloudflare:workers';
import {beforeEach,afterEach,it,expect} from 'vitest';
import type {Env,Actor} from '../../src/env';
import {runAppointmentRecovery} from '../../src/recovery';
import {listBookingRequests} from '../../src/appointments';
const env=testEnv as unknown as Env;
let actor:Actor;
const input={title:'Recovery test',appointmentType:'Visit',start:'2026-12-01T15:00:00Z',end:'2026-12-01T15:30:00Z',attendees:[]};
beforeEach(async()=>{
 actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Recovery test',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
});
afterEach(async()=>{
 await env.AGENT_DB.prepare("UPDATE mayor_appointment_changes SET state='rejected' WHERE tenant_id=?").bind(actor.tenantId).run();
 await env.AGENT_DB.prepare("UPDATE mayor_appointment_jobs SET state='rejected' WHERE tenant_id=?").bind(actor.tenantId).run();
 await env.AGENT_DB.prepare("UPDATE mayor_recovery_attempts SET state='complete' WHERE tenant_id=?").bind(actor.tenantId).run();
});
async function booking(updatedAt=new Date(Date.now()-600000).toISOString()){
 const id=crypto.randomUUID();
 await env.AGENT_DB.prepare(`INSERT INTO mayor_appointment_jobs(id,tenant_id,actor_id,provider,grant_id,calendar_id,authorization_stamp,policy_revision,input_json,reserved_start,reserved_end,state,expires_at,created_at,updated_at)
 VALUES(?,?,?,'google','fixture-grant','fixture-calendar','fixture-stamp',1,?,?,?,'uncertain',?,?,?)`).bind(id,actor.tenantId,actor.userId,JSON.stringify(input),input.start,input.end,updatedAt,updatedAt,updatedAt).run();
 return id;
}
const uncertain=async()=>({status:'uncertain'});
it('leases each request once across overlapping scheduled runs',async()=>{
 const id=await booking();let calls=0,release!:()=>void,started!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});
 const observe={booking:async(_env:Env,seenActor:Actor,request:string)=>{calls++;expect(seenActor).toEqual(actor);expect(request).toBe(id);started();await gate;return {status:'applied'};},change:uncertain};
 const first=runAppointmentRecovery(env,observe);await entered;
 const second=await runAppointmentRecovery(env,observe);expect(second.claimed).toBe(0);release();
 expect((await first).applied).toBe(1);expect(calls).toBe(1);
 expect(await env.AGENT_DB.prepare('SELECT state,attempts,lease_token FROM mayor_recovery_attempts WHERE request_id=?').bind(id).first()).toMatchObject({state:'complete',attempts:1,lease_token:null});
});
it('backs off, keeps reservations, and exposes human review after six inconclusive observations',async()=>{
 const id=await booking();let now=Date.now();
 for(let attempt=1;attempt<=6;attempt++){
  const result=await runAppointmentRecovery(env,{booking:uncertain,change:uncertain},now);expect(result.claimed).toBe(1);
  const row=await env.AGENT_DB.prepare('SELECT attempts,state,next_attempt_at FROM mayor_recovery_attempts WHERE request_id=?').bind(id).first<any>();
  expect(row.attempts).toBe(attempt);expect(row.state).toBe(attempt===6?'review':'pending');
  expect((await runAppointmentRecovery(env,{booking:uncertain,change:uncertain},now+1000)).claimed).toBe(0);
  now=row.next_attempt_at+1;
 }
 const listed=await listBookingRequests(env,actor);expect(listed.find(row=>row.id===id)).toMatchObject({status:'uncertain',recovery:{status:'review',attempts:6,nextCheckAt:null}});
 expect(await env.AGENT_DB.prepare('SELECT state,reservation_active FROM mayor_appointment_jobs WHERE id=?').bind(id).first()).toMatchObject({state:'uncertain',reservation_active:1});
 expect((await runAppointmentRecovery(env,{booking:uncertain,change:uncertain},now+86400000)).claimed).toBe(0);
 await env.AGENT_DB.prepare("UPDATE mayor_appointment_jobs SET state='applied' WHERE id=?").bind(id).run();
 expect((await listBookingRequests(env,actor)).find(row=>row.id===id)?.recovery).toBeNull();
});
it('never invokes the observer after the originating operator loses access',async()=>{
 await booking();await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=?").bind(actor.tenantId).run();
 let called=false;const observe=async()=>{called=true;return {status:'applied'};};
 expect((await runAppointmentRecovery(env,{booking:observe,change:observe})).pending).toBe(1);expect(called).toBe(false);
});
it('escalates an exhausted crashed lease and avoids racing a fresh request',async()=>{
 const old=await booking(),now=Date.now();await booking(new Date(now).toISOString());
 await env.AGENT_DB.prepare("INSERT INTO mayor_recovery_attempts(kind,request_id,tenant_id,attempts,state,next_attempt_at,lease_until,lease_token,last_result,updated_at) VALUES('booking',?,?,6,'pending',0,0,'expired','checking',?)").bind(old,actor.tenantId,new Date(now-600000).toISOString()).run();
 const result=await runAppointmentRecovery(env,{booking:uncertain,change:uncertain},now);expect(result.review).toBe(1);expect(result.claimed).toBe(0);
});
it('routes uncertain changes to the change observer without releasing the appointment hold',async()=>{
 const parent=await booking(),id=crypto.randomUUID(),old=new Date(Date.now()-600000).toISOString();
 await env.AGENT_DB.prepare("UPDATE mayor_appointment_jobs SET state='applied' WHERE id=?").bind(parent).run();
 await env.AGENT_DB.prepare("INSERT INTO mayor_appointments(id,tenant_id,provider,calendar_id,event_id,input_json,state,created_at,updated_at) VALUES(?,?,'google','fixture-calendar','fixture-event',?,'confirmed',?,?)").bind(parent,actor.tenantId,JSON.stringify(input),old,old).run();
 await env.AGENT_DB.prepare(`INSERT INTO mayor_appointment_changes(id,tenant_id,actor_id,appointment_id,kind,state,expected_etag,before_json,after_json,policy_revision,authorization_stamp,old_start,old_end,new_start,new_end,expires_at,created_at,updated_at)
 VALUES(?,?,?,?,'cancel','uncertain','fixture-etag',?,?,1,'fixture-stamp',?,?,?,?,?,?,?)`).bind(id,actor.tenantId,actor.userId,parent,JSON.stringify(input),JSON.stringify(input),input.start,input.end,input.start,input.end,old,old,old).run();
 let changed=false;const result=await runAppointmentRecovery(env,{booking:async()=>{throw new Error('Wrong observer');},change:async(_env,seenActor,request)=>{expect(seenActor).toEqual(actor);expect(request).toBe(id);changed=true;return {status:'uncertain'};}});
 expect(changed).toBe(true);expect(result.pending).toBe(1);expect((await listBookingRequests(env,actor))[0].recovery?.status).toBe('pending');
 expect(await env.AGENT_DB.prepare('SELECT reservation_active FROM mayor_appointment_jobs WHERE id=?').bind(parent).first()).toMatchObject({reservation_active:1});
});
