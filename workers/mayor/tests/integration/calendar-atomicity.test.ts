import {env as testEnv} from 'cloudflare:workers';
import {it,expect} from 'vitest';
import type {Env} from '../../src/env';
import {createAuth} from '../../src/auth';
import {encryptCredential} from '../../src/auth/vault';
import {selectCalendar,selectedCalendar} from '../../src/calendars';
const env=testEnv as unknown as Env;
it.each(['revoked','downgraded','expired','suspended'] as const)('discards saved calendar metadata after reader access is %s during lookup',async mode=>{
 const f=await fixture('google');await selectCalendar(env,f.actor,{provider:'google',grantId:f.grantId,calendarId:'original'},f.transport);
 const guarded={...env,AGENT_DB:{prepare:(sql:string)=>{
  const statement=env.AGENT_DB.prepare(sql);
  if(!sql.startsWith('SELECT * FROM mayor_calendar_selection'))return statement;
  return {bind:(...values:unknown[])=>({first:async()=>{
   const row=await statement.bind(...values).first();
   if(mode==='suspended')await env.AGENT_DB.prepare("UPDATE agent_tenants SET status='suspended' WHERE id=?").bind(f.actor.tenantId).run();
   else{
    const update=mode==='revoked'?"status='revoked'":mode==='downgraded'?"role='viewer'":"expires_at='2000-01-01T00:00:00.000Z'";
    await env.AGENT_DB.prepare(`UPDATE agent_memberships SET ${update} WHERE tenant_id=? AND user_id=?`).bind(f.actor.tenantId,f.actor.userId).run();
   }
   return row;
  }})};
 }}} as unknown as Env;
 await expect(selectedCalendar(guarded,f.actor)).rejects.toThrow();
});
async function fixture(provider:'google'|'microsoft'){
 const owner=await (await createAuth(env).$context).internalAdapter.createUser({email:`${crypto.randomUUID()}@example.test`,name:'Calendar fixture',emailVerified:true});
 const actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()},grantId=crypto.randomUUID();
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Calendar atomicity fixture',new Date().toISOString()).run();
 for(const userId of [actor.userId,owner.id])await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,userId).run();
 const scopes=provider==='google'?['https://www.googleapis.com/auth/calendar']:['Calendars.ReadWrite'];
 const ciphertext=await encryptCredential({accountEmail:owner.email,accessToken:'synthetic-token',accessTokenExpiresAt:new Date(Date.now()+3600000).toISOString(),grantedScopes:scopes},{userId:owner.id,tenantId:actor.tenantId,provider,accountId:grantId},env.TOKEN_ENCRYPTION_KEY!);
 await env.AGENT_DB.prepare("INSERT INTO auth_provider_grants(id,user_id,provider,account_id,tenant_scope,ciphertext,granted_scopes,selected_capabilities,status,updated_at) VALUES(?,?,?,?,?,?,?,?,'authorized',?)").bind(grantId,owner.id,provider,grantId,actor.tenantId,ciphertext,JSON.stringify(scopes),'["calendar_manage"]',new Date().toISOString()).run();
 const transport=(async()=>Response.json(provider==='google'?{items:['original','replacement'].map(id=>({id,summary:id,accessRole:'owner'}))}:{value:['original','replacement'].map(id=>({id,name:id,canEdit:true}))})) as typeof fetch;
 return {actor,owner,grantId,transport,provider};
}
for(const provider of ['google','microsoft'] as const){
 it(`${provider} does not create an initial selection or audit after operator expiry`,async()=>{
  const f=await fixture(provider);
  const guarded={...env,AGENT_DB:{prepare:env.AGENT_DB.prepare.bind(env.AGENT_DB),batch:async(statements:D1PreparedStatement[])=>{
   await env.AGENT_DB.prepare("UPDATE agent_memberships SET expires_at='2000-01-01T00:00:00.000Z' WHERE tenant_id=? AND user_id=?").bind(f.actor.tenantId,f.actor.userId).run();
   return env.AGENT_DB.batch(statements);
  }}} as Env;
  await expect(selectCalendar(guarded,f.actor,{provider,grantId:f.grantId,calendarId:'original'},f.transport)).rejects.toThrow();
  expect(await env.AGENT_DB.prepare('SELECT tenant_id FROM mayor_calendar_selection WHERE tenant_id=?').bind(f.actor.tenantId).first()).toBeNull();
  const audit=await env.AGENT_DB.prepare("SELECT id FROM mayor_audit WHERE tenant_id=? AND event='calendar_selected'").bind(f.actor.tenantId).all();expect(audit.results).toEqual([]);
 });
 it.each(['actor_revoked','owner_revoked','tenant_suspended','grant_revoked','consent_renewed','scope_changed'] as const)(`${provider} rejects a calendar replacement after %s before commit`,async mode=>{
  const f=await fixture(provider),input={provider,grantId:f.grantId};
  await selectCalendar(env,f.actor,{...input,calendarId:'original'},f.transport);
  const guarded={...env,AGENT_DB:{prepare:env.AGENT_DB.prepare.bind(env.AGENT_DB),batch:async(statements:D1PreparedStatement[])=>{
   if(mode==='actor_revoked'||mode==='owner_revoked')await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=? AND user_id=?").bind(f.actor.tenantId,mode==='actor_revoked'?f.actor.userId:f.owner.id).run();
   if(mode==='tenant_suspended')await env.AGENT_DB.prepare("UPDATE agent_tenants SET status='suspended' WHERE id=?").bind(f.actor.tenantId).run();
   if(mode==='grant_revoked')await env.AGENT_DB.prepare("UPDATE auth_provider_grants SET status='revoked' WHERE id=?").bind(f.grantId).run();
   if(mode==='consent_renewed')await env.AGENT_DB.prepare('UPDATE auth_provider_grants SET authorization_revision=authorization_revision+1 WHERE id=?').bind(f.grantId).run();
   if(mode==='scope_changed')await env.AGENT_DB.prepare("UPDATE auth_provider_grants SET granted_scopes='[]' WHERE id=?").bind(f.grantId).run();
   return env.AGENT_DB.batch(statements);
  }}} as Env;
  await expect(selectCalendar(guarded,f.actor,{...input,calendarId:'replacement'},f.transport)).rejects.toThrow();
  expect(await env.AGENT_DB.prepare('SELECT calendar_id FROM mayor_calendar_selection WHERE tenant_id=?').bind(f.actor.tenantId).first()).toEqual({calendar_id:'original'});
  const audit=await env.AGENT_DB.prepare("SELECT id FROM mayor_audit WHERE tenant_id=? AND event='calendar_selected'").bind(f.actor.tenantId).all();expect(audit.results).toHaveLength(1);
 });
}
it('rolls back selection when its audit cannot commit',async()=>{
 const f=await fixture('google'),trigger='calendar_audit_'+f.actor.tenantId.replaceAll('-','');
 await env.AGENT_DB.prepare(`CREATE TRIGGER ${trigger} BEFORE INSERT ON mayor_audit WHEN NEW.tenant_id='${f.actor.tenantId}' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END`).run();
 try{
  await expect(selectCalendar(env,f.actor,{provider:'google',grantId:f.grantId,calendarId:'original'},f.transport)).rejects.toThrow();
  expect(await env.AGENT_DB.prepare('SELECT tenant_id FROM mayor_calendar_selection WHERE tenant_id=?').bind(f.actor.tenantId).first()).toBeNull();
 }finally{await env.AGENT_DB.prepare(`DROP TRIGGER ${trigger}`).run();}
});
