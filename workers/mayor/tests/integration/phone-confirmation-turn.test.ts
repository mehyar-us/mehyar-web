import {it,expect,vi} from 'vitest';
import {env as testEnv} from 'cloudflare:workers';
import type {Env} from '../../src/env';
import {MayorPhone} from '../../src/phone-voice';
import * as bookings from '../../src/phone-bookings';
import * as changes from '../../src/phone-appointment-changes';
it.each(['book','cancel','reschedule','mismatch','unread','expired','callback'] as const)('phone confirmation remains scoped: %s',async mode=>{
 const env=testEnv as unknown as Env,tenant=crypto.randomUUID(),call=crypto.randomUUID(),id=crypto.randomUUID();
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(tenant,'Phone confirmation fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO mayor_phone_calls(id,tenant_id,account_id,call_sid,connection_revision,state,stream_expires_at,expires_at,created_at) VALUES(?,?,?,?,1,'streaming','2099','2099','now')").bind(call,tenant,'account',call).run();
 const phone=Object.create(MayorPhone.prototype) as any;
 Object.assign(phone,{env:{...env,AI:{run:()=>{throw Error('No model expected');}}},proposals:new Map(),ready:new Set(mode==='unread'?[]:['test']),generations:new Map(),bookingChoices:new Map(),appointmentChoices:new Map(),authorize:async()=>({id:call,tenantId:tenant})});
 const proposal=mode==='book'?{bookingId:id}:mode==='callback'?{reason:'scheduling'}:{changeId:id,kind:mode==='reschedule'||mode==='mismatch'?'reschedule':'cancel'};
 phone.proposals.set('test',{...proposal,expiresAt:Date.now()+(mode==='expired'?-1000:60000)});
 const book=vi.spyOn(bookings,'confirmPhoneBooking').mockResolvedValue({status:'applied'} as any);
 const change=vi.spyOn(changes,'confirmPhoneAppointmentChange').mockResolvedValue({status:'applied',kind:mode==='reschedule'?'reschedule':'cancel'} as any);
 try{
  const context={connection:{id:'test'},signal:new AbortController().signal,messages:[]};
  const phrase=mode==='book'?'Yes, book it.':mode==='reschedule'?'Yes, reschedule it.':'Yes, cancel it.';
  const answer=await phone.onTurn(phrase,context);
  if(['book','cancel','reschedule'].includes(mode)){
   expect(answer).toContain(mode==='book'?'booked':mode==='cancel'?'cancelled':'rescheduled');
   expect(book.mock.calls.length+change.mock.calls.length).toBe(1);
   expect(await phone.onTurn(phrase,context)).toContain('does not match');
   expect(book.mock.calls.length+change.mock.calls.length).toBe(1);
  }else{expect(answer).toContain('does not match');expect(book).not.toHaveBeenCalled();expect(change).not.toHaveBeenCalled();}
 }finally{book.mockRestore();change.mockRestore();}
});
