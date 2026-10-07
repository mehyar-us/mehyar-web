import {env as testEnv} from 'cloudflare:workers';
import {it,expect} from 'vitest';
import type {Env} from '../../src/env';
import {startTwilioConnect,consumeTwilioConnect} from '../../src/auth/twilio-connect-state';
const env=testEnv as unknown as Env,app='CN'+'a'.repeat(32),account='AC'+'b'.repeat(32);
async function fixture(){
 const tenantId=crypto.randomUUID(),session={user:{id:crypto.randomUUID()},session:{id:crypto.randomUUID()}};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(tenantId,'Connect test',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(tenantId,session.user.id).run();
 const request=new Request(env.APP_ORIGIN+'/api/test',{method:'POST',headers:{origin:env.APP_ORIGIN}});
 const start=()=>startTwilioConnect(request,env,session,tenantId,app);
 const callback=(state:string,suffix='')=>new Request(env.APP_ORIGIN+'/api/auth/callback/twilio?'+new URLSearchParams({state,AccountSid:account})+suffix);
 return {tenantId,session,request,start,callback};
}
it('hashes state and session, consumes atomically, and never authorizes the claimed account',async()=>{
 const f=await fixture(),{state}=await f.start();
 const row=await env.AGENT_DB.prepare('SELECT * FROM mayor_twilio_connect_attempts WHERE tenant_id=?').bind(f.tenantId).first();
 expect(JSON.stringify(row)).not.toContain(state);expect(JSON.stringify(row)).not.toContain(f.session.session.id);
 const results=await Promise.allSettled([1,2].map(()=>consumeTwilioConnect(f.callback(state),env,f.session,app)));
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect((results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<any>).value).toMatchObject({status:'unverified',claimedAccountSid:account});
 expect(await env.AGENT_DB.prepare('SELECT id FROM mayor_phone_connections WHERE tenant_id=?').bind(f.tenantId).first()).toBeNull();
});
it('leaves another session unable to consume the attempt',async()=>{
 const f=await fixture(),{state}=await f.start();
 await expect(consumeTwilioConnect(f.callback(state),env,{...f.session,session:{id:'other'}},app)).rejects.toThrow();
 await expect(consumeTwilioConnect(f.callback(state),env,f.session,app)).resolves.toHaveProperty('status','unverified');
});
it.each(['expiry','revoked','viewer','inactive','app','connection'])('rejects changed %s',async change=>{
 const f=await fixture(),{state}=await f.start();
 if(change==='expiry')await env.AGENT_DB.prepare('UPDATE mayor_twilio_connect_attempts SET expires_at=0 WHERE tenant_id=?').bind(f.tenantId).run();
 if(change==='revoked')await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=?").bind(f.tenantId).run();
 if(change==='viewer')await env.AGENT_DB.prepare("UPDATE agent_memberships SET role='viewer' WHERE tenant_id=?").bind(f.tenantId).run();
 if(change==='inactive')await env.AGENT_DB.prepare("UPDATE agent_tenants SET status='inactive' WHERE id=?").bind(f.tenantId).run();
 if(change==='connection')await env.AGENT_DB.prepare("INSERT INTO mayor_phone_connections(id,tenant_id,provider,account_id,owner_user_id,ciphertext,status,verified_at,updated_at) VALUES(?,?,'twilio',?,?,'','revoked','now','now')").bind(crypto.randomUUID(),f.tenantId,account,f.session.user.id).run();
 await expect(consumeTwilioConnect(f.callback(state),env,f.session,change==='app'?'CN'+'c'.repeat(32):app)).rejects.toThrow();
});
it('rejects unauthenticated, cross-origin and cross-tenant starts',async()=>{
 const f=await fixture(),other=await fixture();
 await expect(startTwilioConnect(f.request,env,null,f.tenantId,app)).rejects.toMatchObject({status:401});
 await expect(startTwilioConnect(new Request(f.request.url,{method:'POST',headers:{origin:'https://evil.test'}}),env,f.session,f.tenantId,app)).rejects.toThrow();
 await expect(startTwilioConnect(f.request,env,f.session,other.tenantId,app)).rejects.toThrow();
});
it('consumes denied and ambiguous account claims',async()=>{
 const f=await fixture();for(const suffix of ['&error=unauthorized_client','&AccountSid='+account]){
  const {state}=await f.start();await expect(consumeTwilioConnect(f.callback(state,suffix),env,f.session,app)).rejects.toThrow();
  await expect(consumeTwilioConnect(f.callback(state),env,f.session,app)).rejects.toThrow();
 }
});
it('limits concurrent consent attempts',async()=>{
 const f=await fixture(),results=await Promise.allSettled(Array.from({length:8},()=>f.start()));
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(5);
});
