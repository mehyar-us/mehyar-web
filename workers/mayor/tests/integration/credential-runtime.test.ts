import {env as testEnv} from 'cloudflare:workers';
import {it,expect,vi} from 'vitest';
import type {Env} from '../../src/env';
import {storeProviderGrant,decryptCredential} from '../../src/auth/vault';
import {connectorCredential} from '../../src/connectors/credentials';
import {GOOGLE_CALENDAR_OPERATIONS} from '../../src/connectors/google-calendar';

async function fixture(){
 const env={...testEnv,GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret'} as unknown as Env;
 const actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()},now=Date.now();
 await env.AGENT_DB.prepare('INSERT INTO auth_user(id,name,email,createdAt,updatedAt) VALUES(?,?,?,?,?)').bind(actor.userId,'Fixture',actor.userId+'@example.test',now,now).run();
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
 const binding={...actor,provider:'google' as const,accountId:'fixture'},scope='https://www.googleapis.com/auth/calendar.events';
 const id=await storeProviderGrant(env,binding,{accountEmail:'fixture@example.test',accessToken:'expired',refreshToken:'synthetic-refresh',accessTokenExpiresAt:new Date(now-1000).toISOString(),grantedScopes:[scope]},['calendar_manage']);
 return {env,actor,binding,id,scope};
}
it('renews an expired calendar token with manual redirects and retains only verified scopes',async()=>{
 const {env,actor,binding,id,scope}=await fixture();
 const transport=vi.fn(async(url:any,init:any)=>{
  expect(String(url)).toBe('https://oauth2.googleapis.com/token');expect(init.redirect).toBe('manual');expect(init.method).toBe('POST');
  return Response.json({access_token:'renewed',token_type:'Bearer',expires_in:3600});
 }) as unknown as typeof fetch;
 const result=await connectorCredential(env,actor,id,'google',GOOGLE_CALENDAR_OPERATIONS.create,transport);
 expect(result.grantedScopes).toEqual([scope]);expect(result.accessToken).toBe('renewed');
 const row=await env.AGENT_DB.prepare('SELECT ciphertext,status FROM auth_provider_grants WHERE id=?').bind(id).first<any>();
 expect(row.status).toBe('authorized');expect(row.ciphertext).not.toContain('renewed');
 expect((await decryptCredential(row.ciphertext,binding,env.TOKEN_ENCRYPTION_KEY!)).refreshToken).toBe('synthetic-refresh');
 expect(transport).toHaveBeenCalledTimes(1);
});
it('never follows token redirects or retries an uncertain renewal',async()=>{
 const {env,actor,id}=await fixture();
 const transport=vi.fn(async(_url:any,init:any)=>{expect(init.redirect).toBe('manual');return new Response(null,{status:302,headers:{location:'https://evil.example'}});}) as unknown as typeof fetch;
 await expect(connectorCredential(env,actor,id,'google',GOOGLE_CALENDAR_OPERATIONS.create,transport)).rejects.toThrow();
 await expect(connectorCredential(env,actor,id,'google',GOOGLE_CALENDAR_OPERATIONS.create,transport)).rejects.toThrow();
 expect(transport).toHaveBeenCalledTimes(1);
 expect((await env.AGENT_DB.prepare('SELECT status FROM auth_provider_grants WHERE id=?').bind(id).first<any>()).status).toBe('reconnect_required');
});
