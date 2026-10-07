import {env as testEnv} from 'cloudflare:workers';
import {it,expect} from 'vitest';
import type {Env} from '../../src/env';
import {confirmProfile,readMemory} from '../../src/memory';
import {confirmSchedulingPolicy} from '../../src/scheduling-policy';
const env=testEnv as unknown as Env;
async function fixture(){
 const actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Atomic profile fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();return actor;
}
function beforeCommit(hook:()=>Promise<unknown>):Env{
 return {...env,AGENT_DB:{prepare:env.AGENT_DB.prepare.bind(env.AGENT_DB),batch:async(statements:D1PreparedStatement[])=>{await hook();return env.AGENT_DB.batch(statements);}}} as Env;
}
it.each(['revoked','expired','tenant_suspended'] as const)('discards a profile read after %s while the query is in flight',async mode=>{
 const actor=await fixture();await confirmProfile(env,actor,{name:'Private profile'},0);
 const guarded={...env,AGENT_DB:{
  prepare:(sql:string)=>{
   const statement=env.AGENT_DB.prepare(sql);
   if(!sql.startsWith('SELECT value_json,revision,confirmed_at,provenance_json'))return statement;
   return {bind:(...values:unknown[])=>({first:async()=>{
    const row=await statement.bind(...values).first();
    const revoke=mode==='revoked'?"UPDATE agent_memberships SET status='revoked' WHERE tenant_id=?":mode==='expired'?"UPDATE agent_memberships SET expires_at='2000-01-01T00:00:00.000Z' WHERE tenant_id=?":"UPDATE agent_tenants SET status='suspended' WHERE id=?";
    await env.AGENT_DB.prepare(revoke).bind(actor.tenantId).run();return row;
   }})};
  },batch:env.AGENT_DB.batch.bind(env.AGENT_DB),
 }} as unknown as Env;
 await expect(readMemory(guarded,actor)).rejects.toThrow('This workspace is not available.');
});
it.each(['revoked','downgraded','expired','tenant_suspended'] as const)('rejects initial and existing profile writes after %s between authorization and commit',async mode=>{
 for(const existing of [false,true]){
  const actor=await fixture();if(existing)await confirmProfile(env,actor,{name:'Original'},0);
  const guarded=beforeCommit(async()=>{
   const sql=mode==='revoked'?"UPDATE agent_memberships SET status='revoked' WHERE tenant_id=?":mode==='downgraded'?"UPDATE agent_memberships SET role='viewer' WHERE tenant_id=?":mode==='expired'?"UPDATE agent_memberships SET expires_at='2000-01-01T00:00:00.000Z' WHERE tenant_id=?":"UPDATE agent_tenants SET status='suspended' WHERE id=?";
   await env.AGENT_DB.prepare(sql).bind(actor.tenantId).run();
  });
  await expect(confirmProfile(guarded,actor,{name:'Unauthorized'},existing?1:0)).rejects.toThrow();
  const row=await env.AGENT_DB.prepare("SELECT value_json,revision FROM mayor_memory WHERE tenant_id=? AND field='profile'").bind(actor.tenantId).first<{value_json:string;revision:number}>();
  expect(row?.revision??0).toBe(existing?1:0);if(row)expect(JSON.parse(row.value_json).name).toBe('Original');
  const audit=await env.AGENT_DB.prepare("SELECT id FROM mayor_audit WHERE tenant_id=? AND event='profile.confirmed'").bind(actor.tenantId).all();expect(audit.results).toHaveLength(existing?1:0);
 }
});
it('commits only one competing profile revision with exactly one matching audit',async()=>{
 const actor=await fixture();await confirmProfile(env,actor,{name:'Original'},0);
 const results=await Promise.allSettled([confirmProfile(env,actor,{name:'First'},1),confirmProfile(env,actor,{name:'Second'},1)]);
 expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
 expect((await readMemory(env,actor)).revision).toBe(2);
 const audit=await env.AGENT_DB.prepare("SELECT resource_id FROM mayor_audit WHERE tenant_id=? AND event='profile.confirmed' ORDER BY resource_id").bind(actor.tenantId).all();expect(audit.results).toEqual([{resource_id:'1'},{resource_id:'2'}]);
});
it('rolls back the profile write if its audit insert fails',async()=>{
 const actor=await fixture(),trigger='test_audit_'+actor.tenantId.replaceAll('-','');
 await env.AGENT_DB.prepare(`CREATE TRIGGER ${trigger} BEFORE INSERT ON mayor_audit WHEN NEW.tenant_id='${actor.tenantId}' BEGIN SELECT RAISE(ABORT,'test audit failure'); END`).run();
 try{await expect(confirmProfile(env,actor,{name:'Not committed'},0)).rejects.toThrow();expect((await readMemory(env,actor)).revision).toBe(0);}
 finally{await env.AGENT_DB.prepare(`DROP TRIGGER ${trigger}`).run();}
});
it('does not recreate a deleted profile from a stale confirmation',async()=>{
 const actor=await fixture();await confirmProfile(env,actor,{name:'Original'},0);
 const guarded=beforeCommit(()=>env.AGENT_DB.prepare("DELETE FROM mayor_memory WHERE tenant_id=? AND field='profile'").bind(actor.tenantId).run());
 await expect(confirmProfile(guarded,actor,{name:'Stale'},1)).rejects.toThrow();expect((await readMemory(env,actor)).revision).toBe(0);
});

it('rejects scheduling activation and edits after commit-time revocation',async()=>{
 const policy={timeZone:'UTC',weeklyHours:[],closedDates:[],appointmentTypes:[{name:'Test consultation',durationMinutes:30,bufferBeforeMinutes:0,bufferAfterMinutes:0}],staff:[],minimumNoticeMinutes:0,maximumAdvanceDays:30,cancellationNoticeMinutes:0};
 for(const existing of [false,true]){
  const actor=await fixture();if(existing)await confirmSchedulingPolicy(env,actor,policy,0);
  const guarded=beforeCommit(()=>env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=?").bind(actor.tenantId).run());
  await expect(confirmSchedulingPolicy(guarded,actor,{...policy,minimumNoticeMinutes:60},existing?1:0)).rejects.toThrow();
  const row=await env.AGENT_DB.prepare("SELECT value_json,revision FROM mayor_memory WHERE tenant_id=? AND field='scheduling_policy'").bind(actor.tenantId).first<{value_json:string;revision:number}>();
  expect(row?.revision??0).toBe(existing?1:0);if(row)expect(JSON.parse(row.value_json).minimumNoticeMinutes).toBe(0);
  const audit=await env.AGENT_DB.prepare("SELECT id FROM mayor_audit WHERE tenant_id=? AND event='scheduling_policy.confirmed'").bind(actor.tenantId).all();expect(audit.results).toHaveLength(existing?1:0);
 }
});
