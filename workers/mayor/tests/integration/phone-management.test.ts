import {it,expect,vi} from 'vitest';
import {env as testEnv} from 'cloudflare:workers';
import type {Env} from '../../src/env';
import {manageVoiceApplication} from '../../src/phone-management';
import {sealPhoneCredential} from '../../src/phone-connections';
const env=testEnv as unknown as Env;
async function fixture(provider:'telnyx'|'twilio',readOnly=false){
 const actor={tenantId:crypto.randomUUID().replaceAll('-',''),userId:crypto.randomUUID()},id=crypto.randomUUID(),account=provider==='twilio'?'AC'+'a'.repeat(32):crypto.randomUUID();
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Management fixture','now').run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
 const configured={...env,TELNYX_OAUTH_ENABLED:'true',TELNYX_CLIENT_ID:'client',TELNYX_CLIENT_SECRET:'secret',TELNYX_OAUTH_SCOPES:'numbers.read voice.read'};
 const value=provider==='twilio'?{accountSid:account,apiKeySid:'SK'+'a'.repeat(32),apiKeySecret:'secret'.repeat(5)}:readOnly?{kind:'oauth',clientId:'client',tokens:{accessToken:'access',refreshToken:'refresh',expiresAt:Date.now()+3600000,scopes:['numbers.read','voice.read']}}:{apiKey:'test-secret-'.repeat(3)};
 const ciphertext=await sealPhoneCredential(env,actor,provider,account,value);
 await env.AGENT_DB.prepare("INSERT INTO mayor_phone_connections(id,tenant_id,provider,account_id,owner_user_id,ciphertext,status,verified_at,updated_at) VALUES(?,?,?,?,?,?,'authorized','now','now')").bind(id,actor.tenantId,provider,account,actor.userId,ciphertext).run();
 const callback=`${env.APP_ORIGIN}/api/phone/${provider}/incoming/${actor.tenantId}`;
 const app=provider==='telnyx'?{id:'123',application_name:'The Mayor',webhook_event_url:callback,active:true,webhook_api_version:'2'}:{sid:'AP'+'b'.repeat(32),account_sid:account,friendly_name:'The Mayor',voice_url:callback,voice_method:'POST'};
 const list=(items:unknown[])=>provider==='telnyx'?{data:items,meta:{page_number:1,total_pages:1}}:{applications:items,next_page_uri:null};
 return {actor,configured,app,list,callback,id};
}
it.each(['telnyx','twilio'] as const)('reads existing %s app without mutations or credentials in response',async provider=>{
 const f=await fixture(provider),transport=vi.fn<typeof fetch>().mockResolvedValue(Response.json(f.list([f.app])));
 const result=await manageVoiceApplication(f.configured,f.actor,provider,true,transport);
 expect(result.stage).toBe('application_prepared');expect(result.callsReady).toBe(false);expect(result.routingChanged).toBe(false);expect(transport).toHaveBeenCalledTimes(1);expect(transport.mock.calls[0][1]?.method).toBe('GET');expect(JSON.stringify(result)).not.toMatch(/secret|authorization|ciphertext/);
});
it.each(['telnyx','twilio'] as const)('prepares %s once and never repeats an uncertain provider write',async provider=>{
 const f=await fixture(provider),transport=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(f.list([]))).mockRejectedValueOnce(Error('timeout'));
 await expect(manageVoiceApplication(f.configured,f.actor,provider,true,transport)).rejects.toThrow('could not be confirmed');
 const retry=vi.fn<typeof fetch>().mockResolvedValue(Response.json(f.list([])));
 await expect(manageVoiceApplication(f.configured,f.actor,provider,true,retry)).rejects.toThrow('earlier setup');expect(retry).toHaveBeenCalledTimes(1);
 expect((await env.AGENT_DB.prepare('SELECT state FROM mayor_voice_application_operations WHERE tenant_id=?').bind(f.actor.tenantId).first<any>()).state).toBe('uncertain');
});
it.each(['telnyx','twilio'] as const)('creates %s app with tenant callback and no number or outbound call mutation',async provider=>{
 const f=await fixture(provider),transport=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(f.list([]))).mockResolvedValueOnce(Response.json(provider==='telnyx'?{data:f.app}:f.app));
 expect((await manageVoiceApplication(f.configured,f.actor,provider,true,transport)).stage).toBe('application_prepared');
 expect(transport).toHaveBeenCalledTimes(2);expect(transport.mock.calls[1][0]).toMatch(/applications|Applications/);expect(transport.mock.calls[1][1]?.method).toBe('POST');
 const body=String(transport.mock.calls[1][1]?.body);expect(decodeURIComponent(body)).toContain(f.callback);expect(body).not.toContain('phone_number');
});
it('rejects a read-only Telnyx grant before dispatching a write',async()=>{
 const f=await fixture('telnyx',true),transport=vi.fn<typeof fetch>().mockResolvedValue(Response.json(f.list([])));
 await expect(manageVoiceApplication(f.configured,f.actor,'telnyx',true,transport)).rejects.toThrow('voice-management permission');expect(transport).toHaveBeenCalledTimes(1);
});
it('rejects another business user before accessing credentials',async()=>{
 const f=await fixture('telnyx'),transport=vi.fn<typeof fetch>();
 await expect(manageVoiceApplication(f.configured,{...f.actor,userId:crypto.randomUUID()},'telnyx',true,transport)).rejects.toThrow();expect(transport).not.toHaveBeenCalled();
});
it('rechecks revocation between discovery and creation',async()=>{
 const f=await fixture('telnyx'),transport=vi.fn<typeof fetch>().mockImplementation(async()=>{await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=?").bind(f.actor.tenantId).run();return Response.json(f.list([]));});
 await expect(manageVoiceApplication(f.configured,f.actor,'telnyx',true,transport)).rejects.toThrow();expect(transport).toHaveBeenCalledTimes(1);
});
it('rejects incomplete application listings rather than creating duplicates',async()=>{
 const f=await fixture('telnyx'),transport=vi.fn<typeof fetch>().mockResolvedValue(Response.json({data:[],meta:{page_number:1,total_pages:2}}));
 await expect(manageVoiceApplication(f.configured,f.actor,'telnyx',true,transport)).rejects.toThrow();expect(transport).toHaveBeenCalledTimes(1);
});
