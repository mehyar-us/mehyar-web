import {env as testEnv} from 'cloudflare:workers';
import {it,expect,describe} from 'vitest';
import type {Actor,Env} from '../../src/env';
import {createAuth} from '../../src/auth';
import {encryptCredential} from '../../src/auth/vault';
import {selectCalendar} from '../../src/calendars';
import {confirmSchedulingPolicy} from '../../src/scheduling-policy';
import {findAvailability} from '../../src/availability';
const env=testEnv as unknown as Env;
async function fixture(provider:'google'|'microsoft'){
 const user=await (await createAuth(env).$context).internalAdapter.createUser({email:`${crypto.randomUUID()}@example.test`,name:'Fixture',emailVerified:true});
 const actor:Actor={tenantId:crypto.randomUUID(),userId:user.id};
 const now=new Date().toISOString(),grantId=crypto.randomUUID();
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Availability fixture',now).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
 const policy={timeZone:'UTC',weeklyHours:Array.from({length:7},(_,day)=>({day,startMinute:0,endMinute:1440})),closedDates:[],appointmentTypes:[{name:'Visit',durationMinutes:30,bufferBeforeMinutes:15,bufferAfterMinutes:15}],staff:[],minimumNoticeMinutes:0,maximumAdvanceDays:30,cancellationNoticeMinutes:0};
 await confirmSchedulingPolicy(env,actor,policy,0);
 const scopes=provider==='google'?['https://www.googleapis.com/auth/calendar']:['Calendars.ReadWrite'];
 const ciphertext=await encryptCredential({accountEmail:'fixture@example.test',accessToken:'fixture-token',accessTokenExpiresAt:new Date(Date.now()+3600000).toISOString(),grantedScopes:scopes},{...actor,provider,accountId:grantId},env.TOKEN_ENCRYPTION_KEY!);
 await env.AGENT_DB.prepare(`INSERT INTO auth_provider_grants(id,user_id,provider,account_id,tenant_scope,ciphertext,granted_scopes,selected_capabilities,status,updated_at) VALUES(?,?,?,?,?,?,?,?,'authorized',?)`).bind(grantId,user.id,provider,grantId,actor.tenantId,ciphertext,JSON.stringify(scopes),'["calendar_manage"]',now).run();
 const start=Math.ceil((Date.now()+86400000)/900000)*900000;
 const iso=(delta:number)=>new Date(start+delta*60000).toISOString();
 const input={start:iso(0),end:iso(180),appointmentType:'Visit',limit:5};
 let effect:undefined|(()=>Promise<unknown>),broken=false,paginate=false,repeat=false,reads=0;
 const transport=(async(url:RequestInfo|URL,init?:RequestInit)=>{
  const target=new URL(String(url));
  if(target.pathname.endsWith('/calendarList'))return Response.json({items:[{id:'calendar',summary:'Calendar',accessRole:'owner'}]});
  if(target.pathname.endsWith('/calendars'))return Response.json({value:[{id:'calendar',name:'Calendar',canEdit:true}]});
  expect(init?.signal).toBeDefined();reads++;
  if(effect){const fn=effect;effect=undefined;await fn();}
  if(provider==='google'){
   expect(target.pathname).toBe('/calendar/v3/freeBusy');expect(init?.method).toBe('POST');
   const body=JSON.parse(String(init?.body));expect(body.timeMin).toBe(iso(-15));expect(body.timeMax).toBe(iso(195));
   return Response.json({calendars:{calendar:broken?{errors:[{reason:'notFound'}]}:{busy:[{start:iso(0),end:iso(30)}]}}});
  }
  expect(target.pathname).toBe('/v1.0/me/calendars/calendar/calendarView');expect(init?.method??'GET').toBe('GET');
  if(broken)return Response.json({value:[{start:{dateTime:'invalid',timeZone:'UTC'},end:{dateTime:iso(30),timeZone:'UTC'},showAs:'busy'}]});
  const next='https://graph.microsoft.com/v1.0/me/calendars/calendar/calendarView?$skiptoken=page2';
  const second=target.searchParams.has('$skiptoken');
  return Response.json({value:second?[{id:'busy',start:{dateTime:iso(0),timeZone:'UTC'},end:{dateTime:iso(30),timeZone:'UTC'},showAs:'busy'}]:paginate?[]:[{id:'busy',start:{dateTime:iso(0),timeZone:'UTC'},end:{dateTime:iso(30),timeZone:'UTC'},showAs:'busy'}],...(paginate&&(!second||repeat)?{'@odata.nextLink':next}:{})});
 }) as typeof fetch;
 await selectCalendar(env,actor,{provider,grantId,calendarId:'calendar'},transport);
 return {actor,grantId,input,transport,iso,policy,reads:()=>reads,setEffect:(fn:()=>Promise<unknown>)=>{effect=fn;},break:()=>{broken=true;},pages:(loop=false)=>{paginate=true;repeat=loop;}};
}
describe.each(['google','microsoft'] as const)('%s live availability search',provider=>{
 it('combines provider busy time and unresolved reservations without calendar writes or event disclosure',async()=>{
  const f=await fixture(provider),now=new Date().toISOString();
  await env.AGENT_DB.prepare(`INSERT INTO mayor_appointment_jobs(id,tenant_id,actor_id,provider,grant_id,calendar_id,authorization_stamp,policy_revision,input_json,reserved_start,reserved_end,state,expires_at,created_at,updated_at)
  VALUES(?,?,?,?,?,'calendar','fixture',1,'{}',?,?,'uncertain',?,?,?)`).bind(crypto.randomUUID(),f.actor.tenantId,f.actor.userId,provider,f.grantId,f.iso(30),f.iso(60),now,now,now).run();
  const result=await findAvailability(env,f.actor,f.input,f.transport);
  expect(result.held).toBe(false);expect(result.slots[0].start).toBe(f.iso(75));expect(result.slots[0].localStart).toContain('GMT');
  expect(JSON.stringify(result)).not.toContain('fixture-token');expect(result).not.toHaveProperty('busy');
  expect(f.reads()).toBe(1);
 });
 it('refuses cross-tenant access before contacting the provider',async()=>{
  const f=await fixture(provider);
  await expect(findAvailability(env,{...f.actor,userId:crypto.randomUUID()},f.input,f.transport)).rejects.toThrow();expect(f.reads()).toBe(0);
 });
 it('fails closed on malformed or incomplete provider results',async()=>{
  const f=await fixture(provider);f.break();await expect(findAvailability(env,f.actor,f.input,f.transport)).rejects.toThrow();
 });
 it.each(['policy','grant','membership','calendar'] as const)('rejects a %s change while the provider request is in flight',async changed=>{
  const f=await fixture(provider);
  f.setEffect(async()=>{
   if(changed==='policy')return confirmSchedulingPolicy(env,f.actor,{...f.policy,minimumNoticeMinutes:60},1);
   if(changed==='grant')return env.AGENT_DB.prepare("UPDATE auth_provider_grants SET status='revoked' WHERE id=?").bind(f.grantId).run();
   if(changed==='membership')return env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=?").bind(f.actor.tenantId).run();
   return env.AGENT_DB.prepare("UPDATE mayor_calendar_selection SET calendar_id='another' WHERE tenant_id=?").bind(f.actor.tenantId).run();
  });
  await expect(findAvailability(env,f.actor,f.input,f.transport)).rejects.toThrow();
 });
});
it('reads later Microsoft pages and rejects repeating cursors',async()=>{
 const f=await fixture('microsoft');f.pages();
 const result=await findAvailability(env,f.actor,f.input,f.transport);expect(result.slots[0].start).toBe(f.iso(45));expect(f.reads()).toBe(2);
 f.pages(true);await expect(findAvailability(env,f.actor,f.input,f.transport)).rejects.toThrow('fully checked');
});
