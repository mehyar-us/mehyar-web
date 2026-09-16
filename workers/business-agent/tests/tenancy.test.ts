import { env } from 'cloudflare:workers';
import { getAgentByName } from 'agents';
import { describe,it,expect,beforeEach } from 'vitest';
import type { Env } from '../src/env';
import { createTenant,addMemory,deleteMemory,getMemory,listTenants,normalizeWebsite } from '../src/tenants';
import { requireMembership } from '../src/permissions';
import { unwrap } from '../src/agent';
import worker from '../src';

const e=env as unknown as Env;
let alice:string,bob:string,viewerId:string,supportId:string;
beforeEach(()=>{alice=crypto.randomUUID();bob=crypto.randomUUID();viewerId=crypto.randomUUID();supportId=crypto.randomUUID();});
async function make(userId=alice,key=crypto.randomUUID()) {
  return createTenant(e,userId,{name:'Example Salon',website:'https://salon.com',goal:'Help with appointment inquiries'},key);
}

describe('dedicated business isolation',()=>{
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
