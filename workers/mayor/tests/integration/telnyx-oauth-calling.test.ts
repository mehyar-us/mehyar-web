import {env as testEnv} from 'cloudflare:workers';
import {it,expect,vi} from 'vitest';
import type {Env} from '../../src/env';
import {sealPhoneCredential,unsealPhoneCredential} from '../../src/phone-connections';
import {telnyxCallCredential,telnyxWebhookConnection,disconnectTelnyx} from '../../src/telnyx-connections';
const env={...testEnv,TELNYX_OAUTH_ENABLED:'true',TELNYX_CLIENT_ID:'fixture',TELNYX_CLIENT_SECRET:'secret',TELNYX_OAUTH_SCOPES:'numbers.read voice.read'} as unknown as Env;
const scopes=['numbers.read','voice.read','voice.write','verify.write'];
async function fixture(expired=false,granted=scopes){
 const actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()},id=crypto.randomUUID(),account=crypto.randomUUID();
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'OAuth calling fixture','now').run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
 const inbound={publicKey:'A'.repeat(43)+'=',applicationId:'123',testCaller:'+12025550101'};
 const value={kind:'oauth',clientId:'fixture',inbound,tokens:{accessToken:'cached-access',refreshToken:'refresh-secret',expiresAt:Date.now()+(expired?-1000:3600000),scopes:granted}};
 const ciphertext=await sealPhoneCredential(env,actor,'telnyx',account,value);
 await env.AGENT_DB.prepare("INSERT INTO mayor_phone_connections(id,tenant_id,provider,account_id,owner_user_id,ciphertext,status,revision,selected_number_id,selected_number,verified_at,updated_at) VALUES(?,?,'telnyx',?,?,?,'authorized',3,'123','+12025550102','now','now')").bind(id,actor.tenantId,account,actor.userId,ciphertext).run();
 return {actor,id,inbound,value,account};
}
const refresh=()=>vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({access_token:'renewed-access',refresh_token:'renewed-refresh',token_type:'Bearer',expires_in:3600,scope:scopes.join(' ')})).mockResolvedValueOnce(Response.json({active:true,client_id:'fixture',scope:scopes.join(' '),exp:Math.floor(Date.now()/1000)+3600}));
it('reads signature metadata without refreshing an expired OAuth token',async()=>{
 const f=await fixture(true),network=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('must not call provider'));
 try{expect((await telnyxWebhookConnection(env,f.actor.tenantId)).inbound).toEqual(f.inbound);expect(network).not.toHaveBeenCalled();}finally{network.mockRestore();}
});
it.each(['voice.read','voice.write','verify.write'] as const)('resolves cached OAuth for %s without network access',async scope=>{
 const f=await fixture(),transport=vi.fn<typeof fetch>();
 expect(await telnyxCallCredential(env,f.actor.tenantId,3,scope,transport)).toEqual({apiKey:'cached-access',inbound:f.inbound});expect(transport).not.toHaveBeenCalled();
});
it('preserves inbound settings and revision across token refresh',async()=>{
 const f=await fixture(true),transport=refresh();
 expect((await telnyxCallCredential(env,f.actor.tenantId,3,'voice.write',transport)).apiKey).toBe('renewed-access');
 const row=await env.AGENT_DB.prepare('SELECT * FROM mayor_phone_connections WHERE id=?').bind(f.id).first<any>();
 expect(row.revision).toBe(3);expect((await unsealPhoneCredential(env,row,'telnyx') as any).inbound).toEqual(f.inbound);expect(transport).toHaveBeenCalledTimes(2);
});
it('rejects missing management permission before a refresh or command',async()=>{
 const f=await fixture(true,['numbers.read','voice.read']),transport=vi.fn<typeof fetch>();
 await expect(telnyxCallCredential(env,f.actor.tenantId,3,'voice.write',transport)).rejects.toMatchObject({code:'phone_scope_required'});expect(transport).not.toHaveBeenCalled();
});
it('rejects stale call revisions and changed OAuth clients without network traffic',async()=>{
 const f=await fixture(),transport=vi.fn<typeof fetch>();
 await expect(telnyxCallCredential(env,f.actor.tenantId,2,'voice.write',transport)).rejects.toMatchObject({code:'connection_changed'});
 await expect(telnyxCallCredential({...env,TELNYX_CLIENT_ID:'another'},f.actor.tenantId,3,'voice.write',transport)).rejects.toMatchObject({code:'reconnect_required'});expect(transport).not.toHaveBeenCalled();
});
it('does not return a renewed token after disconnect during refresh',async()=>{
 const f=await fixture(true),base=refresh();let changed=false;
 const transport=vi.fn<typeof fetch>().mockImplementation(async(...args)=>{if(!changed){changed=true;await disconnectTelnyx(env,f.actor);}return base(...args);});
 await expect(telnyxCallCredential(env,f.actor.tenantId,3,'voice.write',transport)).rejects.toThrow();
 expect((await env.AGENT_DB.prepare('SELECT status,ciphertext FROM mayor_phone_connections WHERE id=?').bind(f.id).first<any>())).toEqual({status:'revoked',ciphertext:''});
});
it('rejects a required scope removed by a successful refresh',async()=>{
 const f=await fixture(true),limited='numbers.read voice.read';
 const transport=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({access_token:'limited',refresh_token:'new',token_type:'Bearer',expires_in:3600,scope:limited})).mockResolvedValueOnce(Response.json({active:true,client_id:'fixture',scope:limited,exp:Math.floor(Date.now()/1000)+3600}));
 await expect(telnyxCallCredential(env,f.actor.tenantId,3,'voice.write',transport)).rejects.toMatchObject({code:'phone_scope_required'});expect(transport).toHaveBeenCalledTimes(2);
});
import {saveTelnyxCallSetup} from '../../src/telnyx-connections';
it('saves reviewed OAuth test settings without routing changes and invalidates old call revisions',async()=>{
 const f=await fixture(),input={...f.inbound,testCaller:'+12025550103',confirm:'save_test_setup' as const};
 const transport=vi.fn<typeof fetch>().mockImplementation(async url=>Response.json({data:String(url).includes('/call_control_applications/')?{id:'123',active:true,record_type:'call_control_application',webhook_api_version:'2',webhook_event_url:`${env.APP_ORIGIN}/api/phone/telnyx/incoming/${f.actor.tenantId}`}:{id:'123',phone_number:'+12025550102',status:'active',connection_id:'123'}}));
 expect(await saveTelnyxCallSetup(env,f.actor,input,transport)).toMatchObject({saved:true,callsReady:false,routingChanged:false});
 expect(transport.mock.calls.every(([,init])=>init?.method==='GET')).toBe(true);
 const row=await env.AGENT_DB.prepare('SELECT * FROM mayor_phone_connections WHERE id=?').bind(f.id).first<any>();
 expect(row.revision).toBe(4);const value=await unsealPhoneCredential(env,row,'telnyx') as any;
 expect(value.kind).toBe('oauth');expect(value.tokens.accessToken).toBe('cached-access');expect(value.inbound.testCaller).toBe(input.testCaller);
 await expect(telnyxCallCredential(env,f.actor.tenantId,3,'voice.write',transport)).rejects.toMatchObject({code:'connection_changed'});
});
it.each(['wrong_callback','number_moved','revoked','reconnected'])('does not save setup when %s',async issue=>{
 const f=await fixture();let changed=false;
 const transport=vi.fn<typeof fetch>().mockImplementation(async url=>{
  if(!changed){changed=true;
   if(issue==='revoked')await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=?").bind(f.actor.tenantId).run();
   if(issue==='reconnected')await env.AGENT_DB.prepare('UPDATE mayor_phone_connections SET revision=revision+1 WHERE id=?').bind(f.id).run();
  }
  return Response.json({data:String(url).includes('/call_control_applications/')?{id:'123',active:true,record_type:'call_control_application',webhook_api_version:'2',webhook_event_url:issue==='wrong_callback'?'https://other.example/':`${env.APP_ORIGIN}/api/phone/telnyx/incoming/${f.actor.tenantId}`}:{id:'123',phone_number:'+12025550102',status:'active',connection_id:issue==='number_moved'?'999':'123'}});
 });
 await expect(saveTelnyxCallSetup(env,f.actor,{...f.inbound,testCaller:'+12025550103',confirm:'save_test_setup'},transport)).rejects.toThrow();
 const row=await env.AGENT_DB.prepare('SELECT * FROM mayor_phone_connections WHERE id=?').bind(f.id).first<any>();
 expect((await unsealPhoneCredential(env,row,'telnyx') as any).inbound).toEqual(f.inbound);
 expect((await env.AGENT_DB.prepare("SELECT id FROM mayor_audit WHERE tenant_id=? AND event='phone.test_setup_saved'").bind(f.actor.tenantId).all()).results).toHaveLength(0);
});
