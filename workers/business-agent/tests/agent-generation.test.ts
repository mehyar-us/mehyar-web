import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {getAgentByName} from 'agents';
import {describe,it,expect} from 'vitest';
import type {Env} from '../src/env';
import {BusinessAgent,unwrap} from '../src/agent';
import {createTenant} from '../src/tenants';
import {CATALOG_VERSION} from '../src/catalog';
import {RELEASE_GATES} from '../src/billing/service';

const e=env as unknown as Env;
async function fixture() {
  const userId=crypto.randomUUID();
  const tenant=await createTenant(e,userId,{name:'Private Salon'},crypto.randomUUID());
  const actor={tenantId:tenant.id,userId};
  const stub=await getAgentByName(e.BUSINESS_AGENTS,tenant.id);
  unwrap(await stub.provision(actor));
  return {actor,stub};
}

async function activatePaid(actor:{tenantId:string;userId:string},interval="monthly") {
    await e.AGENT_DB.prepare("UPDATE agent_tenants SET plan_id='business',status='active' WHERE id=?").bind(actor.tenantId).run();
    await e.AGENT_DB.prepare("INSERT INTO agent_billing_subscriptions(tenant_id,stripe_subscription_id,plan_id,status,paid_through,updated_at,access_state,billing_interval,usage_anchor) VALUES (?,?,'business','active',?,?,'active',?,?)")
      .bind(actor.tenantId,'sub_'+crypto.randomUUID(),new Date(Date.now()+400*86400000).toISOString(),new Date().toISOString(),interval,new Date(Date.now()-86400000).toISOString()).run();
    for(const [scope,gates] of [['catalog',RELEASE_GATES],[actor.tenantId,['activation_approved']]] as const)for(const gate of gates)
      await e.AGENT_DB.prepare("INSERT OR REPLACE INTO agent_billing_readiness(scope_id,gate,catalog_version,status,evidence_ref,verified_by,verified_at,valid_until) VALUES (?,?,?,'verified','fixture-only','test',?,?)")
        .bind(scope,gate,CATALOG_VERSION,new Date().toISOString(),new Date(Date.now()+86400000).toISOString()).run();
}

