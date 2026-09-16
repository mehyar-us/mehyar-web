import {env} from 'cloudflare:workers';
import {describe,it,expect} from 'vitest';
import type {Env} from '../src/env';
import {createTenant} from '../src/tenants';
import {researchAccess} from '../src/research/access';
import {CATALOG_VERSION} from '../src/catalog';
import {RELEASE_GATES} from '../src/billing/service';
const e=env as unknown as Env;
async function fixture(){const userId=crypto.randomUUID(),tenant=await createTenant(e,userId,{name:'Research allowance'},crypto.randomUUID());return {userId,tenantId:tenant.id};}
async function paid(actor:{tenantId:string},plan:string,interval:string){
  await e.AGENT_DB.prepare("UPDATE agent_tenants SET plan_id=?,status='active' WHERE id=?").bind(plan,actor.tenantId).run();
  await e.AGENT_DB.prepare("INSERT INTO agent_billing_subscriptions(tenant_id,stripe_subscription_id,plan_id,status,paid_through,updated_at,access_state,billing_interval,usage_anchor) VALUES (?,?,?,'active',?,?,'active',?,?)")
    .bind(actor.tenantId,'sub_'+crypto.randomUUID(),plan,new Date(Date.now()+400*86400000).toISOString(),new Date().toISOString(),interval,new Date(Date.now()-86400000).toISOString()).run();
  for(const [scope,gates] of [['catalog',RELEASE_GATES],[actor.tenantId,['activation_approved']]] as const)for(const gate of gates)
    await e.AGENT_DB.prepare("INSERT OR REPLACE INTO agent_billing_readiness(scope_id,gate,catalog_version,status,evidence_ref,verified_by,verified_at,valid_until) VALUES (?,?,?,'verified','fixture-only','test',?,?)")
      .bind(scope,gate,CATALOG_VERSION,new Date().toISOString(),new Date(Date.now()+86400000).toISOString()).run();
}
describe('server-derived research allowances',()=>{
  it('grants one trial crawl of twenty pages only to current operators',async()=>{
    const actor=await fixture();expect(await researchAccess(e,actor,()=>false)).toEqual({period:'trial',allowance:20,maxJobs:1,resetsAt:null});
    await expect(researchAccess(e,actor,()=>true)).rejects.toMatchObject({code:'agent_paused'});
    await e.AGENT_DB.prepare("UPDATE agent_memberships SET role='staff' WHERE tenant_id=? AND user_id=?").bind(actor.tenantId,actor.userId).run();
    await expect(researchAccess(e,actor,()=>false)).rejects.toMatchObject({status:403});
  });
  it.each(['invalid','2020-01-01T00:00:00.000Z'])('rejects an invalid or expired trial: %s',async expiry=>{
    const actor=await fixture();await e.AGENT_DB.prepare('UPDATE agent_tenants SET trial_expires_at=? WHERE id=?').bind(expiry,actor.tenantId).run();
    await expect(researchAccess(e,actor,()=>false)).rejects.toMatchObject({code:'research_trial_unavailable'});
  });
  it.each([['business',100],['growth',300],['operations',1000]] as const)('derives %s monthly pages independently from text credits',async(plan,allowance)=>{
    const actor=await fixture();await paid(actor,plan,'annual');
    const access=await researchAccess(e,actor,()=>false);expect(access.allowance).toBe(allowance);expect(access.maxJobs).toBeUndefined();
    expect(Date.parse(access.resetsAt!)-Date.now()).toBeLessThan(32*86400000);
    await e.AGENT_DB.prepare("UPDATE agent_billing_subscriptions SET billing_interval='monthly' WHERE tenant_id=?").bind(actor.tenantId).run();
    expect(await researchAccess(e,actor,()=>false)).toEqual(access);
  });
  it('rejects missing activation evidence and disputed subscriptions',async()=>{
    const actor=await fixture();await paid(actor,'business','monthly');
    await e.AGENT_DB.prepare('DELETE FROM agent_billing_readiness WHERE scope_id=?').bind(actor.tenantId).run();
    await expect(researchAccess(e,actor,()=>false)).rejects.toThrow();
    await e.AGENT_DB.prepare("UPDATE agent_billing_subscriptions SET dispute_state='open' WHERE tenant_id=?").bind(actor.tenantId).run();
    await expect(researchAccess(e,actor,()=>false)).rejects.toMatchObject({code:'paid_execution_required'});
  });
});
