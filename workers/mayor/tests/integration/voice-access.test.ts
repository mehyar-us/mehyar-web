import {env as testEnv} from 'cloudflare:workers';
import {beforeEach,it,expect,vi} from 'vitest';
import type {Env} from '../../src/env';
import {createAuth} from '../../src/auth';
import {requireMembership,requireTenant} from '../../src/permissions';
import {requireVoiceAccess,type VoiceIdentity} from '../../src/voice-access';
import {readMemory} from '../../src/memory';
import worker from '../../src';
const env=testEnv as unknown as Env;
let identity:VoiceIdentity,cookie:string;
beforeEach(async()=>{
 const ctx=await createAuth(env).$context;
 const user=await ctx.internalAdapter.createUser({email:`${crypto.randomUUID()}@example.test`,name:'Access fixture',emailVerified:true});
 const session=await ctx.internalAdapter.createSession(user.id);
 identity={tenantId:crypto.randomUUID().replaceAll('-',''),userId:user.id,sessionId:session.id};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(identity.tenantId,'Access fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(identity.tenantId,user.id).run();
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.BETTER_AUTH_SECRET!),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(session.token));
 cookie='__Secure-mehyar-agent.session_token='+encodeURIComponent(`${session.token}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`);
});
it.each(['paused','offboarding','suspended','deleted'] as const)('rejects a %s tenant at membership, profile, voice session and socket boundaries',async status=>{
 expect(await requireVoiceAccess(env,identity)).toEqual(identity);
 await env.AGENT_DB.prepare('UPDATE agent_tenants SET status=? WHERE id=?').bind(status,identity.tenantId).run();
 await expect(requireMembership(env,identity)).rejects.toThrow('not available');
 await expect(requireTenant(env,identity)).rejects.toThrow('not available');
 await expect(readMemory(env,identity)).rejects.toThrow('not available');
 await expect(requireVoiceAccess(env,identity)).rejects.toThrow('access has ended');
 const base=env.APP_ORIGIN;
 const requests=[
  new Request(`${base}/api/businesses/${identity.tenantId}/profile`,{headers:{cookie}}),
  new Request(`${base}/api/voice/session`,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({tenantId:identity.tenantId})}),
  new Request(`${base}/agents/mayor-voice/${'0'.repeat(64)}?business=${identity.tenantId}`,{headers:{cookie,origin:base,upgrade:'websocket'}}),
 ];
 for(const request of requests)expect((await worker.fetch(request,env,{} as ExecutionContext)).status).toBe(404);
});
it.each(['session_deleted','session_expired','member_revoked','member_expired','wrong_user','wrong_tenant','viewer','billing'] as const)('revokes existing voice identity for %s',async reason=>{
 expect(await requireVoiceAccess(env,identity)).toEqual(identity);
 if(reason==='session_deleted')await env.AGENT_DB.prepare('DELETE FROM auth_session WHERE id=?').bind(identity.sessionId).run();
 if(reason==='session_expired')await env.AGENT_DB.prepare('UPDATE auth_session SET expiresAt=? WHERE id=?').bind(Date.now()-1,identity.sessionId).run();
 if(reason==='member_revoked')await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=?").bind(identity.tenantId).run();
 if(reason==='member_expired')await env.AGENT_DB.prepare("UPDATE agent_memberships SET expires_at='2000-01-01' WHERE tenant_id=?").bind(identity.tenantId).run();
 if(reason==='viewer'||reason==='billing')await env.AGENT_DB.prepare('UPDATE agent_memberships SET role=? WHERE tenant_id=?').bind(reason,identity.tenantId).run();
 const candidate={...identity,...(reason==='wrong_user'?{userId:crypto.randomUUID()}:{ }),...(reason==='wrong_tenant'?{tenantId:crypto.randomUUID()}:{})};
 await expect(requireVoiceAccess(env,candidate)).rejects.toThrow('access has ended');
});
it('allows current staff chat access without granting operator authority',async()=>{
 await env.AGENT_DB.prepare("UPDATE agent_memberships SET role='staff' WHERE tenant_id=?").bind(identity.tenantId).run();
 expect(await requireVoiceAccess(env,identity)).toEqual(identity);
 await expect(requireMembership(env,identity,['owner','manager'])).rejects.toThrow('cannot perform');
});

import {MayorVoice} from '../../src/voice';
import {HttpError} from '../../src/http';

it.each(['expired','storage','missing_identity'] as const)('classifies a %s voice connection failure without leaking data',async mode=>{
 const voice=Object.create(MayorVoice.prototype) as any;
 Object.assign(voice,{identities:new Map(),authorize:async()=>{if(mode==='expired')throw new HttpError(401,'voice_access_expired','Sensitive fixture details');return identity;},recoverConversation:async()=>{throw new Error('Sensitive storage details');}});
 const close=vi.fn(),send=vi.fn(),log=vi.spyOn(console,'warn').mockImplementation(()=>{});
 const headers=mode==='missing_identity'?{}:{'x-mayor-tenant':identity.tenantId,'x-mayor-user':identity.userId,'x-mayor-session':identity.sessionId};
 try{
  await voice.onConnect({id:'failure',close,send},{request:new Request('https://example.test/',{headers})});
  expect(close.mock.calls[0][0]).toBe(mode==='storage'?1011:1008);
  expect(send).not.toHaveBeenCalled();expect(voice.identities.size).toBe(0);
  expect(JSON.stringify(log.mock.calls)).not.toContain('Sensitive');expect(JSON.stringify(log.mock.calls)).not.toContain(identity.sessionId);
 }finally{log.mockRestore();}
});

it.each(['future_iso','expired_iso','future_epoch','malformed'] as const)('checks %s session expiration using its actual timestamp',async mode=>{
 const expiry=mode==='future_iso'?new Date(Date.now()+86400000).toISOString():mode==='expired_iso'?'2000-01-01T00:00:00.000Z':mode==='future_epoch'?Date.now()+86400000:'999999999999999-invalid';
 await env.AGENT_DB.prepare('UPDATE auth_session SET expiresAt=? WHERE id=?').bind(expiry,identity.sessionId).run();
 if(mode.startsWith('future'))expect(await requireVoiceAccess(env,identity)).toEqual(identity);
 else await expect(requireVoiceAccess(env,identity)).rejects.toThrow('access has ended');
});
