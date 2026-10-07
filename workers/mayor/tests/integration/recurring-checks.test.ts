import {env as testEnv} from 'cloudflare:workers';
import {it,expect} from 'vitest';
import type {Env} from '../../src/env';
import {prepareRecurringCheck,confirmRecurringCheck,readRecurringCheck,pauseRecurringCheck,runRecurringChecks,checkAccountNow} from '../../src/recurring-checks';
import {listNotifications,refreshAttentionNotifications} from '../../src/notifications';
import {MayorVoice} from '../../src/voice';
import {createAuth} from '../../src/auth';
import {encryptCredential} from '../../src/auth/vault';
import {selectCalendar} from '../../src/calendars';
import {confirmProfile} from '../../src/memory';
const env=testEnv as unknown as Env,schedule={timeZone:'UTC',frequency:'daily' as const,hour:8,minute:0};
async function fixture(){
 const actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Recurring check fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
 const proposal=await prepareRecurringCheck(env,actor,{enabled:true,schedule});
 return {actor,proposal};
}
async function due(actor:{tenantId:string;userId:string}){
 const now=Date.now(),at=new Date(now-1000).toISOString();
 await env.AGENT_DB.prepare("UPDATE mayor_recurring_checks SET next_run_at=?,due_local_date='2000-01-01' WHERE tenant_id=? AND user_id=?").bind(at,actor.tenantId,actor.userId).run();
 return now;
}
it('does not enable a proposal and rejects stale or expired confirmations',async()=>{
 const f=await fixture();expect((await readRecurringCheck(env,f.actor)).enabled).toBe(false);
 await expect(confirmRecurringCheck(env,f.actor,{...f.proposal,expiresAt:0})).rejects.toThrow();
 await confirmRecurringCheck(env,f.actor,f.proposal);
 await expect(confirmRecurringCheck(env,f.actor,f.proposal)).rejects.toThrow();
 expect((await readRecurringCheck(env,f.actor)).revision).toBe(1);
 const audit=await env.AGENT_DB.prepare("SELECT event FROM mayor_audit WHERE tenant_id=? AND event='recurring_check.enabled'").bind(f.actor.tenantId).all();expect(audit.results).toHaveLength(1);
});
it('executes one due occurrence despite concurrent cron deliveries and persists its result',async()=>{
 const f=await fixture();await confirmRecurringCheck(env,f.actor,f.proposal);const now=await due(f.actor);
 let calls=0;const options={now,check:async()=>{calls++;}};
 await Promise.all([runRecurringChecks(env,options),runRecurringChecks(env,options)]);
 expect(calls).toBe(1);
 expect((await readRecurringCheck(env,f.actor)).lastStatus).toBe('ok');
 const runs=await env.AGENT_DB.prepare('SELECT * FROM mayor_check_runs WHERE tenant_id=?').bind(f.actor.tenantId).all();expect(runs.results).toHaveLength(1);
 await pauseRecurringCheck(env,f.actor);
});
it('runs the real local onboarding check without inventing a calendar connection',async()=>{
 const f=await fixture();await confirmRecurringCheck(env,f.actor,f.proposal);const now=await due(f.actor);
 await runRecurringChecks(env,{now});
 expect((await listNotifications(env,f.actor)).notifications[0].action).toBe('chat');
 expect((await readRecurringCheck(env,f.actor)).lastStatus).toBe('ok');
 await pauseRecurringCheck(env,f.actor);
});
it.each([
 ['pause','create'],['edit','create'],['pause','reopen'],['edit','reopen'],['pause','resolve'],['edit','resolve'],
] as const)('discards %s schedule results before an alert can %s',async(change,operation)=>{
 const f=await fixture();await confirmRecurringCheck(env,f.actor,f.proposal);const now=await due(f.actor);
 if(operation!=='create'){
  await refreshAttentionNotifications(env,f.actor);
  if(operation==='reopen')await env.AGENT_DB.prepare("UPDATE mayor_notifications SET state='resolved',read_at='2026-01-01T00:00:00.000Z' WHERE tenant_id=?").bind(f.actor.tenantId).run();
  else await confirmProfile(env,f.actor,{name:'Complete fixture',description:'A synthetic test business.'},0);
 }
 const before=await env.AGENT_DB.prepare('SELECT id,state,occurrence,read_at,updated_at FROM mayor_notifications WHERE tenant_id=? ORDER BY id').bind(f.actor.tenantId).all();
 const attention=new WeakSet<object>();let changed=false;
 const guarded={...env,AGENT_DB:{
  prepare:(sql:string)=>{
   const statement=env.AGENT_DB.prepare(sql);
   if(!sql.startsWith('INSERT INTO mayor_notifications')&&!sql.startsWith('UPDATE mayor_notifications SET state='))return statement;
   return {bind:(...values:unknown[])=>{const bound=statement.bind(...values);attention.add(bound);return bound;}};
  },
  batch:async(statements:D1PreparedStatement[])=>{
   if(!changed&&statements.some(statement=>attention.has(statement))){
    changed=true;
    if(change==='pause')await pauseRecurringCheck(env,f.actor);
    else await confirmRecurringCheck(env,f.actor,await prepareRecurringCheck(env,f.actor,{enabled:true,schedule:{...schedule,hour:9}}));
   }
   return env.AGENT_DB.batch(statements);
  },
 }} as unknown as Env;
 await runRecurringChecks(guarded,{now});expect(changed).toBe(true);
 const notifications=await env.AGENT_DB.prepare('SELECT id,state,occurrence,read_at,updated_at FROM mayor_notifications WHERE tenant_id=? ORDER BY id').bind(f.actor.tenantId).all();
 const runs=await env.AGENT_DB.prepare('SELECT id FROM mayor_check_runs WHERE tenant_id=?').bind(f.actor.tenantId).all();
 expect(notifications.results).toEqual(before.results);expect(runs.results).toEqual([]);
 if(change==='edit')await pauseRecurringCheck(env,f.actor);
});
it('retries failures three times, retains an alert, and resolves it after a successful occurrence',async()=>{
 const f=await fixture();await confirmRecurringCheck(env,f.actor,f.proposal);const now=await due(f.actor);
 let calls=0;const check=async()=>{calls++;throw new Error('private provider detail');};
 await runRecurringChecks(env,{now,check});
 expect(Date.parse((await readRecurringCheck(env,f.actor)).nextRunAt!)).toBe(now+300000);
 await runRecurringChecks(env,{now:now+60000,check});expect(calls).toBe(1);
 await runRecurringChecks(env,{now:now+300000,check});
 await runRecurringChecks(env,{now:now+600000,check});expect(calls).toBe(3);
 expect((await readRecurringCheck(env,f.actor)).lastStatus).toBe('failed');
 const alerts=await refreshAttentionNotifications(env,f.actor);
 expect(alerts.notifications.some(item=>item.title.includes('could not finish'))).toBe(true);
 expect(JSON.stringify(alerts)).not.toContain('private provider detail');
 const next=(await readRecurringCheck(env,f.actor)).nextRunAt!;
 expect(Date.parse(next)).toBeGreaterThan(now+600000);
 await runRecurringChecks(env,{now:Date.parse(next),check:async()=>{}});
 expect((await listNotifications(env,f.actor)).notifications.some(item=>item.title.includes('could not finish'))).toBe(false);
 await pauseRecurringCheck(env,f.actor);
});
it.each(['pause','revoke'] as const)('discards in-flight results after %s',async change=>{
 const f=await fixture();await confirmRecurringCheck(env,f.actor,f.proposal);const now=await due(f.actor);
 await runRecurringChecks(env,{now,check:async()=>{
  if(change==='pause')await pauseRecurringCheck(env,f.actor);
  else await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=? AND user_id=?").bind(f.actor.tenantId,f.actor.userId).run();
  throw new Error('not committed');
 }});
 const runs=await env.AGENT_DB.prepare('SELECT * FROM mayor_check_runs WHERE tenant_id=?').bind(f.actor.tenantId).all();expect(runs.results).toEqual([]);
});
it('denies another user and skips revoked due schedules without starving eligible checks',async()=>{
 const f=await fixture();await confirmRecurringCheck(env,f.actor,f.proposal);await due(f.actor);
 await expect(readRecurringCheck(env,{...f.actor,userId:crypto.randomUUID()})).rejects.toThrow();
 await expect(pauseRecurringCheck(env,{...f.actor,tenantId:crypto.randomUUID()})).rejects.toThrow();
 await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=? AND user_id=?").bind(f.actor.tenantId,f.actor.userId).run();
 let calls=0;await runRecurringChecks(env,{check:async()=>{calls++;}});expect(calls).toBe(0);
});
it('requires a separate completed conversational readback before enabling a schedule',async()=>{
 const f=await fixture(),voice=Object.create(MayorVoice.prototype) as any;
 for(const field of ['generations','pending','pendingCalendar','pendingPolicy','pendingBooking','pendingChange','pendingCallback','pendingCustomer'])voice[field]=new Map();
 const ai={run:async()=>{
  const events=[{choices:[{delta:{tool_calls:[{id:'routine-1',index:0,type:'function',function:{name:'proposeRecurringAccountCheck',arguments:JSON.stringify({enabled:true,schedule})}}]}}]},{choices:[{delta:{},finish_reason:'stop'}]}];
  return new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join('')+'data: [DONE]\n\n'));controller.close();}});
 }};
 Object.assign(voice,{env:{...env,AI:ai},ready:new Set(),authorize:async()=>f.actor});
 const context={connection:{id:'recurring',send:()=>{}},signal:new AbortController().signal,messages:[]};
 const result=await voice.onTurn('Check my profile and calendar connection every day at 8 AM UTC, with in-app alerts only.',context);
 let readback='';for await(const chunk of result)readback+=chunk;
 expect(readback).toContain('08:00');expect(readback).toContain('Say yes');
 expect((await readRecurringCheck(env,f.actor)).enabled).toBe(false);
 expect(await voice.onTurn('Yes',context)).toContain('enabled');
 expect((await readRecurringCheck(env,f.actor)).enabled).toBe(true);
 await pauseRecurringCheck(env,f.actor);
});
it.each(['google','microsoft'] as const)('checks %s live calendar access and rejects removal or mid-read revocation',async provider=>{
 const user=await (await createAuth(env).$context).internalAdapter.createUser({email:`${crypto.randomUUID()}@example.test`,name:'Recurring fixture',emailVerified:true});
 const f=await fixture(),actor={tenantId:f.actor.tenantId,userId:user.id};
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
 const grantId=crypto.randomUUID(),scopes=provider==='google'?['https://www.googleapis.com/auth/calendar']:['Calendars.ReadWrite'];
 const ciphertext=await encryptCredential({accountEmail:user.email,accessToken:'test-token',accessTokenExpiresAt:new Date(Date.now()+3600000).toISOString(),grantedScopes:scopes},{...actor,provider,accountId:grantId},env.TOKEN_ENCRYPTION_KEY!);
 await env.AGENT_DB.prepare("INSERT INTO auth_provider_grants(id,user_id,provider,account_id,tenant_scope,ciphertext,granted_scopes,selected_capabilities,status,updated_at) VALUES(?,?,?,?,?,?,?,?,'authorized',?)").bind(grantId,actor.userId,provider,grantId,actor.tenantId,ciphertext,JSON.stringify(scopes),'["calendar_manage"]',new Date().toISOString()).run();
 let removed=false,revoke=false,reads=0;
 const transport=(async()=>{
  reads++;
  if(revoke)await env.AGENT_DB.prepare("UPDATE auth_provider_grants SET status='revoked' WHERE id=?").bind(grantId).run();
  return Response.json(provider==='google'?{items:removed?[]:[{id:'test-calendar',summary:'Test',accessRole:'owner'}]}:{value:removed?[]:[{id:'test-calendar',name:'Test',canEdit:true}]});
 }) as typeof fetch;
 await selectCalendar(env,actor,{provider,grantId,calendarId:'test-calendar'},transport);
 await checkAccountNow(env,actor,transport);expect(reads).toBe(2);
 removed=true;await expect(checkAccountNow(env,actor,transport)).rejects.toThrow();
 removed=false;revoke=true;await expect(checkAccountNow(env,actor,transport)).rejects.toThrow();
});
