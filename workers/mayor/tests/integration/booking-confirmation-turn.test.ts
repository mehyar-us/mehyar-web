import * as changes from '../../src/appointment-changes';
import {it,expect,vi} from 'vitest';
import {env as testEnv} from 'cloudflare:workers';
import type {Env} from '../../src/env';
import {MayorVoice} from '../../src/voice';
import * as appointments from '../../src/appointments';

it.each(['ready','expired','unread','unrelated','uncertain','failure'] as const)('routes booking-specific confirmation only for a ready booking: %s',async mode=>{
 const env=testEnv as unknown as Env,actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Confirmation fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
 const voice=Object.create(MayorVoice.prototype) as any;
 for(const field of ['generations','pending','pendingCalendar','pendingPolicy','pendingBooking','pendingChange','pendingCallback','pendingCustomer'])voice[field]=new Map();
 Object.assign(voice,{env:{...env,AI:{run:()=>{throw Error('Confirmation must not call the model');}}},ready:new Set(mode==='unread'?[]:['test']),authorize:async()=>actor});
 const id=crypto.randomUUID();
 if(mode==='unrelated')voice.pending.set('test',{patch:{name:'Must not save'},revision:0,expiresAt:Date.now()+60000});
 else voice.pendingBooking.set('test',{id,expiresAt:Date.now()+(mode==='expired'?-1000:60000)});
 const confirm=vi.spyOn(appointments,'confirmBooking').mockResolvedValue({status:'applied',receipt:{id:'controlled-provider-receipt'}} as any);
 if(mode==='uncertain')confirm.mockResolvedValue({status:'uncertain'} as any);
 if(mode==='failure')confirm.mockRejectedValue(new Error('controlled failure'));
 try{
  const context={connection:{id:'test',send:()=>{}},signal:new AbortController().signal,messages:[]};
  const answer=await voice.onTurn('Yes, book it.',context);
  if(mode==='ready'){
   expect(answer).toBe('Your appointment is confirmed on the calendar.');expect(confirm).toHaveBeenCalledExactlyOnceWith(voice.env,actor,id);
   expect(await voice.onTurn('Yes, book it.',context)).toContain('isn’t an appointment ready');expect(confirm).toHaveBeenCalledTimes(1);
  }else if(mode==='uncertain'||mode==='failure'){
   expect(answer).not.toContain('appointment is confirmed');expect(confirm).toHaveBeenCalledTimes(1);
   expect(await voice.onTurn('Yes, book it.',context)).toContain('isn’t an appointment ready');expect(confirm).toHaveBeenCalledTimes(1);
  }else{expect(answer).toContain('isn’t an appointment ready');expect(confirm).not.toHaveBeenCalled();}
  expect(await env.AGENT_DB.prepare('SELECT tenant_id FROM mayor_memory WHERE tenant_id=?').bind(actor.tenantId).first()).toBeNull();
  expect(voice.ready.size).toBe(0);
 }finally{confirm.mockRestore();}
});

it.each(['cancel','reschedule','mismatch','expired','unread','absent'] as const)('scopes appointment-change confirmation: %s',async mode=>{
 const env=testEnv as unknown as Env,actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Change confirmation fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
 const voice=Object.create(MayorVoice.prototype) as any;
 for(const field of ['generations','pending','pendingCalendar','pendingPolicy','pendingBooking','pendingChange','pendingCallback','pendingCustomer'])voice[field]=new Map();
 Object.assign(voice,{env:{...env,AI:{run:()=>{throw Error('No model expected');}}},ready:new Set(mode==='unread'?[]:['test']),authorize:async()=>actor});
 const id=crypto.randomUUID(),kind=mode==='reschedule'?'reschedule':'cancel';
 if(mode!=='absent')voice.pendingChange.set('test',{id,kind:mode==='mismatch'?'reschedule':kind,expiresAt:Date.now()+(mode==='expired'?-1000:60000)});
 const confirm=vi.spyOn(changes,'confirmAppointmentChange').mockResolvedValue({status:'applied',kind} as any);
 try{
  const context={connection:{id:'test',send:()=>{}},signal:new AbortController().signal,messages:[]};
  const text=`Yes, ${kind} it.`;
  const answer=await voice.onTurn(text,context);
  if(mode==='cancel'||mode==='reschedule'){
   expect(answer).toContain('calendar confirmed');expect(confirm).toHaveBeenCalledExactlyOnceWith(voice.env,actor,id);
   expect(await voice.onTurn(text,context)).toContain('does not match');expect(confirm).toHaveBeenCalledTimes(1);
  }else{expect(answer).toContain('does not match');expect(confirm).not.toHaveBeenCalled();}
 }finally{confirm.mockRestore();}
});