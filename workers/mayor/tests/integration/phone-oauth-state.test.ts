import {env as testEnv} from 'cloudflare:workers';
import {it,expect} from 'vitest';
import type {Env} from '../../src/env';
import {startTelnyxConsent,consumeTelnyxConsent} from '../../src/auth/phone-oauth-state';
import type {TelnyxOAuthConfig} from '../../src/auth/telnyx-protocol';
const env=testEnv as unknown as Env;
const config:TelnyxOAuthConfig={clientId:'fixture',clientSecret:'fixture-secret',redirectUri:'https://mayor.mehyar.us/api/auth/callback/telnyx',scopes:['numbers.read','voice.read']};
async function fixture(){
 const tenantId=crypto.randomUUID(),session={user:{id:crypto.randomUUID()},session:{id:crypto.randomUUID()}};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(tenantId,'OAuth fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(tenantId,session.user.id).run();
 const request=new Request(env.APP_ORIGIN+'/api/phone/telnyx/authorize',{method:'POST',headers:{origin:env.APP_ORIGIN}});
 const start=()=>startTelnyxConsent(request,env,session,tenantId,config);
 const callback=(url:string)=>new Request(config.redirectUri+'?'+new URLSearchParams({state:new URL(url).searchParams.get('state')!,code:'fixture-code'}));
 return {tenantId,session,request,start,callback};
}
it('keeps state/session/verifier out of plaintext storage and permits one callback only',async()=>{
 const f=await fixture(),{url}=await f.start();
 const row=await env.AGENT_DB.prepare('SELECT * FROM mayor_phone_oauth_states WHERE tenant_id=?').bind(f.tenantId).first<any>();
 expect(JSON.stringify(row)).not.toContain(f.session.session.id);
 expect(JSON.stringify(row)).not.toContain(new URL(url).searchParams.get('state'));
 expect(row.ciphertext).toMatch(/^v1\./);
 const outcomes=await Promise.allSettled([consumeTelnyxConsent(f.callback(url),env,f.session,config),consumeTelnyxConsent(f.callback(url),env,f.session,config)]);
 expect(outcomes.filter(o=>o.status==='fulfilled')).toHaveLength(1);
 const value=(outcomes.find(o=>o.status==='fulfilled') as PromiseFulfilledResult<any>).value;
 expect(value.actor).toEqual({tenantId:f.tenantId,userId:f.session.user.id});
 expect(value.verifier).toMatch(/^[a-f0-9]{64}$/);
 expect(JSON.stringify(row)).not.toContain(value.verifier);
});
it('rejects wrong origin, missing login and another business',async()=>{
 const f=await fixture(),other=await fixture();
 await expect(startTelnyxConsent(new Request(f.request.url,{headers:{origin:'https://evil.test'}}),env,f.session,f.tenantId,config)).rejects.toMatchObject({code:'invalid_origin'});
 await expect(startTelnyxConsent(f.request,env,null,f.tenantId,config)).rejects.toMatchObject({status:401});
 await expect(startTelnyxConsent(f.request,env,f.session,other.tenantId,config)).rejects.toThrow();
});
it('does not let a different session consume the legitimate attempt',async()=>{
 const f=await fixture(),{url}=await f.start();
 await expect(consumeTelnyxConsent(f.callback(url),env,{...f.session,session:{id:'other'}},config)).rejects.toThrow();
 await expect(consumeTelnyxConsent(f.callback(url),env,f.session,config)).resolves.toHaveProperty('code','fixture-code');
});
it.each(['expiry','revoked','viewer','inactive','config','ciphertext','connection'])('rejects %s changes before exchanging any code',async change=>{
 const f=await fixture(),{url}=await f.start();
 if(change==='expiry')await env.AGENT_DB.prepare('UPDATE mayor_phone_oauth_states SET expires_at=0 WHERE tenant_id=?').bind(f.tenantId).run();
 if(change==='revoked')await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=?").bind(f.tenantId).run();
 if(change==='viewer')await env.AGENT_DB.prepare("UPDATE agent_memberships SET role='viewer' WHERE tenant_id=?").bind(f.tenantId).run();
 if(change==='inactive')await env.AGENT_DB.prepare("UPDATE agent_tenants SET status='inactive' WHERE id=?").bind(f.tenantId).run();
 if(change==='ciphertext')await env.AGENT_DB.prepare("UPDATE mayor_phone_oauth_states SET ciphertext='v1.invalid.invalid' WHERE tenant_id=?").bind(f.tenantId).run();
 if(change==='connection')await env.AGENT_DB.prepare("INSERT INTO mayor_phone_connections(id,tenant_id,provider,account_id,owner_user_id,ciphertext,status,verified_at,updated_at) VALUES(?,?,'telnyx','fixture',?,'','revoked','now','now')").bind(crypto.randomUUID(),f.tenantId,f.session.user.id).run();
 await expect(consumeTelnyxConsent(f.callback(url),env,f.session,change==='config'?{...config,clientId:'changed'}:config)).rejects.toMatchObject({code:'phone_authorization_expired'});
 expect(await env.AGENT_DB.prepare('SELECT state_hash FROM mayor_phone_oauth_states WHERE tenant_id=?').bind(f.tenantId).first()).toBeNull();
});
it('atomically caps parallel attempts at five per user',async()=>{
 const f=await fixture(),outcomes=await Promise.allSettled(Array.from({length:9},()=>f.start()));
 expect(outcomes.filter(o=>o.status==='fulfilled')).toHaveLength(5);
});
it('consumes denial and duplicate-code callbacks without accepting them',async()=>{
 const f=await fixture();
 for(const suffix of ['&error=access_denied','&code=another-code']){
  const {url}=await f.start(),request=f.callback(url);
  await expect(consumeTelnyxConsent(new Request(request.url+suffix),env,f.session,config)).rejects.toThrow();
  await expect(consumeTelnyxConsent(request,env,f.session,config)).rejects.toThrow();
 }
});
