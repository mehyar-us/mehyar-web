import {env} from 'cloudflare:workers';
import {describe,it,expect} from 'vitest';
import type {Env} from '../src/env';
import {createTenant} from '../src/tenants';
import {researchAccess,RESEARCH_GATES} from '../src/research/access';
import {runInDurableObject} from 'cloudflare:test';
import {getAgentByName} from 'agents';
import {BusinessAgent,unwrap} from '../src/agent';
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
  it('fails closed before reservation and reserves idempotently only behind all launch gates',async()=>{
    const actor=await fixture(),stub=await getAgentByName(e.BUSINESS_AGENTS,actor.tenantId);unwrap(await stub.provision(actor));
    const key=crypto.randomUUID(),input={url:'https://salon.example.com/',pages:20,depth:2};
    expect(await stub.requestResearch(actor,input,key)).toMatchObject({ok:false,error:{code:'research_disabled'}});
    expect(unwrap(await stub.researchJobs(actor)).jobs).toEqual([]);
    await runInDurableObject(stub,async(instance:BusinessAgent)=>{
      const original=(instance as any).env;(instance as any).env={...original,RESEARCH_ENABLED:'true'};
      try{
        expect(await instance.requestResearch(actor,input,key)).toMatchObject({ok:false,error:{code:'research_not_ready'}});
        for(const gate of RESEARCH_GATES)await e.AGENT_DB.prepare("INSERT INTO agent_billing_readiness(scope_id,gate,catalog_version,status,evidence_ref,verified_by,verified_at,valid_until) VALUES ('research:crawl',?,?,'verified','fixture-only','test',?,?)")
          .bind(gate,CATALOG_VERSION,new Date().toISOString(),new Date(Date.now()+86400000).toISOString()).run();
        expect(await instance.requestResearch(actor,{...input,allowance:1000},key)).toMatchObject({ok:false,error:{code:'invalid_research_request'}});
        expect(await instance.requestResearch(actor,{...input,pages:21},key)).toMatchObject({ok:false,error:{code:'research_page_limit'}});
        const reserved=unwrap(await instance.requestResearch(actor,input,key));expect(reserved.job).toMatchObject({status:'reserved',pageLimit:20,reservedPages:20});
        await instance.maintainResearch();await instance.onStart();
        expect((await instance.listSchedules({type:'interval'})).filter(schedule=>schedule.callback==='maintainResearch')).toHaveLength(1);
        expect(unwrap(await instance.requestResearch(actor,{url:input.url},key))).toEqual(reserved);
        expect(await instance.requestResearch(actor,{...input,url:'https://other.example.com/'},key)).toMatchObject({ok:false,error:{code:'research_request_reused'}});
        expect(await instance.requestResearch(actor,input,crypto.randomUUID())).toMatchObject({ok:false,error:{code:'research_job_limit'}});
        unwrap(await instance.pause(actor,true));
        expect(await instance.requestResearch(actor,input,key)).toMatchObject({ok:false,error:{code:'agent_paused'}});
        expect(unwrap(await instance.researchJobs(actor)).jobs).toHaveLength(1);
        unwrap(await instance.pause(actor,false));
        instance.sql`UPDATE research_jobs SET deadline=0 WHERE id=${reserved.job.id}`;
        await instance.maintainResearch();
        expect((await instance.listSchedules({type:'interval'})).filter(schedule=>schedule.callback==='maintainResearch')).toHaveLength(0);
        expect(unwrap(await instance.requestResearch(actor,input,key)).job.status).toBe('cancelled');
        const replacement=unwrap(await instance.requestResearch(actor,input,crypto.randomUUID()));
        expect(replacement.job.id).not.toBe(reserved.job.id);expect(replacement.job.status).toBe('reserved');
        expect((await instance.listSchedules({type:'interval'})).filter(schedule=>schedule.callback==='maintainResearch')).toHaveLength(1);
      }finally{(instance as any).env=original;}
    });
  });
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
