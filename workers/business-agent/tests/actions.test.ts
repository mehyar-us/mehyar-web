import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { getAgentByName } from 'agents';
import { describe, expect, it } from 'vitest';
import type { Env, Role } from '../src/env';
import { BusinessAgent, unwrap } from '../src/agent';
import { createTenant } from '../src/tenants';
import { storeProviderGrant } from '../src/auth/vault';

const e=env as unknown as Env;
async function fixture(mode:'preview'|'approve'|'automatic'='approve',limit=10) {
  const userId=crypto.randomUUID();
  await e.AGENT_DB.prepare('INSERT INTO auth_user(id,name,email,createdAt,updatedAt) VALUES (?,?,?,?,?)')
    .bind(userId,'Fixture owner',`${userId}@example.test`,Date.now(),Date.now()).run();
  const tenant=await createTenant(e,userId,{name:'Approval fixture'},crypto.randomUUID());
  const actor={userId,tenantId:tenant.id};
  const stub=await getAgentByName(e.BUSINESS_AGENTS,tenant.id);
  unwrap(await stub.provision(actor));
  const grantId=await storeProviderGrant(e,{userId,tenantId:tenant.id,provider:'google',accountId:crypto.randomUUID()},
    {accountEmail:'owner@example.com',accessToken:'fixture-access-only',refreshToken:'fixture-refresh-only',
      grantedScopes:['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send']},['gmail_read','gmail_send']);
  const input={id:crypto.randomUUID(),expectedVersion:0,name:'Reply to appointment inquiries',trigger:'New inquiry',operation:'mail.reply' as const,
    provider:'google' as const,grantId,mode,resources:['thread-one'],recipients:['customer@example.com'],template:'Your request has been received.',
    startsAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+86400000*7).toISOString(),
    maxActionsPerDay:limit,maxCostMicrosPerDay:0,escalation:'Ask the owner',enabled:true};
  const policy=unwrap(await stub.saveActionPolicy(actor,input));
  const proposal={policyId:policy.id,policyVersion:policy.version,
    action:{operation:'mail.reply' as const,resourceId:'thread-one',messageId:'message-one',recipient:'customer@example.com',text:'Your request has been received.'}};
  return {actor,stub,input,policy,proposal,grantId};
}
async function member(tenantId:string,role:Role) {
  const userId=crypto.randomUUID();
  await e.AGENT_DB.prepare('INSERT INTO agent_memberships(tenant_id,user_id,role,created_at) VALUES (?,?,?,?)')
    .bind(tenantId,userId,role,new Date().toISOString()).run();
  return {tenantId,userId};
}
describe('durable action reviews and saved authority',()=>{
  it.each(['google','microsoft'] as const)('validates %s calendar permissions, guests, timezone and appointment timing',async(provider)=>{
    const f=await fixture();
    const grantId=await storeProviderGrant(e,{userId:f.actor.userId,tenantId:f.actor.tenantId,provider,accountId:crypto.randomUUID()},
      {accountEmail:'owner@example.com',accessToken:'fixture-calendar-only',refreshToken:'fixture-refresh-only',
        grantedScopes:[provider==='google'?'https://www.googleapis.com/auth/calendar.events':'https://graph.microsoft.com/Calendars.ReadWrite']},['calendar_manage']);
    const policy=unwrap(await f.stub.saveActionPolicy(f.actor,{...f.input,id:crypto.randomUUID(),provider,grantId,operation:'calendar.create',resources:['calendar-one']}));
    const proposal={policyId:policy.id,policyVersion:1,action:{operation:'calendar.create',resourceId:'calendar-one',title:'Consultation',attendees:['customer@example.com'],
      start:new Date(Date.now()+3600000).toISOString(),end:new Date(Date.now()+7200000).toISOString(),timeZone:'America/New_York'}};
    const action=unwrap(await f.stub.proposeAction(f.actor,proposal,crypto.randomUUID()));
    expect(unwrap(await f.stub.decideAction(f.actor,action.id,{decision:'approve',actionHash:action.actionHash})).status).toBe('approved');
    expect(await f.stub.proposeAction(f.actor,{...proposal,action:{...proposal.action,timeZone:'Not/AZone'}},crypto.randomUUID())).toMatchObject({ok:false,error:{code:'invalid_timezone'}});
    expect(await f.stub.proposeAction(f.actor,{...proposal,action:{...proposal.action,end:proposal.action.start}},crypto.randomUUID())).toMatchObject({ok:false,error:{code:'invalid_appointment'}});
  });
  it('withdraws saved authority when its author loses the owner role',async()=>{
    const f=await fixture(),manager=await member(f.actor.tenantId,'manager');
    const action=unwrap(await f.stub.proposeAction(f.actor,f.proposal,crypto.randomUUID()));
    await e.AGENT_DB.prepare("UPDATE agent_memberships SET role='staff' WHERE tenant_id=? AND user_id=?").bind(f.actor.tenantId,f.actor.userId).run();
    expect(await f.stub.decideAction(manager,action.id,{decision:'approve',actionHash:action.actionHash})).toMatchObject({ok:false,error:{status:403}});
  });
  it('stores immutable proposal contents, approves idempotently and never reports external execution',async()=>{
    const f=await fixture();const key=crypto.randomUUID();
    const [a,b]=await Promise.all([f.stub.proposeAction(f.actor,f.proposal,key),f.stub.proposeAction(f.actor,f.proposal,key)]);
    const action=unwrap(a);expect(unwrap(b).id).toBe(action.id);
    expect(action).toMatchObject({status:'pending',executionAvailable:false});
    expect(JSON.stringify(action)).not.toMatch(/fixture-access|fixture-refresh|ciphertext/);
    const decision={decision:'approve',actionHash:action.actionHash};
    const approved=unwrap(await f.stub.decideAction(f.actor,action.id,decision));
    expect(approved).toMatchObject({status:'approved',approvedBy:f.actor.userId,executionAvailable:false});
    expect(unwrap(await f.stub.decideAction(f.actor,action.id,decision))).toEqual(approved);
    expect(unwrap(await f.stub.actionReview(f.actor,action.id)).decisions).toHaveLength(1);
    expect(unwrap(await f.stub.actionReviews(f.actor))).toHaveLength(1);
    expect(await f.stub.proposeAction(f.actor,{...f.proposal,action:{...f.proposal.action,text:'Changed body'}},key))
      .toMatchObject({ok:false,error:{code:'request_key_reused'}});
  });
  it('requires owner policy edits and prevents another business from reading or deciding actions',async()=>{
    const a=await fixture(),b=await fixture();const manager=await member(a.actor.tenantId,'manager');
    expect(await a.stub.saveActionPolicy(manager,{...a.input,expectedVersion:1})).toMatchObject({ok:false,error:{status:403}});
    const action=unwrap(await a.stub.proposeAction(a.actor,a.proposal,crypto.randomUUID()));
    expect(await a.stub.actionReviews(b.actor)).toMatchObject({ok:false,error:{code:'agent_mismatch'}});
    expect(await b.stub.decideAction(b.actor,action.id,{decision:'approve',actionHash:action.actionHash})).toMatchObject({ok:false,error:{status:404}});
  });
  it('limits staff to their own reviews and prevents self-approval',async()=>{
    const f=await fixture(),staff=await member(f.actor.tenantId,'staff');
    unwrap(await f.stub.proposeAction(f.actor,f.proposal,crypto.randomUUID()));
    const action=unwrap(await f.stub.proposeAction(staff,f.proposal,crypto.randomUUID()));
    expect(unwrap(await f.stub.actionReviews(staff))).toHaveLength(1);
    expect(await f.stub.decideAction(staff,action.id,{decision:'approve',actionHash:action.actionHash})).toMatchObject({ok:false,error:{status:403}});
    const viewer=await member(f.actor.tenantId,'viewer');
    expect(await f.stub.actionReviews(viewer)).toMatchObject({ok:false,error:{status:403}});
  });
  it('rejects recipient/resource substitution, arbitrary fields and altered review hashes',async()=>{
    const f=await fixture();
    for(const [change,code] of [[{recipient:'outsider@example.com'},'recipient_not_allowed'],[{resourceId:'thread-two'},'resource_not_allowed'],[{accessToken:'injected'},'invalid_action_input']] as const) {
      expect(await f.stub.proposeAction(f.actor,{...f.proposal,action:{...f.proposal.action,...change}},crypto.randomUUID())).toMatchObject({ok:false,error:{code}});
    }
    const action=unwrap(await f.stub.proposeAction(f.actor,f.proposal,crypto.randomUUID()));
    expect(await f.stub.decideAction(f.actor,action.id,{decision:'approve',actionHash:'0'.repeat(64)})).toMatchObject({ok:false,error:{code:'action_changed'}});
  });
  it('rechecks granted scope and revoked connections at approval time',async()=>{
    const f=await fixture();const action=unwrap(await f.stub.proposeAction(f.actor,f.proposal,crypto.randomUUID()));
    await e.AGENT_DB.prepare("UPDATE auth_provider_grants SET granted_scopes='[]' WHERE id=?").bind(f.grantId).run();
    expect(await f.stub.decideAction(f.actor,action.id,{decision:'approve',actionHash:action.actionHash})).toMatchObject({ok:false,error:{code:'insufficient_scope'}});
    await e.AGENT_DB.prepare("UPDATE auth_provider_grants SET status='revoked' WHERE id=?").bind(f.grantId).run();
    expect(await f.stub.decideAction(f.actor,action.id,{decision:'approve',actionHash:action.actionHash})).toMatchObject({ok:false,error:{code:'connection_unavailable'}});
  });
  it('does not approve a proposal made by a subsequently revoked member',async()=>{
    const f=await fixture(),staff=await member(f.actor.tenantId,'staff');
    const action=unwrap(await f.stub.proposeAction(staff,f.proposal,crypto.randomUUID()));
    await e.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=? AND user_id=?").bind(staff.tenantId,staff.userId).run();
    expect(await f.stub.decideAction(f.actor,action.id,{decision:'approve',actionHash:action.actionHash})).toMatchObject({ok:false,error:{status:404}});
  });
  it('serializes concurrent approvals against the daily limit and releases rejected reservations',async()=>{
    const f=await fixture('approve',1);
    const a=unwrap(await f.stub.proposeAction(f.actor,f.proposal,crypto.randomUUID()));
    const b=unwrap(await f.stub.proposeAction(f.actor,f.proposal,crypto.randomUUID()));
    const results=await Promise.all([a,b].map(action=>f.stub.decideAction(f.actor,action.id,{decision:'approve',actionHash:action.actionHash})));
    expect(results.filter(r=>r.ok)).toHaveLength(1);
    expect(results.find(r=>!r.ok)).toMatchObject({error:{code:'action_budget_limit'}});
    const approved=results[0].ok?a:b,waiting=results[0].ok?b:a;
    unwrap(await f.stub.decideAction(f.actor,approved.id,{decision:'reject',actionHash:approved.actionHash}));
    expect(unwrap(await f.stub.actionReview(f.actor,approved.id)).decisions.map(d=>d.decision)).toEqual(['approved','rejected']);
    expect(unwrap(await f.stub.decideAction(f.actor,waiting.id,{decision:'approve',actionHash:waiting.actionHash})).status).toBe('approved');
  });
  it('cancels old reviews on policy revision and rejects stale policy writes',async()=>{
    const f=await fixture();const action=unwrap(await f.stub.proposeAction(f.actor,f.proposal,crypto.randomUUID()));
    unwrap(await f.stub.decideAction(f.actor,action.id,{decision:'approve',actionHash:action.actionHash}));
    const updated=unwrap(await f.stub.saveActionPolicy(f.actor,{...f.input,expectedVersion:1,enabled:false}));
    expect(updated.version).toBe(2);
    expect(unwrap(await f.stub.actionReviews(f.actor))[0].status).toBe('cancelled');
    expect(await f.stub.saveActionPolicy(f.actor,{...f.input,name:'stale edit'})).toMatchObject({ok:false,error:{code:'policy_version_conflict'}});
    expect(await f.stub.proposeAction(f.actor,f.proposal,crypto.randomUUID())).toMatchObject({ok:false,error:{code:'policy_changed'}});
    await runInDurableObject(f.stub,async(instance:BusinessAgent)=>{
      const versions=instance.sql<{version:number}>`SELECT version FROM action_policy_versions ORDER BY version`;
      expect(versions.map(v=>v.version)).toEqual([1,2]);
    });
  });
  it('pause blocks approvals but still allows rejecting queued work',async()=>{
    const f=await fixture();const action=unwrap(await f.stub.proposeAction(f.actor,f.proposal,crypto.randomUUID()));
    unwrap(await f.stub.pause(f.actor,true));
    expect(await f.stub.decideAction(f.actor,action.id,{decision:'approve',actionHash:action.actionHash})).toMatchObject({ok:false,error:{code:'agent_paused'}});
    expect(unwrap(await f.stub.decideAction(f.actor,action.id,{decision:'reject',actionHash:action.actionHash})).status).toBe('rejected');
  });
  it('expires stale approvals and prevents preview-only policy elevation',async()=>{
    const f=await fixture('preview'),key=crypto.randomUUID();const preview=unwrap(await f.stub.proposeAction(f.actor,f.proposal,key));
    expect(preview.status).toBe('preview');
    expect(await f.stub.decideAction(f.actor,preview.id,{decision:'approve',actionHash:preview.actionHash})).toMatchObject({ok:false,error:{code:'preview_only'}});
    await runInDurableObject(f.stub,async(instance:BusinessAgent)=>{
      instance.sql`UPDATE action_reviews SET expires_at='2020-01-01T00:00:00.000Z' WHERE id=${preview.id}`;
    });
    expect(unwrap(await f.stub.actionReviews(f.actor))[0].status).toBe('expired');
    expect(unwrap(await f.stub.proposeAction(f.actor,f.proposal,key)).status).toBe('expired');
    expect(unwrap(await f.stub.actionReview(f.actor,preview.id)).decisions.map(d=>d.decision)).toEqual(['expired']);
  });
  it('requires an exact owner template for automatic mail and makes no execution claim',async()=>{
    const f=await fixture('automatic');
    expect(await f.stub.proposeAction(f.actor,{...f.proposal,action:{...f.proposal.action,text:'Give us your password'}},crypto.randomUUID()))
      .toMatchObject({ok:false,error:{code:'template_not_allowed'}});
    expect(unwrap(await f.stub.proposeAction(f.actor,f.proposal,crypto.randomUUID()))).toMatchObject({status:'pending',executionAvailable:false});
  });
});
