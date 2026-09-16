import { env } from 'cloudflare:workers';
import { getAgentByName } from 'agents';
import {runInDurableObject} from 'cloudflare:test';
import {ResearchJobs} from '../src/research/jobs';
import { describe,it,expect,beforeEach } from 'vitest';
import type { Env } from '../src/env';
import { createTenant,addMemory,deleteMemory,getMemory,listTenants,normalizeWebsite } from '../src/tenants';
import { requireMembership } from '../src/permissions';
import { unwrap } from '../src/agent';
import worker from '../src';
import {renameAgent} from '../src/agent-settings';

const e=env as unknown as Env;
let alice:string,bob:string,viewerId:string,supportId:string;
beforeEach(()=>{alice=crypto.randomUUID();bob=crypto.randomUUID();viewerId=crypto.randomUUID();supportId=crypto.randomUUID();});
async function make(userId=alice,key=crypto.randomUUID()) {
  return createTenant(e,userId,{name:'Example Salon',website:'https://salon.com',goal:'Help with appointment inquiries'},key);
}

describe('dedicated business isolation',()=>{
  it('renames only the owner workspace and preserves receipt replay without undoing later edits',async()=>{
    const a=await make(alice),b=await make(bob),actor={tenantId:a.id,userId:alice},key=crypto.randomUUID();
    const input={expectedName:'Mayor',agentName:'Maya'};
    expect(await renameAgent(e,actor,input,key)).toEqual({agentName:'Maya'});
    await renameAgent(e,actor,{expectedName:'Maya',agentName:'Sam'},crypto.randomUUID());
    expect(await renameAgent(e,actor,input,key)).toEqual({agentName:'Maya'});
    expect((await listTenants(e,alice))[0].agentName).toBe('Sam');expect((await listTenants(e,bob))[0].agentName).toBe('Mayor');
    await expect(renameAgent(e,actor,{...input,agentName:'Changed'},key)).rejects.toMatchObject({code:'request_key_reused'});
    await expect(renameAgent(e,actor,input,crypto.randomUUID())).rejects.toMatchObject({code:'agent_name_changed'});
    const log=await e.AGENT_DB.prepare("SELECT COUNT(*) AS count FROM agent_activity WHERE tenant_id=? AND action='agent.renamed'").bind(a.id).first<{count:number}>();expect(log?.count).toBe(2);
    await expect(renameAgent(e,{tenantId:b.id,userId:alice},input,crypto.randomUUID())).rejects.toMatchObject({code:'workspace_not_found'});
  });
  it('serializes conflicting names and rejects managers and control characters',async()=>{
    const a=await make(alice),actor={tenantId:a.id,userId:alice};
    const changes=await Promise.allSettled(['Maya','Sam'].map(agentName=>renameAgent(e,actor,{expectedName:'Mayor',agentName},crypto.randomUUID())));
    expect(changes.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    await expect(renameAgent(e,actor,{expectedName:'Mayor',agentName:'Bad\nname'},crypto.randomUUID())).rejects.toMatchObject({code:'invalid_agent_name'});
    await e.AGENT_DB.prepare("UPDATE agent_memberships SET role='manager' WHERE tenant_id=? AND user_id=?").bind(a.id,alice).run();
    await expect(renameAgent(e,actor,{expectedName:'Mayor',agentName:'Other'},crypto.randomUUID())).rejects.toMatchObject({code:'permission_denied'});
  });
  it('limits research reads to current business operators and hides provider billing internals',async()=>{
    const a=await make(alice),b=await make(bob),actor={tenantId:a.id,userId:alice};
    const agent=await getAgentByName(e.BUSINESS_AGENTS,a.id),other=await getAgentByName(e.BUSINESS_AGENTS,b.id);
    unwrap(await agent.provision(actor));unwrap(await other.provision({tenantId:b.id,userId:bob}));
    const id=await runInDurableObject(agent,async(_instance,ctx)=>{
      const jobs=new ResearchJobs(ctx.storage),job=jobs.reserve({key:'private-request-key',url:'https://salon.example.com',period:'private-period',allowance:20,pages:20,depth:2,deadline:Date.now()+60_000});
      jobs.begin(job.id);jobs.submitted(job.id,'private-provider-11111111');
      await jobs.ingest(job.id,'private-provider-11111111',{url:job.source,status:'completed',httpStatus:200,html:'<title>Private research</title>'},new Date().toISOString());
      return job.id;
    });
    const detail=unwrap(await agent.researchEvidence(actor,id));
    expect(detail.pages[0].evidence[0].value).toBe('Private research');
    expect(detail.job).toMatchObject({id,evidencePages:1,usedPages:0,reservedPages:20});
    expect(JSON.stringify(detail)).not.toMatch(/private-request-key|private-period|private-provider/);
    const confirmation={url:detail.pages[0].url,index:0,key:'Research title',expectedValue:'Private research'};
    expect(await agent.confirmResearchClaim(actor,id,{...confirmation,expectedValue:'Tampered'})).toMatchObject({ok:false,error:{code:'research_claim_changed'}});
    await addMemory(e,actor,{key:'Existing topic',value:'Keep this'});
    expect(await agent.confirmResearchClaim(actor,id,{...confirmation,key:'Existing topic'})).toMatchObject({ok:false,error:{code:'research_memory_conflict'}});
    const [confirmed,replayed]=await Promise.all([agent.confirmResearchClaim(actor,id,confirmation),agent.confirmResearchClaim(actor,id,confirmation)]);
    expect(unwrap(confirmed)).toMatchObject({confirmed:true,removed:false,memory:{key:'Research title',value:'Private research',source:'owner_confirmed_website',sourceUrl:detail.pages[0].url}});
    expect(unwrap(replayed)).toEqual(unwrap(confirmed));
    const saved=await getMemory(e,actor);expect(saved).toHaveLength(2);
    const confirmedId=String(unwrap(confirmed).memory!.id);
    expect((await e.AGENT_DB.prepare('SELECT evidence_json FROM agent_research_confirmations WHERE tenant_id=? AND id=?').bind(a.id,confirmedId).first<{evidence_json:string}>())?.evidence_json).toContain('unverified');
    expect(await agent.confirmResearchClaim(actor,id,{...confirmation,key:'Different topic'})).toMatchObject({ok:false,error:{code:'research_confirmation_conflict'}});
    await deleteMemory(e,actor,confirmedId);
    expect(unwrap(await agent.confirmResearchClaim(actor,id,confirmation))).toMatchObject({confirmed:true,removed:true,memory:null});
    expect(await getMemory(e,actor)).toHaveLength(1);
    unwrap(await agent.pause(actor,true));expect(unwrap(await agent.researchJobs(actor)).jobs).toHaveLength(1);
    await e.AGENT_DB.prepare("UPDATE agent_tenants SET trial_expires_at='2020-01-01T00:00:00.000Z' WHERE id=?").bind(a.id).run();
    expect(unwrap(await agent.cancelResearch(actor,id)).job).toMatchObject({status:'cancel_requested',reservedPages:20});
    expect(unwrap(await agent.cancelResearch(actor,id)).job.status).toBe('cancel_requested');
    await runInDurableObject(agent,async(instance)=>{
      expect(instance.sql<{count:number}>`SELECT COUNT(*) AS count FROM research_withdrawals WHERE job_id=${id}`[0].count).toBe(1);
    });
    expect(await other.researchEvidence({tenantId:b.id,userId:bob},id)).toMatchObject({ok:false,error:{status:404}});
    expect(await other.researchJobs(actor)).toMatchObject({ok:false,error:{code:'agent_mismatch'}});
    for(const role of ['viewer','staff','billing','support','manager'] as const){
      const userId=crypto.randomUUID();await e.AGENT_DB.prepare('INSERT INTO agent_memberships(tenant_id,user_id,role,created_at,expires_at,support_reason) VALUES(?,?,?,?,?,?)')
        .bind(a.id,userId,role,new Date().toISOString(),role==='support'?new Date(Date.now()+60_000).toISOString():null,role==='support'?'Research access test':null).run();
      const result=await agent.researchEvidence({tenantId:a.id,userId},id);
      if(role==='manager')expect(result.ok).toBe(true);else expect(result).toMatchObject({ok:false,error:{status:403}});
      if(role!=='manager')expect(await agent.cancelResearch({tenantId:a.id,userId},id)).toMatchObject({ok:false,error:{status:403}});
      expect(await agent.confirmResearchClaim({tenantId:a.id,userId},id,confirmation)).toMatchObject({ok:false,error:{status:403}});
    }
    await e.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=? AND user_id=?").bind(a.id,alice).run();
    expect(await agent.researchEvidence(actor,id)).toMatchObject({ok:false,error:{status:404}});
    expect(await agent.cancelResearch(actor,id)).toMatchObject({ok:false,error:{status:404}});
  });
  it('provisions idempotently and rejects reused keys with changed business data',async()=>{
    const key=crypto.randomUUID();
    const one=await make(alice,key);
    const two=await make(alice,key);
    expect(one.id).toBe(two.id);
    expect(await listTenants(e,alice)).toHaveLength(1);
    await expect(createTenant(e,alice,{name:'Different'},key)).rejects.toMatchObject({status:409});
    const owner=await requireMembership(e,{userId:alice,tenantId:one.id});
    expect(owner.role).toBe('owner');
  });
  it('does not permit object ID substitution across businesses',async()=>{
    const a=await make(alice); const b=await make(bob);
    expect(await listTenants(e,alice)).toHaveLength(1);
    await expect(requireMembership(e,{userId:alice,tenantId:b.id})).rejects.toMatchObject({status:404});
    const memory=await addMemory(e,{userId:alice,tenantId:a.id},{key:'Hours',value:'Tuesday through Saturday'});
    await expect(deleteMemory(e,{userId:bob,tenantId:b.id},memory.id)).rejects.toMatchObject({status:404});
    expect(await getMemory(e,{userId:alice,tenantId:a.id})).toHaveLength(1);
    expect(await getMemory(e,{userId:bob,tenantId:b.id})).toHaveLength(0);
  });
  it('revocation affects existing agent RPC and viewer cannot pause or write memory',async()=>{
    const tenant=await make();
    await e.AGENT_DB.prepare("INSERT INTO agent_memberships (tenant_id,user_id,role,created_at) VALUES (?,?,'viewer',?)")
      .bind(tenant.id,viewerId,new Date().toISOString()).run();
    const agent=await getAgentByName(e.BUSINESS_AGENTS,tenant.id);
    unwrap(await agent.provision({tenantId:tenant.id,userId:alice}));
    const viewer={tenantId:tenant.id,userId:viewerId};
    expect(await agent.pause(viewer,true)).toMatchObject({ok:false,error:{status:403}});
    await expect(addMemory(e,viewer,{key:'Policy',value:'Changed'})).rejects.toMatchObject({status:403});
    await e.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id = ? AND user_id = ?").bind(tenant.id,alice).run();
    expect(await agent.messages({tenantId:tenant.id,userId:alice})).toMatchObject({ok:false,error:{status:404}});
  });
  it('agent identities cannot be rebound to another tenant',async()=>{
    const a=await make(alice);const b=await make(bob);
    const agent=await getAgentByName(e.BUSINESS_AGENTS,a.id);
    unwrap(await agent.provision({tenantId:a.id,userId:alice}));
    expect(await agent.provision({tenantId:b.id,userId:bob})).toMatchObject({ok:false,error:{code:'agent_mismatch'}});
  });
  it('rejects a different tenant before the first bind and denies a deleted tenant at the RPC boundary',async()=>{
    const a=await make(alice);const b=await make(bob);
    const actor={tenantId:a.id,userId:alice};
    const wrong=await getAgentByName(e.BUSINESS_AGENTS,b.id);
    expect(await wrong.provision(actor)).toMatchObject({ok:false,error:{code:'agent_mismatch'}});
    const own=await getAgentByName(e.BUSINESS_AGENTS,a.id);
    unwrap(await own.provision(actor));
    await e.AGENT_DB.prepare("UPDATE agent_tenants SET status='deleted' WHERE id = ?").bind(a.id).run();
    for(const result of await Promise.all([own.provision(actor),own.messages(actor),own.pause(actor,true)])) {
      expect(result).toMatchObject({ok:false,error:{code:'workspace_not_found'}});
    }
  });
  it('enforces workspace capacity atomically under concurrent creation',async()=>{
    const results=await Promise.allSettled(Array.from({length:7},()=>make(alice)));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(5);
    for(const result of results) if(result.status==='rejected') expect(result.reason).toMatchObject({status:429,code:'workspace_limit'});
    expect(await listTenants(e,alice)).toHaveLength(5);
  });
  it('pause persists and unconfigured AI neither fabricates a reply nor bills a credit',async()=>{
    const t=await make();const actor={tenantId:t.id,userId:alice};
    const agent=await getAgentByName(e.BUSINESS_AGENTS,t.id);
    unwrap(await agent.provision(actor));
    expect(await agent.chat(actor,'Hello',crypto.randomUUID())).toMatchObject({ok:false,error:{code:'ai_not_configured'}});
    expect(unwrap(await agent.usage(actor)).textCredits.used).toBe(0);
    unwrap(await agent.pause(actor,true));
    const same=await getAgentByName(e.BUSINESS_AGENTS,t.id);
    expect(unwrap(await same.usage(actor)).paused).toBe(true);
    expect(await same.chat(actor,'Hello',crypto.randomUUID())).toMatchObject({ok:false,error:{code:'agent_paused'}});
  });
  it('rejects expired support access',async()=>{
    const t=await make();
    await e.AGENT_DB.prepare("INSERT INTO agent_memberships (tenant_id,user_id,role,created_at,expires_at,support_reason) VALUES (?,?,'support',?,?,?)")
      .bind(t.id,supportId,new Date().toISOString(),'2000-01-01T00:00:00.000Z','Customer case').run();
    await expect(requireMembership(e,{tenantId:t.id,userId:supportId})).rejects.toMatchObject({status:404});
  });
});

describe('public entry boundaries',()=>{
  it('requires a session and rejects cross-origin mutations before any operation',async()=>{
    const unauth=await worker.fetch(new Request('http://localhost/api/tenants'),e);
    expect(unauth.status).toBe(401);
    const csrf=await worker.fetch(new Request('http://localhost/api/tenants',{method:'POST',headers:{origin:'https://attacker.com','content-type':'application/json'},body:'{}'}),e);
    expect(csrf.status).toBe(403);
  });
  it('cannot route legacy Stripe handlers or public durable-object sockets',async()=>{
    for(const path of ['/api/pay/webhook','/api/audit/full-report/webhook']) {
      const r=await worker.fetch(new Request(`http://localhost${path}`,{method:'POST'}),e);
      expect(r.status).toBe(404);
    }
    const r=await worker.fetch(new Request('http://localhost/agents/business-agent/someone-else'),e);
    expect([401,404]).toContain(r.status);
  });
  it.each(['http://127.1','https://[::1]','http://2130706433','http://localhost','https://foo.internal','https://user:pass@site.com','ftp://site.com','https://site.com:1234'])('rejects non-public website shape %s',url=>{
    expect(()=>normalizeWebsite(url)).toThrow();
  });
});
