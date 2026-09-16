import {env} from 'cloudflare:workers';
import {describe,it,expect,vi} from 'vitest';
import type {Env} from '../src/env';
import {createTenant} from '../src/tenants';
import {researchAccess,researchJobAccess,RESEARCH_GATES} from '../src/research/access';
import {ResearchJobs} from '../src/research/jobs';
import {runResearchWork,RECOVERY_GATES} from '../src/research/service';
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
  it('stops running work after requester revocation but preserves it during readiness failures',async()=>{
    const actor=await fixture(),stub=await getAgentByName(e.BUSINESS_AGENTS,actor.tenantId),account='c'.repeat(32);
    await runInDurableObject(stub,async(_instance,ctx)=>{
      const jobs=new ResearchJobs(ctx.storage);jobs.initialize();
      const job=jobs.reserveFor(actor,{key:crypto.randomUUID(),url:'https://salon.example.com/',period:'trial',allowance:20,pages:20,depth:2,deadline:Date.now()+60_000});
      jobs.bindProviderAccount(job.id,account);jobs.begin(job.id);jobs.submitted(job.id,'33333333-3333-4333-8333-333333333333');
      const configured={...e,RESEARCH_ENABLED:'true',RESEARCH_ACCOUNT_ID:account,RESEARCH_API_TOKEN:'fixture-token'};
      let calls=0;const transport=(async()=>{calls++;throw new Error('unexpected provider call');}) as typeof fetch;
      expect(await runResearchWork(configured,actor.tenantId,jobs,()=>false,transport)).toMatchObject([{ok:false,code:'research_not_ready'}]);
      expect(jobs.get(job.id).status).toBe('running');
      await e.AGENT_DB.prepare('DELETE FROM agent_memberships WHERE tenant_id=? AND user_id=?').bind(actor.tenantId,actor.userId).run();
      expect(await runResearchWork(configured,actor.tenantId,jobs,()=>false,transport)).toMatchObject([{ok:false,code:'workspace_not_found'}]);
      expect(jobs.get(job.id)).toMatchObject({status:'cancel_requested',reserved:20});expect(calls).toBe(0);
    });
  });
  it('turning execution off stops local work even when provider recovery is disabled',async()=>{
    const actor=await fixture(),stub=await getAgentByName(e.BUSINESS_AGENTS,actor.tenantId);
    await runInDurableObject(stub,async(_instance,ctx)=>{
      const jobs=new ResearchJobs(ctx.storage);jobs.initialize();
      const input={key:crypto.randomUUID(),url:'https://salon.example.com/',period:'trial',allowance:20,pages:5,depth:2,deadline:Date.now()+60_000};
      const queued=jobs.reserveFor(actor,input),running=jobs.reserveFor(actor,{...input,key:crypto.randomUUID()}),uncertain=jobs.reserveFor(actor,{...input,key:crypto.randomUUID()});
      jobs.begin(running.id);jobs.submitted(running.id,'44444444-4444-4444-8444-444444444444');jobs.begin(uncertain.id);
      expect(await runResearchWork(e,actor.tenantId,jobs,()=>false)).toEqual([]);
      expect(jobs.get(queued.id)).toMatchObject({status:'cancelled',reserved:0});
      expect(jobs.get(running.id)).toMatchObject({status:'cancel_requested',reserved:5});
      expect(jobs.get(uncertain.id)).toMatchObject({status:'uncertain',reserved:5});
    });
  });
  it('recovers paused provider work through the actual maintenance callback and removes its idle schedule',async()=>{
    const actor=await fixture(),stub=await getAgentByName(e.BUSINESS_AGENTS,actor.tenantId),account='b'.repeat(32),scope=`research:recovery:${account}`;
    unwrap(await stub.provision(actor));
    for(const gate of RECOVERY_GATES)await e.AGENT_DB.prepare("INSERT OR REPLACE INTO agent_billing_readiness(scope_id,gate,catalog_version,status,evidence_ref,verified_by,verified_at,valid_until) VALUES (?,?,?,'verified','fixture-only','test',?,?)")
      .bind(scope,gate,CATALOG_VERSION,new Date().toISOString(),new Date(Date.now()+86400000).toISOString()).run();
    try{await runInDurableObject(stub,async(instance:BusinessAgent,ctx)=>{
      const jobs=new ResearchJobs(ctx.storage);jobs.initialize();
      const input={key:crypto.randomUUID(),url:'https://salon.example.com/',period:'trial',allowance:20,pages:5,depth:2,deadline:Date.now()+60_000};
      const running=jobs.reserveFor(actor,input),queued=jobs.reserveFor(actor,{...input,key:crypto.randomUUID()});
      jobs.reserveSpend(running.id,100,200,'fixture');jobs.reserveSpend(queued.id,100,200,'fixture');jobs.bindProviderAccount(running.id,account);jobs.beginFunded(running.id);
      const providerId='22222222-2222-4222-8222-222222222222';jobs.submitted(running.id,providerId);
      const original=(instance as any).env;(instance as any).env={...original,RESEARCH_ENABLED:'false',RESEARCH_RECOVERY_ENABLED:'true',RESEARCH_ACCOUNT_ID:account,RESEARCH_API_TOKEN:'fixture-token'};
      const methods:string[]=[];
      const mock=vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
        expect(String(url)).toContain(`/accounts/${account}/browser-rendering/crawl/${providerId}`);
        methods.push(init?.method??'GET');
        return Response.json({success:true,result:init?.method==='DELETE'?{}:{id:providerId,status:'cancelled_by_user',records:[]}});
      });
      try{
        unwrap(await instance.pause(actor,true));expect(methods).toEqual([]);
        expect(jobs.get(queued.id)).toMatchObject({status:'cancelled',reserved:0});expect(jobs.get(running.id).status).toBe('cancel_requested');
        await instance.onStart();expect(methods).toEqual(['DELETE']);
        expect((await instance.listSchedules({type:'interval'})).filter(s=>s.callback==='maintainResearch')).toHaveLength(1);
        await instance.maintainResearch();expect(methods).toEqual(['DELETE','GET']);
        expect(jobs.get(running.id)).toMatchObject({status:'cancelled',reserved:0});
        expect((await instance.listSchedules({type:'interval'})).filter(s=>s.callback==='maintainResearch')).toHaveLength(0);
        unwrap(await instance.pause(actor,false));await instance.maintainResearch();expect(methods).toHaveLength(2);
      }finally{mock.mockRestore();(instance as any).env=original;}
    });}finally{await e.AGENT_DB.prepare('DELETE FROM agent_billing_readiness WHERE scope_id=?').bind(scope).run();}
  });
  it('runs gated stop recovery after revocation while execution remains disabled',async()=>{
    const actor=await fixture(),stub=await getAgentByName(e.BUSINESS_AGENTS,actor.tenantId),account='a'.repeat(32);
    await runInDurableObject(stub,async(_instance,ctx)=>{
      const jobs=new ResearchJobs(ctx.storage);jobs.initialize();
      const job=jobs.reserveFor(actor,{key:crypto.randomUUID(),url:'https://salon.example.com/',period:'trial',allowance:20,pages:20,depth:2,deadline:Date.now()+60_000});
      jobs.bindProviderAccount(job.id,account);jobs.begin(job.id);jobs.submitted(job.id,'11111111-1111-4111-8111-111111111111');jobs.cancel(job.id);
      let calls=0;const transport=(async()=>{calls++;return Response.json({success:true,result:{}});}) as typeof fetch;
      expect(await runResearchWork(e,actor.tenantId,jobs,()=>true,transport)).toEqual([]);
      const recovery={...e,RESEARCH_ENABLED:'false',RESEARCH_RECOVERY_ENABLED:'true',RESEARCH_ACCOUNT_ID:account,RESEARCH_API_TOKEN:'fixture-token'};
      expect(await runResearchWork(recovery,actor.tenantId,jobs,()=>true,transport)).toMatchObject([{ok:false}]);expect(calls).toBe(0);
      const scope=`research:recovery:${account}`;
      for(const gate of RECOVERY_GATES)await e.AGENT_DB.prepare("INSERT OR REPLACE INTO agent_billing_readiness(scope_id,gate,catalog_version,status,evidence_ref,verified_by,verified_at,valid_until) VALUES (?,?,?,'verified','fixture-only','test',?,?)")
        .bind(scope,gate,CATALOG_VERSION,new Date().toISOString(),new Date(Date.now()+86400000).toISOString()).run();
      try{
        await e.AGENT_DB.prepare('DELETE FROM agent_memberships WHERE tenant_id=? AND user_id=?').bind(actor.tenantId,actor.userId).run();
        await e.AGENT_DB.prepare("UPDATE agent_tenants SET status='deleted' WHERE id=?").bind(actor.tenantId).run();
        expect(await runResearchWork(recovery,actor.tenantId,jobs,()=>true,transport)).toMatchObject([{operation:'stop',ok:true}]);
        expect(calls).toBe(1);expect(jobs.get(job.id)).toMatchObject({status:'cancel_requested',reserved:20});
        expect(jobs.hasRecoveryWork()).toBe(true);
      }finally{await e.AGENT_DB.prepare('DELETE FROM agent_billing_readiness WHERE scope_id=?').bind(scope).run();}
    });
  });
  it('reauthorizes the stored requester and refuses missing or foreign attribution',async()=>{
    const actor=await fixture(),stub=await getAgentByName(e.BUSINESS_AGENTS,actor.tenantId);
    for(const gate of RESEARCH_GATES)await e.AGENT_DB.prepare("INSERT OR REPLACE INTO agent_billing_readiness(scope_id,gate,catalog_version,status,evidence_ref,verified_by,verified_at,valid_until) VALUES ('research:crawl',?,?,'verified','fixture-only','test',?,?)")
      .bind(gate,CATALOG_VERSION,new Date().toISOString(),new Date(Date.now()+86400000).toISOString()).run();
    try{await runInDurableObject(stub,async(_instance,ctx)=>{
      const jobs=new ResearchJobs(ctx.storage);jobs.initialize();
      const request={key:crypto.randomUUID(),url:'https://salon.example.com/',period:'trial',allowance:20,pages:10,depth:2,deadline:Date.now()+60_000};
      const job=jobs.reserveFor(actor,request),ready={...e,RESEARCH_ENABLED:'true'};
      const check=()=>researchJobAccess(ready,actor.tenantId,jobs,job.id,()=>false);
      expect(await check()).toMatchObject({period:'trial',allowance:20});
      await expect(researchJobAccess(e,actor.tenantId,jobs,job.id,()=>false)).rejects.toMatchObject({code:'research_disabled'});
      await expect(researchJobAccess(ready,actor.tenantId,jobs,job.id,()=>true)).rejects.toMatchObject({code:'agent_paused'});
      await expect(researchJobAccess(ready,crypto.randomUUID(),jobs,job.id,()=>false)).rejects.toMatchObject({code:'research_job_missing'});
      const legacy=jobs.reserve({...request,key:crypto.randomUUID()});
      await expect(researchJobAccess(ready,actor.tenantId,jobs,legacy.id,()=>false)).rejects.toMatchObject({code:'research_requester_missing'});
      await e.AGENT_DB.prepare("UPDATE agent_memberships SET role='staff' WHERE tenant_id=? AND user_id=?").bind(actor.tenantId,actor.userId).run();
      await expect(check()).rejects.toMatchObject({code:'permission_denied'});
      await e.AGENT_DB.prepare('DELETE FROM agent_memberships WHERE tenant_id=? AND user_id=?').bind(actor.tenantId,actor.userId).run();
      await expect(check()).rejects.toMatchObject({code:'workspace_not_found'});
      expect(jobs.requester(job.id)).toEqual(actor);
    });}finally{await e.AGENT_DB.prepare("DELETE FROM agent_billing_readiness WHERE scope_id='research:crawl'").run();}
  });
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
