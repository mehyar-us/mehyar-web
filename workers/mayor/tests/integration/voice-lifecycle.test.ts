import {env as testEnv} from 'cloudflare:workers';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createAuth} from '../../src/auth';
import type {Env} from '../../src/env';
import type {VoiceIdentity} from '../../src/voice-access';
import {MayorVoice} from '../../src/voice';
import * as usage from '../../src/usage';

// Exercise admission and final speech authorization against real local D1 auth.
// Speech/model methods are spies: no provider request or production mutation.
const env=testEnv as unknown as Env;
let identity:VoiceIdentity,voices:any[];
beforeEach(async()=>{
 voices=[];
 const context=await createAuth(env).$context;
 const user=await context.internalAdapter.createUser({email:`${crypto.randomUUID()}@example.test`,name:'Voice lifecycle fixture',emailVerified:true});
 const session=await context.internalAdapter.createSession(user.id);
 identity={tenantId:crypto.randomUUID().replaceAll('-',''),userId:user.id,sessionId:session.id};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(identity.tenantId,'Voice lifecycle fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(identity.tenantId,identity.userId).run();
});
afterEach(()=>{
 for(const voice of voices)for(const stop of voice.callMeters.values())stop();
 vi.useRealTimers();vi.restoreAllMocks();
});
function fixture(){
 const voice=Object.create(MayorVoice.prototype) as any;
 const connection={id:crypto.randomUUID(),send:vi.fn()};
 for(const field of ['identities','callMeters','accessWatches','generations','pending','pendingCalendar','pendingPolicy','pendingBooking','pendingChange','pendingCallback','pendingCustomer'])voice[field]=new Map();
 Object.assign(voice,{env:{...env,AI:{run:vi.fn()}},ready:new Set(),speak:vi.fn(async()=>{}),forceEndCall:vi.fn()});
 voice.identities.set(connection.id,identity);voices.push(voice);
 return {voice,connection};
}
it('admits one concurrent call and rejects typed-turn overlap without invoking speech or the model',async()=>{
 const f=fixture(),other={id:crypto.randomUUID(),send:vi.fn()};
 f.voice.identities.set(other.id,identity);
 const admissions=await Promise.all([f.voice.beforeCallStart(f.connection),f.voice.beforeCallStart(other)]);
 expect(admissions).toEqual([true,false]);expect(f.voice.speak).not.toHaveBeenCalled();expect(f.voice.env.AI.run).not.toHaveBeenCalled();
 f.voice.onCallEnd(f.connection);f.voice.textBusy=true;
 expect(await f.voice.beforeCallStart(other)).toBe(false);
 f.voice.textBusy=false;expect(await f.voice.beforeCallStart(other)).toBe(true);f.voice.onCallEnd(other);
});
it('refuses revoked initial access before reserving quota or starting provider work',async()=>{
 const claims=vi.spyOn(usage,'claimUsage'),f=fixture();
 await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=?").bind(identity.tenantId).run();
 expect(await f.voice.beforeCallStart(f.connection)).toBe(false);await f.voice.onCallStart(f.connection);
 expect(claims).not.toHaveBeenCalled();expect(f.voice.speak).not.toHaveBeenCalled();expect(f.voice.env.AI.run).not.toHaveBeenCalled();
 await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='active' WHERE tenant_id=?").bind(identity.tenantId).run();
 expect(await f.voice.beforeCallStart(f.connection)).toBe(true);f.voice.onCallEnd(f.connection);
});
it('does not reserve microphone time or greet after cancellation while startup allowance is pending',async()=>{
 const actual=usage.claimUsage;let reached!:()=>void,release!:()=>void;
 const pending=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{reached=resolve;});
 const claims=vi.spyOn(usage,'claimUsage').mockImplementation(async(...args)=>{
  const result=await actual(...args);if(args[2]==='start'){reached();await pending;}return result;
 });
 const f=fixture(),admission=f.voice.beforeCallStart(f.connection);await started;
 f.voice.onCallEnd(f.connection);release();expect(await admission).toBe(false);
 await f.voice.onCallStart(f.connection);
 expect(claims.mock.calls.map(args=>args[2])).toEqual(['start']);
 expect(f.voice.speak).not.toHaveBeenCalled();expect(f.voice.env.AI.run).not.toHaveBeenCalled();
});
it('honors microphone allowance refusal and leaves admission available for a fresh attempt',async()=>{
 const actual=usage.claimUsage;
 const claims=vi.spyOn(usage,'claimUsage').mockImplementation(async(...args)=>args[2]==='minute'
  ? {allowed:false,message:'Fixture microphone allowance exhausted.',resetAt:'2026-11-01T00:00:00.000Z'}
  : actual(...args));
 const f=fixture();expect(await f.voice.beforeCallStart(f.connection)).toBe(false);
 expect(JSON.parse(f.connection.send.mock.calls[0][0])).toMatchObject({type:'usage_notice',allowed:false,message:'Fixture microphone allowance exhausted.'});
 await f.voice.onCallStart(f.connection);expect(f.voice.speak).not.toHaveBeenCalled();expect(f.voice.env.AI.run).not.toHaveBeenCalled();
 claims.mockImplementation(actual);expect(await f.voice.beforeCallStart(f.connection)).toBe(true);f.voice.onCallEnd(f.connection);
});
it.each(['end','disconnect'] as const)('stops renewal and discards pending confirmation on %s',async mode=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
 const claims=vi.spyOn(usage,'claimUsage'),f=fixture();
 expect(await f.voice.beforeCallStart(f.connection)).toBe(true);
 f.voice.ready.add(f.connection.id);f.voice.pending.set(f.connection.id,{patch:{name:'Must not save'},revision:0,expiresAt:Date.now()+120000});
 if(mode==='end')f.voice.onCallEnd(f.connection);else f.voice.onClose(f.connection);
 await vi.advanceTimersByTimeAsync(120000);
 expect(claims.mock.calls.map(args=>args[2])).toEqual(['start','minute']);
 expect(f.voice.ready.has(f.connection.id)).toBe(false);expect(f.voice.pending.has(f.connection.id)).toBe(false);
 expect(f.voice.forceEndCall).not.toHaveBeenCalled();expect(f.voice.env.AI.run).not.toHaveBeenCalled();
});
it.each(['membership','session','tenant'] as const)('blocks speech after %s access is revoked',async change=>{
 const f=fixture();expect(await f.voice.beforeSynthesize('Private fixture readback',f.connection)).toBe('Private fixture readback');
 if(change==='membership')await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=?").bind(identity.tenantId).run();
 if(change==='session')await env.AGENT_DB.prepare('DELETE FROM auth_session WHERE id=?').bind(identity.sessionId).run();
 if(change==='tenant')await env.AGENT_DB.prepare("UPDATE agent_tenants SET status='paused' WHERE id=?").bind(identity.tenantId).run();
 expect(await f.voice.beforeSynthesize('Private fixture readback',f.connection)).toBeNull();
 expect(f.voice.forceEndCall).toHaveBeenCalledWith(f.connection);expect(f.voice.speak).not.toHaveBeenCalled();expect(f.voice.env.AI.run).not.toHaveBeenCalled();
});
it('stops an active call when renewed authorization fails before more microphone time is consumed',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
 const claims=vi.spyOn(usage,'claimUsage'),f=fixture();expect(await f.voice.beforeCallStart(f.connection)).toBe(true);
 await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=?").bind(identity.tenantId).run();
 await vi.advanceTimersByTimeAsync(55000);
 await vi.waitFor(()=>expect(f.voice.forceEndCall).toHaveBeenCalledWith(f.connection));
 await vi.advanceTimersByTimeAsync(120000);
 expect(claims.mock.calls.map(args=>args[2])).toEqual(['start','minute']);expect(f.voice.forceEndCall).toHaveBeenCalledOnce();
 expect(f.voice.env.AI.run).not.toHaveBeenCalled();
});
