import {env} from 'cloudflare:workers';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {getAgentByName} from 'agents';
import {describe,it,expect,vi} from 'vitest';
import {withInferenceTimeout} from '../src/inference-timeout';
import type {Env} from '../src/env';
import {BusinessAgent,unwrap} from '../src/agent';
import {createTenant} from '../src/tenants';
import {CATALOG_VERSION} from '../src/catalog';
import {RELEASE_GATES} from '../src/billing/service';
import {conversationContext} from '../src/conversation-context';
import {parseBriefReply} from '../src/brief-suggestions';
import {TextUsage} from '../src/billing/text-usage';

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
  it('aborts inference at sixty seconds and releases the deadline on every settled outcome',async()=>{
    vi.useFakeTimers();
    try{
      expect(await withInferenceTimeout(async()=>42)).toBe(42);expect(vi.getTimerCount()).toBe(0);
      const failure=new Error('Provider failed');
      await expect(withInferenceTimeout(async()=>{throw failure;})).rejects.toBe(failure);expect(vi.getTimerCount()).toBe(0);
      let aborted=false;
      const work=withInferenceTimeout(signal=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true})));
      const rejected=expect(work).rejects.toMatchObject({name:'TimeoutError'});
      await vi.advanceTimersByTimeAsync(59999);expect(aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);await rejected;expect(aborted).toBe(true);expect(vi.getTimerCount()).toBe(0);
    }finally{vi.useRealTimers();}
  });
  it.each(['success','failure','invalid_reply','invalid_usage'] as const)('retains chat accounting across eviction after %s',async(mode)=>{
    const failed=mode==='failure'||mode==='invalid_reply';
    const {actor,stub}=await fixture();let calls=0;
    await runInDurableObject(stub,async(instance:BusinessAgent)=>{
      const original=(instance as any).env;
      (instance as any).env={...original,AI_ENABLED:'true',AI_GATEWAY_ID:'fixture',AI:{run:async()=>{
        calls++;if(mode==='failure')throw new Error('Provider failed');return {usage:{prompt_tokens:17,completion_tokens:2,total_tokens:mode==='invalid_usage'?20:19,private:'discard-me'},choices:[{message:{content:mode==='invalid_reply'?'':'Ready to review your business.'}}]};
      }}};
      try{
        const key=crypto.randomUUID(),result=await instance.chat(actor,'Hello',key);expect(result.ok).toBe(!failed);
        if(!failed)expect(await instance.chat(actor,'Hello',key)).toEqual(result);
        expect(unwrap(await instance.usage(actor)).textCredits).toMatchObject({used:failed?0:1,reserved:0});
      }finally{(instance as any).env=original;}
    });
    await evictDurableObject(stub);
    await runInDurableObject(stub,async(instance:BusinessAgent,ctx)=>{
      expect(unwrap(await instance.usage(actor)).textCredits).toMatchObject({used:failed?0:1,reserved:0});
      expect(ctx.storage.sql.exec<{status:string}>('SELECT status FROM provider_attempts').toArray()).toEqual([{status:failed?'failed':'succeeded'}]);
      expect(unwrap(await instance.messages(actor)).filter(m=>m.role==='assistant')).toHaveLength(failed?0:1);
      const receipts=ctx.storage.sql.exec<{value:string}>('SELECT value FROM text_provider_receipts').toArray();
      expect(receipts).toHaveLength(mode==='failure'?0:1);
      if(mode!=='failure'){
        expect(JSON.parse(receipts[0].value)).toMatchObject({receipt:mode==='invalid_usage'?{state:'invalid'}:{state:'reported',inputTokens:17,outputTokens:2,totalTokens:19}});
        expect(receipts[0].value).not.toContain('discard-me');expect(receipts[0].value).not.toContain('Ready to review');
      }
    });expect(calls).toBe(1);
  });
  it('includes background reservations in chat admission and customer usage',async()=>{
    const {actor,stub}=await fixture();
    await runInDurableObject(stub,async(instance:BusinessAgent,ctx)=>{
      const original=(instance as any).env;let calls=0;
      (instance as any).env={...original,AI_ENABLED:'true',AI_GATEWAY_ID:'fixture',AI:{run:async()=>{calls++;return {choices:[{message:{content:'Ready'}}]};}}};
      try{
        const usage=new TextUsage(ctx.storage),tokens:string[]=[];
        for(let i=0;i<50;i++)tokens.push(usage.reserve(`job-${i}`,actor.userId,'a'.repeat(64),{period:'trial',limit:50,attemptLimit:60}).token);
        expect(unwrap(await instance.usage(actor)).textCredits).toEqual({used:0,reserved:50,limit:50});
        expect(await instance.chat(actor,'Hello',crypto.randomUUID())).toMatchObject({ok:false,error:{code:'usage_limit'}});expect(calls).toBe(0);
        usage.finish(tokens[0],false);
        unwrap(await instance.chat(actor,'Hello',crypto.randomUUID()));expect(calls).toBe(1);
        expect(unwrap(await instance.usage(actor)).textCredits).toEqual({used:1,reserved:49,limit:50});
        expect(JSON.parse(ctx.storage.sql.exec<{value:string}>('SELECT value FROM text_provider_receipts').one().value)).toMatchObject({receipt:{state:'missing'}});
      }finally{(instance as any).env=original;}
    });
  });
  it('binds industry suggestions to the pack used for inference even when the brief changes',async()=>{
    const {actor,stub}=await fixture();
    unwrap(await stub.saveBusinessBrief(actor,{expectedRevision:0,reviewed:true,fields:{industryPack:'barbershops-salons'}},crypto.randomUUID()));
    await runInDurableObject(stub,async(instance:BusinessAgent)=>{
      const original=(instance as any).env;
      (instance as any).env={...original,AI_ENABLED:'true',AI_GATEWAY_ID:'fixture',AI:{run:async(_model:string,input:any)=>{
        expect(input.messages[0].content).toContain('industryAnswers.deposits');expect(input.messages[0].content).not.toContain('industryAnswers.urgent_care_boundary');
        unwrap(await instance.saveBusinessBrief(actor,{expectedRevision:1,reviewed:true,fields:{industryPack:'clinics-dentists'}},crypto.randomUUID()));
        return {choices:[{message:{content:JSON.stringify({reply:'Review your deposit policy.',briefSuggestions:[{field:'industryAnswers.deposits',value:'No deposits',industryPack:'clinics-dentists'}]})}}]};
      }}};
      try{
        const result=unwrap(await instance.chat(actor,'No deposits',crypto.randomUUID()));
        expect(result.reply.briefSuggestions).toEqual([{field:'industryAnswers.deposits',value:'No deposits',sourceMessageId:result.message.id,industryPack:'barbershops-salons'}]);
        expect(unwrap(await instance.businessBrief(actor)).brief).toMatchObject({revision:2,fields:{industryPack:'clinics-dentists'},industryAnswers:{}});
      }finally{(instance as any).env=original;}
    });
  });
  it('only permits industry answer fields from the selected pack',()=>{
    const raw=JSON.stringify({reply:'Review this answer.',briefSuggestions:[{field:'industryAnswers.deposits',value:'No deposits'},{field:'industryAnswers.urgent_care_boundary',value:'No deposits'}]}),message={id:'owner-message',content:'No deposits'};
    expect(parseBriefReply(raw,message,true,'barbershops-salons').suggestions.map(s=>s.field)).toEqual(['industryAnswers.deposits']);
    expect(parseBriefReply(raw,message,true).suggestions).toEqual([]);
  });
  it('persists grounded model suggestions without changing the brief and replays them exactly',async()=>{
    const {actor,stub}=await fixture();
    await runInDurableObject(stub,async(instance:BusinessAgent)=>{
      const original=(instance as any).env;let calls=0;
      (instance as any).env={...original,AI_ENABLED:'true',AI_GATEWAY_ID:'fixture',AI:{run:async(_model:string,input:any)=>{
        calls++;expect(input.messages[0].content).toContain('Return JSON only');
        return {choices:[{message:{content:JSON.stringify({reply:'Review these hours before saving.',briefSuggestions:[{field:'hours',value:'9 AM to 5 PM',sourceMessageId:'forged-id'}]})}}]};
      }}};
      try{
        const key=crypto.randomUUID(),content='We open 9 AM to 5 PM.';
        const result=unwrap(await instance.chat(actor,content,key));
        expect(result.reply.content).toBe('Review these hours before saving.');expect(result.reply.briefSuggestions).toEqual([{field:'hours',value:'9 AM to 5 PM',sourceMessageId:result.message.id}]);
        expect(unwrap(await instance.chat(actor,content,key))).toEqual(result);expect(calls).toBe(1);
        expect(unwrap(await instance.messages(actor)).at(-1)).toEqual(result.reply);
        expect(unwrap(await instance.businessBrief(actor)).brief.revision).toBe(0);
        await e.AGENT_DB.prepare("UPDATE agent_memberships SET role='manager' WHERE tenant_id=? AND user_id=?").bind(actor.tenantId,actor.userId).run();
        expect(unwrap(await instance.messages(actor)).at(-1)?.briefSuggestions).toBeUndefined();
      }finally{(instance as any).env=original;}
    });
  });
  it('rejects invented suggestions and malformed structured replies',()=>{
    const message={id:'trusted-message',content:'Our services are haircuts.'};
    const envelope=(briefSuggestions:unknown[])=>JSON.stringify({reply:'Review the proposed detail.',briefSuggestions});
    expect(parseBriefReply(envelope([{field:'services',value:'haircuts'},{field:'services',value:'haircuts'},{field:'hours',value:'Always open'}]),message,true).suggestions).toEqual([{field:'services',value:'haircuts',sourceMessageId:'trusted-message'}]);
    expect(parseBriefReply(envelope([{field:'industryPack',value:'haircuts'},{field:'billingStatus',value:'haircuts'}]),message,true).suggestions).toEqual([]);
    expect(()=>parseBriefReply('{"reply":',message,true)).toThrow();
    expect(()=>parseBriefReply('{"reply":"","briefSuggestions":[]}',message,true)).toThrow();
    expect(parseBriefReply('A normal conversational response',message,true).suggestions).toEqual([]);
    expect(parseBriefReply(envelope([{field:'services',value:'haircuts'}]),message,false).suggestions).toEqual([]);
  });
  it('withdraws operator-derived replies from history and replay after a demotion',async()=>{
    const {actor,stub}=await fixture();
    unwrap(await stub.saveBusinessBrief(actor,{expectedRevision:0,reviewed:true,fields:{businessName:'Private brief context'}},crypto.randomUUID()));
    await runInDurableObject(stub,async(instance:BusinessAgent)=>{
      const original=(instance as any).env;let calls=0;
      (instance as any).env={...original,AI_ENABLED:'true',AI_GATEWAY_ID:'fixture',AI:{run:async(_model:string,input:any)=>{
        calls++;
        if(calls===2){expect(JSON.stringify(input)).not.toContain('Private operator answer');expect(input.messages[0].content).not.toContain('Private brief context');}
        return {choices:[{message:{content:calls===1?'Private operator answer':'Staff draft'}}]};
      }}};
      try{
        const key=crypto.randomUUID();unwrap(await instance.chat(actor,'Help with setup',key));
        await e.AGENT_DB.prepare("UPDATE agent_memberships SET role='staff' WHERE tenant_id=? AND user_id=?").bind(actor.tenantId,actor.userId).run();
        expect(unwrap(await instance.messages(actor)).map(m=>m.role)).toEqual(['user']);
        expect(await instance.chat(actor,'Help with setup',key)).toMatchObject({ok:false,error:{code:'context_access_changed'}});expect(calls).toBe(1);
        const staffKey=crypto.randomUUID(),reply=unwrap(await instance.chat(actor,'Draft a greeting',staffKey));
        expect(unwrap(await instance.chat(actor,'Draft a greeting',staffKey))).toEqual(reply);expect(calls).toBe(2);
        expect(unwrap(await instance.messages(actor)).map(m=>m.content)).toEqual(['Help with setup','Draft a greeting','Staff draft']);
        instance.sql`INSERT INTO conversations(id,user_id,role,content,created_at) VALUES ('untagged',${actor.userId},'assistant','Older unclassified answer','2026-01-01')`;
        expect(unwrap(await instance.messages(actor)).some(m=>m.id==='untagged')).toBe(false);
      }finally{(instance as any).env=original;}
    });
  });
  it('withholds an in-flight private answer after demotion without charging a text credit',async()=>{
    const {actor,stub}=await fixture();
    await runInDurableObject(stub,async(instance:BusinessAgent)=>{
      const original=(instance as any).env;
      (instance as any).env={...original,AI_ENABLED:'true',AI_GATEWAY_ID:'fixture',AI:{run:async()=>{
        await e.AGENT_DB.prepare("UPDATE agent_memberships SET role='staff' WHERE tenant_id=? AND user_id=?").bind(actor.tenantId,actor.userId).run();
        return {choices:[{message:{content:'Private answer must be withheld'}}]};
      }}};
      try{
        expect(await instance.chat(actor,'Help with setup',crypto.randomUUID())).toMatchObject({ok:false,error:{code:'context_access_changed'}});
        expect(unwrap(await instance.messages(actor)).map(m=>m.role)).toEqual(['user']);
        expect(unwrap(await instance.usage(actor)).textCredits).toMatchObject({used:0,reserved:0});
        expect(instance.sql<{status:string}>`SELECT status FROM provider_attempts`).toEqual([{status:'failed'}]);
        expect(instance.sql`SELECT * FROM conversation_visibility`).toEqual([]);
      }finally{(instance as any).env=original;}
    });
  });
  it('passes reviewed context to operators without exposing it to staff or another tenant',async()=>{
    const {actor,stub}=await fixture(),other=await fixture();
    unwrap(await stub.saveBusinessBrief(actor,{expectedRevision:0,reviewed:true,fields:{businessName:'Reviewed private salon',industryPack:'barbershops-salons',services:'Haircuts'},industryAnswers:{deposits:'Ten dollars'}},crypto.randomUUID()));
    unwrap(await other.stub.saveBusinessBrief(other.actor,{expectedRevision:0,reviewed:true,fields:{businessName:'Foreign secret'}},crypto.randomUUID()));
    const staff={...actor,userId:crypto.randomUUID()};
    await e.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role,created_at) VALUES (?,?,'staff',?)").bind(actor.tenantId,staff.userId,new Date().toISOString()).run();
    await runInDurableObject(stub,async(instance:BusinessAgent)=>{
      const original=(instance as any).env;const contexts:any[]=[];
      (instance as any).env={...original,AI_ENABLED:'true',AI_GATEWAY_ID:'fixture',AI:{run:async(_model:string,input:any)=>{
        const system=input.messages[0].content;expect(system).toContain('NO external tools');
        expect(system).not.toContain('Foreign secret');contexts.push(JSON.parse(system.split('\nBusiness data: ')[1]));
        return {choices:[{message:{content:'Setup suggestion only.'}}]};
      }}};
      try{
        unwrap(await instance.chat(actor,'Help me finish setup',crypto.randomUUID()));
        unwrap(await instance.chat(staff,'Draft a greeting',crypto.randomUUID()));
        expect(contexts[0]).toMatchObject({briefRevision:1,details:{businessName:'Reviewed private salon',services:'Haircuts'},industryAnswers:{deposits:'Ten dollars'}});
        expect(contexts[0].questions).not.toContain('Which services should the agent describe?');
        expect(contexts[1]).toMatchObject({briefRevision:null,details:{},industryAnswers:{},questions:[]});
        expect(unwrap(await instance.businessBrief(actor)).brief.revision).toBe(1);
      }finally{(instance as any).env=original;}
    });
  });
  it('keeps multilingual business context complete JSON within its byte allowance',()=>{
    const context=conversationContext('Goal',Array.from({length:20},(_,i)=>({key:`fact-${i}`,value:'😀日本語'.repeat(500)})));
    expect(new TextEncoder().encode(context).length).toBeLessThanOrEqual(3000);
    const parsed=JSON.parse(context);expect(parsed.truncated).toBe(true);expect(parsed.facts.length).toBeGreaterThan(0);
    expect(context).not.toContain('�');expect(parsed.facts[0].key).toBe('fact-0');
  });
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
