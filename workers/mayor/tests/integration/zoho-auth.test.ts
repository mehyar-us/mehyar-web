import {env as testEnv} from 'cloudflare:workers';
import {it,expect,vi} from 'vitest';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {startZoho,finishZoho} from '../../src/auth/zoho';
import {decryptCredential} from '../../src/auth/vault';
import type {Env} from '../../src/env';
async function fixture(){
 const env={...testEnv,ZOHO_CLIENT_ID:'synthetic-client',ZOHO_CLIENT_SECRET:'synthetic-secret',ZOHO_ENABLED_CAPABILITIES:'calendar_manage'} as unknown as Env;
 const tenantId=crypto.randomUUID(),userId=crypto.randomUUID(),now=Date.now(),session={user:{id:userId},session:{id:crypto.randomUUID()}};
 await env.AGENT_DB.prepare('INSERT INTO auth_user(id,name,email,createdAt,updatedAt) VALUES(?,?,?,?,?)').bind(userId,'Zoho fixture',userId+'@example.test',now,now).run();
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(tenantId,'Zoho fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(tenantId,userId).run();
 const request=new Request(env.APP_ORIGIN+'/api/auth/start/zoho',{method:'POST',headers:{origin:env.APP_ORIGIN,'content-type':'application/json'},body:JSON.stringify({tenantId,capabilities:['calendar_manage']})});
 const result=await startZoho(request,env,session),url=new URL((await result.json() as any).url);
 return {env,tenantId,userId,session,url,callback:new Request(env.APP_ORIGIN+'/api/auth/callback/zoho?'+new URLSearchParams({state:url.searchParams.get('state')!,code:'synthetic-code',location:'us','accounts-server':'https://accounts.zoho.com'}))};
}
async function provider(nonce:string,scope='ZohoCalendar.calendar.READ,ZohoCalendar.event.ALL'){
 const pair=await generateKeyPair('RS256'),key={...await exportJWK(pair.publicKey),kid:'fixture',alg:'RS256'};
 const id=await new SignJWT({nonce,email:'owner@example.test',email_verified:true}).setProtectedHeader({alg:'RS256',kid:'fixture'}).setIssuer('https://accounts.zoho.com').setAudience('synthetic-client').setSubject('zoho-owner').setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
 return vi.fn(async(url:any,init:any)=>{
  expect(init.redirect).toBe('manual');expect(String(url)).not.toContain('synthetic-secret');
  if(String(url).endsWith('/keys'))return Response.json({keys:[key]});
  expect(String(url)).toBe('https://accounts.zoho.com/oauth/v2/token');expect(init.body.get('code_verifier')).toHaveLength(64);
  return Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh',id_token:id,expires_in:3600,token_type:'Bearer',scope});
 }) as unknown as typeof fetch;
}
it('uses offline PKCE consent and binds encrypted Zoho credentials to the current user and tenant',async()=>{
 const f=await fixture();expect(f.url.origin).toBe('https://accounts.zoho.com');expect(f.url.searchParams.get('code_challenge_method')).toBe('S256');expect(f.url.searchParams.get('access_type')).toBe('offline');expect(f.url.searchParams.has('client_secret')).toBe(false);
 const transport=await provider(f.url.searchParams.get('nonce')!);
 expect((await finishZoho(f.callback,f.env,f.session,transport)).headers.get('location')).toBe(f.env.APP_ORIGIN+'/?connected=zoho');
 const row=await f.env.AGENT_DB.prepare("SELECT * FROM auth_provider_grants WHERE provider='zoho' AND user_id=?").bind(f.userId).first<any>();
 expect(row.status).toBe('authorized');expect(row.tenant_scope).toBe(f.tenantId);expect(row.ciphertext).not.toContain('fixture-access');
 expect((await decryptCredential(row.ciphertext,{userId:f.userId,tenantId:f.tenantId,provider:'zoho',accountId:'us:zoho-owner'},f.env.TOKEN_ENCRYPTION_KEY!)).zohoRegion).toBe('us');
 expect((await finishZoho(f.callback,f.env,f.session,transport)).headers.get('location')).toContain('auth_error');expect(transport).toHaveBeenCalledTimes(2);
});
it('rejects cross-session callbacks without contacting Zoho',async()=>{
 const f=await fixture(),transport=vi.fn();
 expect((await finishZoho(f.callback,f.env,{...f.session,session:{id:'other'}},transport as any)).headers.get('location')).toContain('auth_error');expect(transport).not.toHaveBeenCalled();
});
it('rejects arbitrary callback account hosts before sending credentials',async()=>{
 const f=await fixture(),url=new URL(f.callback.url),transport=vi.fn();url.searchParams.set('accounts-server','https://evil.example');
 expect((await finishZoho(new Request(url),f.env,f.session,transport as any)).headers.get('location')).toContain('auth_error');expect(transport).not.toHaveBeenCalled();
});
it('does not grant requested permissions missing from the actual token scopes',async()=>{
 const f=await fixture(),transport=await provider(f.url.searchParams.get('nonce')!,'openid,email');
 expect((await finishZoho(f.callback,f.env,f.session,transport)).headers.get('location')).toContain('auth_error');
 expect(await f.env.AGENT_DB.prepare("SELECT id FROM auth_provider_grants WHERE user_id=?").bind(f.userId).first()).toBeNull();
});
it('rejects an ID token with the wrong nonce',async()=>{
 const f=await fixture();expect((await finishZoho(f.callback,f.env,f.session,await provider('wrong'))).headers.get('location')).toContain('auth_error');
});
it('checks membership again before token exchange',async()=>{
 const f=await fixture(),transport=vi.fn();await f.env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=?").bind(f.tenantId).run();
 expect((await finishZoho(f.callback,f.env,f.session,transport as any)).headers.get('location')).toContain('auth_error');expect(transport).not.toHaveBeenCalled();
});
