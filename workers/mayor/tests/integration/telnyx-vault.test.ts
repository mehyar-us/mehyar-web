import {env as testEnv} from 'cloudflare:workers';
import {it,expect,vi} from 'vitest';
import type {Env} from '../../src/env';
import {storeTelnyxOAuth,telnyxOAuthAccess} from '../../src/auth/telnyx-vault';
import {sealPhoneCredential} from '../../src/phone-connections';
import {disconnectTelnyx} from '../../src/telnyx-connections';
import type {TelnyxOAuthConfig} from '../../src/auth/telnyx-protocol';
const env=testEnv as unknown as Env;
const config:TelnyxOAuthConfig={clientId:'fixture',clientSecret:'secret',redirectUri:'https://mayor.mehyar.us/api/auth/callback/telnyx',scopes:['numbers.read','voice.read']};
const tokens=()=>({accessToken:'access-fixture',refreshToken:'refresh-fixture',expiresAt:Date.now()+3600000,scopes:['numbers.read','voice.read']});
async function fixture(){
 const actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'OAuth vault fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
 await storeTelnyxOAuth(env,actor,0,tokens(),config);
 const read=()=>env.AGENT_DB.prepare("SELECT * FROM mayor_phone_connections WHERE tenant_id=? AND provider='telnyx'").bind(actor.tenantId).first<any>();
 const expire=async()=>{const row=await read();const ciphertext=await sealPhoneCredential(env,actor,'telnyx',row.account_id,{kind:'oauth',clientId:config.clientId,tokens:{...tokens(),expiresAt:Date.now()-1}});await env.AGENT_DB.prepare('UPDATE mayor_phone_connections SET ciphertext=? WHERE id=?').bind(ciphertext,row.id).run();return read();};
 return {actor,read,expire};
}
const refresh=()=>vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({access_token:'new-access',refresh_token:'new-refresh',token_type:'Bearer',expires_in:3600,scope:'numbers.read voice.read'})).mockResolvedValueOnce(Response.json({active:true,client_id:config.clientId,scope:'numbers.read voice.read',exp:Math.floor(Date.now()/1000)+3600}));
it('encrypts tokens and rejects a stale consent overwrite',async()=>{
 const f=await fixture(),row=await f.read(),fetcher=vi.fn<typeof fetch>();
 expect(JSON.stringify(row)).not.toContain('access-fixture');expect(JSON.stringify(row)).not.toContain('refresh-fixture');
 expect(await telnyxOAuthAccess(env,f.actor,row,config,fetcher)).toBe('access-fixture');expect(fetcher).not.toHaveBeenCalled();
 await expect(storeTelnyxOAuth(env,f.actor,0,tokens(),config)).rejects.toMatchObject({code:'connection_changed'});
 expect(await f.read()).toEqual(row);
});
it('rotates the encrypted grant once while preserving connection revision',async()=>{
 const f=await fixture(),row=await f.expire(),fetcher=refresh();
 expect(await telnyxOAuthAccess(env,f.actor,row,config,fetcher)).toBe('new-access');
 const updated=await f.read();expect(updated.revision).toBe(row.revision);expect(updated.ciphertext).not.toBe(row.ciphertext);
 expect(await telnyxOAuthAccess(env,f.actor,updated,config,fetcher)).toBe('new-access');expect(fetcher).toHaveBeenCalledTimes(2);
 expect(await env.AGENT_DB.prepare('SELECT * FROM mayor_phone_oauth_refresh WHERE connection_id=?').bind(row.id).first()).toBeNull();
});
it('serializes concurrent refresh attempts',async()=>{
 const f=await fixture(),row=await f.expire();let release!:()=>void;const barrier=new Promise<void>(r=>release=r),base=refresh();
 const fetcher=vi.fn<typeof fetch>().mockImplementation(async(...args)=>{await barrier;return base(...args);});
 const first=telnyxOAuthAccess(env,f.actor,row,config,fetcher);
 // Let the first request reach the provider without using timing sleeps.
 await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));
 await expect(telnyxOAuthAccess(env,f.actor,row,config,fetcher)).rejects.toMatchObject({code:'phone_refresh_pending'});
 release();await expect(first).resolves.toBe('new-access');expect(fetcher).toHaveBeenCalledTimes(2);
});
it('never retries an ambiguous refresh',async()=>{
 const f=await fixture(),row=await f.expire(),fetcher=vi.fn<typeof fetch>().mockRejectedValue(new Error('private-token'));
 await expect(telnyxOAuthAccess(env,f.actor,row,config,fetcher)).rejects.toMatchObject({code:'reconnect_required'});
 await expect(telnyxOAuthAccess(env,f.actor,row,config,fetcher)).rejects.toMatchObject({code:'reconnect_required'});
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(['disconnect','reconnect','revocation'])('cannot restore access after %s during refresh',async change=>{
 const f=await fixture(),row=await f.expire(),base=refresh();let changed=false;
 const fetcher=vi.fn<typeof fetch>().mockImplementation(async(...args)=>{
  if(!changed){changed=true;
   if(change==='disconnect')await disconnectTelnyx(env,f.actor);
   if(change==='reconnect')await storeTelnyxOAuth(env,f.actor,row.revision,tokens(),config);
   if(change==='revocation')await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=?").bind(f.actor.tenantId).run();
  }return base(...args);
 });
 await expect(telnyxOAuthAccess(env,f.actor,row,config,fetcher)).rejects.toMatchObject({code:'reconnect_required'});
 const updated=await f.read();
 if(change==='disconnect')expect(updated.status).toBe('revoked');
 if(change==='reconnect')expect(await telnyxOAuthAccess(env,f.actor,updated,config)).toBe('access-fixture');
 if(change==='revocation')expect(updated.ciphertext).toBe(row.ciphertext);
});
it('rejects another tenant and revoked membership before using a cached token',async()=>{
 const f=await fixture(),other=await fixture(),row=await f.read(),fetcher=vi.fn<typeof fetch>();
 await expect(telnyxOAuthAccess(env,other.actor,row,config,fetcher)).rejects.toThrow();
 await env.AGENT_DB.prepare("UPDATE agent_memberships SET role='viewer' WHERE tenant_id=?").bind(f.actor.tenantId).run();
 await expect(telnyxOAuthAccess(env,f.actor,row,config,fetcher)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
});
