import {env} from 'cloudflare:workers';
import {describe,it,expect} from 'vitest';
import type {Env} from '../src/env';
import {createTenant} from '../src/tenants';
import {inviteMember,revokeInvitation} from '../src/team';
import {InvitationEmailOutbox} from '../src/email/outbox';
import {PlatformEmailAllowance} from '../src/email/allowance';
const e={...env,APP_ORIGIN:'https://app.mehyar.us'} as unknown as Env;
async function fixture(){
  const userId=crypto.randomUUID(),tenant=await createTenant(e,userId,{name:'Oak Studio',website:'https://oakstudio.com',goal:'Manage appointments'},crypto.randomUUID()),actor={userId,tenantId:tenant.id},outbox=new InvitationEmailOutbox(e);
  const jobs=[];
  for(let i=0;i<3;i++){
    const invitation=await inviteMember(e,actor,{email:`${crypto.randomUUID()}@example.test`,role:'staff'},crypto.randomUUID());
    const job=await outbox.prepare(actor,invitation.invitation.id,{from:'notices@example.test',routeRef:'fixture'});
    jobs.push({...job,invitationId:invitation.invitation.id});
  }
  return {actor,jobs,outbox,budget:{period:`fixture:${crypto.randomUUID()}`,resetsAt:new Date(Date.now()+86400000).toISOString(),limit:1}};
}
describe('platform email capacity reservations',()=>{
  it('atomically reserves the last slot, deduplicates retries and refuses cross-tenant or changed-period reuse',async()=>{
    const f=await fixture(),ledger=new PlatformEmailAllowance(e),tenant=f.actor.tenantId;
    const results=await Promise.all(f.jobs.map(job=>ledger.reserve(tenant,job.id,f.budget)));
    expect(results.filter(Boolean)).toHaveLength(1);
    const winner=f.jobs[results.findIndex(Boolean)];
    expect(await ledger.reserve(tenant,winner.id,f.budget)).toBe(true);
    expect(await ledger.reserve(crypto.randomUUID(),winner.id,f.budget)).toBe(false);
    expect(await ledger.reserve(tenant,winner.id,{...f.budget,period:'next-period'})).toBe(false);
    expect(await ledger.permits(tenant,winner.id,{...f.budget,limit:0})).toBe(false);
    expect(await new PlatformEmailAllowance(e,()=>Date.parse(f.budget.resetsAt)).permits(tenant,winner.id,f.budget)).toBe(false);
  });
  it('releases only proven unattempted cancellation and never revives its reservation',async()=>{
    const f=await fixture(),ledger=new PlatformEmailAllowance(e),tenant=f.actor.tenantId,job=f.jobs[0];
    expect(await ledger.reserve(tenant,job.id,f.budget)).toBe(true);
    await revokeInvitation(e,f.actor,job.invitationId);await f.outbox.reconcileAuthority(tenant,job.id);
    expect(await ledger.reconcile(tenant,job.id)).toBe(true);expect(await ledger.reconcile(tenant,job.id)).toBe(false);
    expect(await ledger.reserve(tenant,job.id,f.budget)).toBe(false);
    expect(await ledger.reserve(tenant,f.jobs[1].id,f.budget)).toBe(true);
  });
  it('retains ambiguous commitments and consumes provider acceptance without freeing another slot',async()=>{
    const f=await fixture(),ledger=new PlatformEmailAllowance(e),tenant=f.actor.tenantId,job=f.jobs[0];
    await ledger.reserve(tenant,job.id,f.budget);
    const claim=(await f.outbox.claim(tenant,job.id,'fixture'))!;
    await f.outbox.settle(claim,{state:'uncertain',code:'email_transport_uncertain'});
    expect(await ledger.reconcile(tenant,job.id)).toBe(false);
    expect(await ledger.reserve(tenant,f.jobs[1].id,f.budget)).toBe(false);
    const restarted=new InvitationEmailOutbox(e,()=>Date.now()+180000),retry=(await restarted.claim(tenant,job.id,'fixture'))!;
    expect(await ledger.reserve(tenant,job.id,f.budget)).toBe(true);
    await restarted.settle(retry,{state:'accepted',providerId:'4ef9a417-02e9-4d39-ad75-9611e0fcc33c'});
    expect(await ledger.reconcile(tenant,job.id)).toBe(true);
    expect(await ledger.permits(tenant,job.id,f.budget)).toBe(false);
    expect(await ledger.reserve(tenant,f.jobs[1].id,f.budget)).toBe(false);
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_platform_email_reservations WHERE job_id=?').bind(job.id).first()).toEqual({state:'consumed'});
  });
});
