import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {getAgentByName} from 'agents';
import {describe,it,expect} from 'vitest';
import type {Env} from '../src/env';
import {BusinessAgent,unwrap} from '../src/agent';
import {createTenant} from '../src/tenants';

const e=env as unknown as Env;
async function fixture() {
  const userId=crypto.randomUUID();
  const tenant=await createTenant(e,userId,{name:'Private Salon'},crypto.randomUUID());
  const actor={tenantId:tenant.id,userId};
  const stub=await getAgentByName(e.BUSINESS_AGENTS,tenant.id);
  unwrap(await stub.provision(actor));
  return {actor,stub};
}

describe('durable generation accounting',()=>{
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
