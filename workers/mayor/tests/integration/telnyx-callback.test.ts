import {env as testEnv} from 'cloudflare:workers';
import {it,expect,vi} from 'vitest';
import type {Env} from '../../src/env';
import {startTelnyxConsent} from '../../src/auth/phone-oauth-state';
import {finishTelnyxConsent} from '../../src/auth/telnyx-callback';
import {telnyxOAuthConfig} from '../../src/auth/telnyx-vault';
import {telnyxNumbers,selectTelnyxNumber} from '../../src/telnyx-connections';
const env={...testEnv,TELNYX_OAUTH_ENABLED:'true',TELNYX_CLIENT_ID:'fixture',TELNYX_CLIENT_SECRET:'secret',TELNYX_OAUTH_SCOPES:'numbers.read voice.read'} as unknown as Env;
const number={id:'12345',phone_number:'+12025550109',status:'active'};
async function fixture(){
 const actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()},session={user:{id:actor.userId},session:{id:crypto.randomUUID()}};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Consent callback fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
 const config=telnyxOAuthConfig(env),{url}=await startTelnyxConsent(new Request(env.APP_ORIGIN,{headers:{origin:env.APP_ORIGIN}}),env,session,actor.tenantId,config);
 const request=new Request(config.redirectUri+'?'+new URLSearchParams({state:new URL(url).searchParams.get('state')!,code:'fixture-code'}));
 const transport=vi.fn<typeof fetch>().mockImplementation(async input=>{
  const url=new URL(String(input));
  if(url.pathname.endsWith('/token'))return Response.json({access_token:'access-fixture',refresh_token:'refresh-fixture',expires_in:3600,token_type:'Bearer',scope:'numbers.read voice.read'});
  if(url.pathname.endsWith('/introspect'))return Response.json({active:true,client_id:config.clientId,scope:'numbers.read voice.read',exp:Math.floor(Date.now()/1000)+3600});
  return Response.json(url.search?{data:[number],meta:{page_number:1,total_pages:1}}:{data:number});
 });
 return {actor,session,request,transport};
}
it('completes consent, discovery and encrypted storage then lists/selects without manual keys',async()=>{
 const f=await fixture(),response=await finishTelnyxConsent(f.request,env,f.session,f.transport);
 expect(new URL(response.headers.get('location')!).searchParams.get('connected')).toBe('telnyx');
 expect(response.headers.get('referrer-policy')).toBe('no-referrer');
 expect((await telnyxNumbers(env,f.actor,f.transport)).numbers[0].number).toBe(number.phone_number);
 expect(await selectTelnyxNumber(env,f.actor,number.id,f.transport)).toMatchObject({selected:true,callsReady:false});
 const before=f.transport.mock.calls.length;
 const replay=await finishTelnyxConsent(f.request,env,f.session,f.transport);
 expect(new URL(replay.headers.get('location')!).searchParams.has('auth_error')).toBe(true);expect(f.transport).toHaveBeenCalledTimes(before);
});
it('does not persist a grant if number discovery fails',async()=>{
 const f=await fixture(),base=f.transport;
 const transport=vi.fn<typeof fetch>().mockImplementation((input,init)=>String(input).includes('/phone_numbers')?Promise.resolve(new Response('provider-secret',{status:403})):base(input,init));
 const response=await finishTelnyxConsent(f.request,env,f.session,transport);
 expect(new URL(response.headers.get('location')!).searchParams.has('auth_error')).toBe(true);
 expect(await env.AGENT_DB.prepare('SELECT id FROM mayor_phone_connections WHERE tenant_id=?').bind(f.actor.tenantId).first()).toBeNull();
});
it('keeps the provider unavailable without an explicitly enabled app',()=>{
 expect(()=>telnyxOAuthConfig({...env,TELNYX_OAUTH_ENABLED:undefined})).toThrow();
 expect(()=>telnyxOAuthConfig({...env,TELNYX_OAUTH_SCOPES:''})).toThrow();
 expect(()=>telnyxOAuthConfig({...env,TELNYX_OAUTH_SCOPES:'admin'})).toThrow();
 expect(()=>telnyxOAuthConfig({...env,TELNYX_OAUTH_SCOPES:'numbers.read voice.read billing.read'})).toThrow();
 expect(telnyxOAuthConfig(env).scopes).toEqual(['numbers.read','voice.read']);
});