describe('durable generation accounting',()=>{
  it.each(['expired','disputed','paused'])('withholds a paid response when access becomes %s during inference',async reason=>{
    const {actor,stub}=await fixture();await activatePaid(actor);
    await runInDurableObject(stub,async(instance:BusinessAgent)=>{
      const original=(instance as any).env;
      (instance as any).env={...original,AI_ENABLED:'true',AI_GATEWAY_ID:'fixture',AI:{run:async()=>{
        if(reason==='expired')await e.AGENT_DB.prepare("UPDATE agent_billing_subscriptions SET paid_through='2020-01-01T00:00:00.000Z' WHERE tenant_id=?").bind(actor.tenantId).run();
        if(reason==='disputed')await e.AGENT_DB.prepare("UPDATE agent_billing_subscriptions SET dispute_state='open' WHERE tenant_id=?").bind(actor.tenantId).run();
        if(reason==='paused')await e.AGENT_DB.prepare("UPDATE agent_tenants SET status='paused' WHERE id=?").bind(actor.tenantId).run();
        return {choices:[{message:{content:'Must not be delivered.'}}]};
      }}};
      try {
        expect(await instance.chat(actor,'Prepare a draft',crypto.randomUUID())).toMatchObject({ok:false,error:{code:reason==='expired'?'subscription_access_expired':'paid_execution_required'}});
        expect(unwrap(await instance.messages(actor)).map(message=>message.role)).toEqual(['user']);
        expect(instance.sql<{status:string}>`SELECT status FROM turns`.map(row=>row.status)).toEqual(['failed']);
        expect(instance.sql<{status:string}>`SELECT status FROM provider_attempts`.map(row=>row.status)).toEqual(['failed']);
      }finally{(instance as any).env=original;}
    });
  });
  it('charges a failed prior-period retry only in its current period and preserves the original message',async()=>{
    const {actor,stub}=await fixture();await activatePaid(actor);
    await runInDurableObject(stub,async(instance:BusinessAgent)=>{
      const original=(instance as any).env;let calls=0;
      (instance as any).env={...original,AI_ENABLED:'true',AI_GATEWAY_ID:'fixture',AI:{run:async()=>{calls++;return {choices:[{message:{content:'Recovered draft.'}}]};}}};
      try {
        const key=crypto.randomUUID(),messageId=crypto.randomUUID(),stamp='2020-01-01T00:00:00.000Z';
        instance.sql`INSERT INTO conversations(id,user_id,role,content,created_at) VALUES (${messageId},${actor.userId},'user','Retry draft',${stamp})`;
        instance.sql`INSERT INTO turns(request_key,user_id,content,message_id,status,period,created_at) VALUES (${key},${actor.userId},'Retry draft',${messageId},'failed','previous-month',${stamp})`;
        instance.sql`INSERT INTO provider_attempts(id,user_id,request_key,period,status,started_at) VALUES ('old-attempt',${actor.userId},${key},'previous-month','failed',${stamp})`;
        const result=unwrap(await instance.chat(actor,'Retry draft',key));expect(result.message.id).toBe(messageId);expect(calls).toBe(1);
        const usage=unwrap(await instance.usage(actor));expect(usage.textCredits).toEqual({used:1,reserved:0,limit:2000});
        expect(instance.sql<{period:string}>`SELECT period FROM turns`.map(row=>row.period)).toEqual([usage.period]);
        expect(instance.sql<{period:string}>`SELECT period FROM provider_attempts ORDER BY rowid`.map(row=>row.period)).toEqual(['previous-month',usage.period]);
        expect(unwrap(await instance.messages(actor))).toHaveLength(2);
      }finally{(instance as any).env=original;}
    });
  });
  it('reserves the last paid credit once under concurrent requests',async()=>{
    const {actor,stub}=await fixture();await activatePaid(actor);
    const colleague={...actor,userId:crypto.randomUUID()};
    await e.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role,created_at) VALUES (?,?,'staff',?)").bind(actor.tenantId,colleague.userId,new Date().toISOString()).run();
    await runInDurableObject(stub,async(instance:BusinessAgent)=>{
      const original=(instance as any).env;let calls=0;
      (instance as any).env={...original,AI_ENABLED:'true',AI_GATEWAY_ID:'fixture',AI:{run:async()=>{calls++;return {choices:[{message:{content:'Last included credit.'}}]};}}};
      try {
        const usage=unwrap(await instance.usage(actor));
        instance.sql`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<1999)
          INSERT INTO turns(request_key,user_id,content,message_id,status,period,created_at) SELECT 'seed-'||n,${actor.userId},'fixture','fixture','complete',${usage.period},'2026-01-01T00:00:00.000Z' FROM seq`;
        const results=await Promise.all([instance.chat(actor,'First',crypto.randomUUID()),instance.chat(colleague,'Second',crypto.randomUUID())]);
        expect(results.filter(r=>r.ok)).toHaveLength(1);expect(calls).toBe(1);
        expect(unwrap(await instance.usage(actor)).textCredits).toEqual({used:2000,reserved:0,limit:2000});
        expect(await instance.chat(actor,'One more',crypto.randomUUID())).toMatchObject({ok:false,error:{code:'usage_limit'}});expect(calls).toBe(1);
      }finally{(instance as any).env=original;}
    });
  });
  it('stops paid inference at its independent provider-attempt ceiling without consuming a customer credit',async()=>{
    const {actor,stub}=await fixture();await activatePaid(actor);
    await runInDurableObject(stub,async(instance:BusinessAgent)=>{
      const original=(instance as any).env;let calls=0;
      (instance as any).env={...original,AI_ENABLED:'true',AI_GATEWAY_ID:'fixture',AI:{run:async()=>{calls++;throw new Error('unexpected dispatch');}}};
      try {
        const usage=unwrap(await instance.usage(actor));
        instance.sql`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<2400)
          INSERT INTO provider_attempts(id,user_id,request_key,period,status,started_at) SELECT 'seed-'||n,${actor.userId},'fixture',${usage.period},'failed','2026-01-01T00:00:00.000Z' FROM seq`;
        expect(await instance.chat(actor,'Try draft',crypto.randomUUID())).toMatchObject({ok:false,error:{code:'provider_budget_limit'}});
        expect(calls).toBe(0);expect(unwrap(await instance.usage(actor)).textCredits).toEqual({used:0,reserved:0,limit:2000});
      }finally{(instance as any).env=original;}
    });
  });
  it.each(['monthly','annual'])('allows paid %s text usage, replays without charging twice, and rejects expired access',async interval=>{
    const {actor,stub}=await fixture();
    await activatePaid(actor,interval);
    await runInDurableObject(stub,async(instance:BusinessAgent)=>{
      const original=(instance as any).env;let calls=0;
      (instance as any).env={...original,AI_ENABLED:'true',AI_GATEWAY_ID:'fixture',AI:{run:async()=>{calls++;return {choices:[{message:{content:'Paid draft, no action taken.'}}]};}}};
      try {
        const key=crypto.randomUUID();const result=unwrap(await instance.chat(actor,'Draft my message',key));
        expect(unwrap(await instance.chat(actor,'Draft my message',key))).toEqual(result);expect(calls).toBe(1);
        const usage=unwrap(await instance.usage(actor));expect(usage.textCredits).toEqual({used:1,reserved:0,limit:2000});expect(usage.period).toContain('subscription:');
        expect(Date.parse(usage.resetsAt!)-Date.now()).toBeLessThan(32*86400000);
        await e.AGENT_DB.prepare("UPDATE agent_billing_subscriptions SET paid_through='2020-01-01T00:00:00.000Z' WHERE tenant_id=?").bind(actor.tenantId).run();
        expect(await instance.chat(actor,'Another message',crypto.randomUUID())).toMatchObject({ok:false,error:{code:'subscription_access_expired'}});expect(calls).toBe(1);
        expect(unwrap(await instance.usage(actor)).textCredits.limit).toBe(0);
      }finally{(instance as any).env=original;}
    });
  });
  it('caps paid provider attempts even when every response fails and customer credits are released',async()=>{
    const {actor,stub}=await fixture();
    await runInDurableObject(stub,async(instance:BusinessAgent)=>{
      const original=(instance as any).env;let calls=0;
      (instance as any).env={...original,AI_ENABLED:'true',AI_GATEWAY_ID:'test-only',AI:{run:async()=>{calls++;throw new Error('provider timeout');}}};
      try {
        for(let i=0;i<59;i++)instance.sql`INSERT INTO provider_attempts(id,user_id,request_key,period,status,started_at) VALUES (${`attempt-${i}`},${actor.userId},'fixture','trial','failed',${new Date().toISOString()})`;
        expect(await instance.chat(actor,'A draft',crypto.randomUUID())).toMatchObject({ok:false,error:{code:'agent_unavailable'}});
        expect(await instance.chat(actor,'Retry draft',crypto.randomUUID())).toMatchObject({ok:false,error:{code:'provider_budget_limit'}});
        expect(calls).toBe(1);expect(unwrap(await instance.usage(actor)).textCredits).toMatchObject({used:0,reserved:0});
      } finally {(instance as any).env=original;}
    });
  });
  it('retains provider cost reservation when the owner pauses after inference starts',async()=>{
    const {actor,stub}=await fixture();
    await runInDurableObject(stub,async(instance:BusinessAgent)=>{
      const original=(instance as any).env;
      (instance as any).env={...original,AI_ENABLED:'true',AI_GATEWAY_ID:'test-only',AI:{run:async()=>{
        unwrap(await instance.pause(actor,true));return {choices:[{message:{content:'This response will not be delivered.'}}]};
      }}};
      try {
        expect(await instance.chat(actor,'Draft',crypto.randomUUID())).toMatchObject({ok:false,error:{code:'agent_paused'}});
        const [attempts]=instance.sql<{count:number}>`SELECT COUNT(*) AS count FROM provider_attempts`;
        expect(attempts.count).toBe(1);expect(unwrap(await instance.usage(actor)).textCredits).toMatchObject({used:0,reserved:0});
      } finally {(instance as any).env=original;}
    });
  });
  it('replays one completed turn without a second inference or credit and keeps conversations private',async()=>{
    const {actor,stub}=await fixture();
    await runInDurableObject(stub,async(instance:BusinessAgent)=>{
      let calls=0;let captured:any;
      const original=(instance as any).env;
      (instance as any).env={...original,AI_ENABLED:'true',AI_GATEWAY_ID:'test-only',AI:{run:async(_model:unknown,input:unknown,options:unknown)=>{
        calls++;captured={input,options};return {choices:[{message:{content:'Here is a draft. Nothing has been sent.'}}]};
      }}};
      try {
        const key=crypto.randomUUID();
        const first=unwrap(await instance.chat(actor,'Draft a reminder.',key));
        const second=unwrap(await instance.chat(actor,'Draft a reminder.',key));
        expect(second).toEqual(first);expect(calls).toBe(1);
        expect(unwrap(await instance.usage(actor)).textCredits).toMatchObject({used:1,reserved:0});
        expect(captured.options.gateway).toMatchObject({skipCache:true,collectLog:false,metadata:{tenant_id:actor.tenantId}});
        expect(unwrap(await instance.messages(actor))).toHaveLength(2);
        const colleague=crypto.randomUUID();
        await e.AGENT_DB.prepare("INSERT INTO agent_memberships (tenant_id,user_id,role,created_at) VALUES (?,?,'staff',?)").bind(actor.tenantId,colleague,new Date().toISOString()).run();
        expect(unwrap(await instance.messages({tenantId:actor.tenantId,userId:colleague}))).toEqual([]);
      } finally {(instance as any).env=original;}
    });
  });
  it('releases failed generations, retries safely, and does not duplicate the owner message',async()=>{
    const {actor,stub}=await fixture();
    await runInDurableObject(stub,async(instance:BusinessAgent)=>{
      let fail=true;let calls=0;
      const original=(instance as any).env;
      (instance as any).env={...original,AI_ENABLED:'true',AI_GATEWAY_ID:'test-only',AI:{run:async()=>{
        calls++;if(fail)throw new Error('fixture model failure');return {choices:[{message:{content:'Draft completed.'}}]};
      }}};
      try {
        const key=crypto.randomUUID();
        expect(await instance.chat(actor,'Draft a reply.',key)).toMatchObject({ok:false});
        expect(unwrap(await instance.usage(actor)).textCredits).toMatchObject({used:0,reserved:0});
        fail=false;expect(await instance.chat(actor,'Draft a reply.',key)).toMatchObject({ok:true});
        expect(calls).toBe(2);expect(unwrap(await instance.messages(actor))).toHaveLength(2);
        expect(unwrap(await instance.usage(actor)).textCredits.used).toBe(1);
      } finally {(instance as any).env=original;}
    });
  });
  it('enforces the final trial credit across concurrent requests',async()=>{
    const {actor,stub}=await fixture();
    await runInDurableObject(stub,async(instance:BusinessAgent)=>{
      const original=(instance as any).env;let calls=0;
      (instance as any).env={...original,AI_ENABLED:'true',AI_GATEWAY_ID:'test-only',AI:{run:async()=>{
        calls++;return {choices:[{message:{content:'Last included draft.'}}]};
      }}};
      try {
        for(let i=0;i<49;i++)instance.sql`INSERT INTO turns(request_key,user_id,content,message_id,status,period,created_at) VALUES (${`seed-${i}`},${actor.userId},'fixture','fixture','complete','trial',${new Date().toISOString()})`;
        const results=await Promise.all([instance.chat(actor,'First',crypto.randomUUID()),instance.chat(actor,'Second',crypto.randomUUID())]);
        expect(results.filter(r=>r.ok)).toHaveLength(1);expect(calls).toBe(1);
        expect(unwrap(await instance.usage(actor)).textCredits).toMatchObject({used:50,reserved:0});
      } finally {(instance as any).env=original;}
    });
  });
});
