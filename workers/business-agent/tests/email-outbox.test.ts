import {env} from 'cloudflare:workers';
import {describe,it,expect} from 'vitest';
import type {Env} from '../src/env';
import {createTenant} from '../src/tenants';
import {inviteMember,revokeInvitation} from '../src/team';
import {InvitationEmailOutbox} from '../src/email/outbox';
import {PlatformResendClient} from '../src/email/resend';
const e={...env,APP_ORIGIN:'https://app.mehyar.us'} as unknown as Env,uid=()=>crypto.randomUUID();
async function fixture(){
  const userId=uid(),tenant=await createTenant(e,userId,{name:'Oak Studio',website:'https://oakstudio.com',goal:'Manage appointments'},uid()),actor={userId,tenantId:tenant.id};
  const invitation=await inviteMember(e,actor,{email:`${uid()}@example.test`,role:'staff'},uid());
  return {actor,invitationId:invitation.invitation.id};
}
const config={from:'notices@example.test',routeRef:'resend:verified-route-fixture'},providerId='4ef9a417-02e9-4d39-ad75-9611e0fcc33c';
describe('durable invitation email state',()=>{
  it('cancels only unattempted invalid invitations and keeps paused work resumable',async()=>{
    const f=await fixture(),box=new InvitationEmailOutbox(e),prepared=await box.prepare(f.actor,f.invitationId,config);
    await e.AGENT_DB.prepare("UPDATE agent_tenants SET status='paused' WHERE id=?").bind(f.actor.tenantId).run();
    expect(await box.reconcileAuthority(f.actor.tenantId,prepared.id)).toBe(false);expect(await box.claim(f.actor.tenantId,prepared.id,config.routeRef)).toBeNull();
    await e.AGENT_DB.prepare("UPDATE agent_tenants SET status='trial' WHERE id=?").bind(f.actor.tenantId).run();
    await revokeInvitation(e,f.actor,f.invitationId);expect(await box.reconcileAuthority(f.actor.tenantId,prepared.id)).toBe(true);
    expect(await e.AGENT_DB.prepare('SELECT state,first_attempt_at FROM agent_platform_email_outbox WHERE id=?').bind(prepared.id).first()).toEqual({state:'cancelled',first_attempt_at:null});
    expect(await box.reconcileAuthority(f.actor.tenantId,prepared.id)).toBe(false);
    const other=await fixture();let now=Date.now();const timed=new InvitationEmailOutbox(e,()=>now),expired=await timed.prepare(other.actor,other.invitationId,config);now+=8*86400000;
    expect(await timed.reconcileAuthority(other.actor.tenantId,expired.id)).toBe(true);
    expect(await timed.claim(other.actor.tenantId,expired.id,config.routeRef)).toBeNull();
  });
  it('rechecks immutable claims before dispatch and preserves uncertainty when authority is lost in flight',async()=>{
    const f=await fixture();let now=Date.now();const box=new InvitationEmailOutbox(e,()=>now),prepared=await box.prepare(f.actor,f.invitationId,config),claim=(await box.claim(f.actor.tenantId,prepared.id,config.routeRef))!;
    expect(await box.mayDispatch(claim,config.routeRef)).toBe(true);
    expect(await box.mayDispatch({...claim,message:{...claim.message,to:['foreign@example.test']}},config.routeRef)).toBe(false);
    expect(await box.mayDispatch({...claim,firstAttemptAt:new Date(now+1).toISOString()},config.routeRef)).toBe(false);
    expect(await box.mayDispatch(claim,'other-route')).toBe(false);
    await revokeInvitation(e,f.actor,f.invitationId);expect(await box.mayDispatch(claim,config.routeRef)).toBe(false);
    expect(await box.reconcileAuthority(f.actor.tenantId,prepared.id)).toBe(false); // active lease may have an in-flight request
    now+=91000;expect(await box.reconcileAuthority(f.actor.tenantId,prepared.id)).toBe(true);
    expect(await e.AGENT_DB.prepare('SELECT state,attempts FROM agent_platform_email_outbox WHERE id=?').bind(prepared.id).first()).toEqual({state:'review_required',attempts:1});
    expect(await box.settle(claim,{state:'accepted',providerId})).toBe(false);
  });
  it('freezes one owned invitation payload and records provider acceptance without claiming delivery',async()=>{
    const f=await fixture(),box=new InvitationEmailOutbox(e),prepared=await box.prepare(f.actor,f.invitationId,config);
    expect(await box.prepare(f.actor,f.invitationId,config)).toEqual(prepared);
    await expect(box.prepare(f.actor,f.invitationId,{...config,routeRef:'other'})).rejects.toMatchObject({code:'email_payload_changed'});
    const claims=await Promise.all([box.claim(f.actor.tenantId,prepared.id,config.routeRef),box.claim(f.actor.tenantId,prepared.id,config.routeRef)]);expect(claims.filter(Boolean)).toHaveLength(1);
    const claim=claims.find(Boolean)!;let calls=0;const client=new PlatformResendClient('re_fixture',async()=>{calls++;return Response.json({id:providerId});});
    expect(await box.settle(claim,await client.send(claim.message,claim.idempotencyKey,claim.firstAttemptAt))).toBe(true);expect(calls).toBe(1);
    expect(await box.claim(f.actor.tenantId,prepared.id,config.routeRef)).toBeNull();
    expect(await e.AGENT_DB.prepare('SELECT state,provider_id,attempts FROM agent_platform_email_outbox WHERE id=?').bind(prepared.id).first()).toEqual({state:'accepted',provider_id:providerId,attempts:1});
  });
  it('recovers expired leases using the original payload, key and first-attempt time and fences old results',async()=>{
    const f=await fixture();let now=Date.now();const box=new InvitationEmailOutbox(e,()=>now),prepared=await box.prepare(f.actor,f.invitationId,config),first=(await box.claim(f.actor.tenantId,prepared.id,config.routeRef))!;
    now+=91000;const restarted=new InvitationEmailOutbox(e,()=>now),second=(await restarted.claim(f.actor.tenantId,prepared.id,config.routeRef))!;
    expect(second.message).toEqual(first.message);expect(second.idempotencyKey).toBe(first.idempotencyKey);expect(second.firstAttemptAt).toBe(first.firstAttemptAt);expect(second.token).not.toBe(first.token);
    expect(await box.settle(first,{state:'accepted',providerId})).toBe(false);
    expect(await restarted.settle(second,{state:'uncertain',code:'email_transport_uncertain'})).toBe(true);
    expect(await restarted.claim(f.actor.tenantId,prepared.id,config.routeRef)).toBeNull();now+=241000;
    const third=(await restarted.claim(f.actor.tenantId,prepared.id,config.routeRef))!;expect(third.firstAttemptAt).toBe(first.firstAttemptAt);
    await restarted.settle(third,{state:'rejected',code:'email_request_rejected'});
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_platform_email_outbox WHERE id=?').bind(prepared.id).first()).toEqual({state:'review_required'});
  });
  it('refuses foreign routing, revoked invitations, changed owner authority and expired deduplication windows',async()=>{
    const f=await fixture(),other=await fixture();let now=Date.now();const box=new InvitationEmailOutbox(e,()=>now),prepared=await box.prepare(f.actor,f.invitationId,config);
    expect(await box.claim(other.actor.tenantId,prepared.id,config.routeRef)).toBeNull();expect(await box.claim(f.actor.tenantId,prepared.id,'changed-route')).toBeNull();
    const first=(await box.claim(f.actor.tenantId,prepared.id,config.routeRef))!;now+=23*3600000;
    expect(await box.claim(f.actor.tenantId,prepared.id,config.routeRef)).toBeNull();expect(await box.settle(first,{state:'accepted',providerId})).toBe(false);
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_platform_email_outbox WHERE id=?').bind(prepared.id).first()).toEqual({state:'review_required'});
    const otherJob=await box.prepare(other.actor,other.invitationId,config);await revokeInvitation(e,other.actor,other.invitationId);expect(await box.claim(other.actor.tenantId,otherJob.id,config.routeRef)).toBeNull();
    const third=await fixture(),thirdJob=await box.prepare(third.actor,third.invitationId,config);
    await e.AGENT_DB.prepare("UPDATE agent_memberships SET role='manager' WHERE tenant_id=? AND user_id=?").bind(third.actor.tenantId,third.actor.userId).run();expect(await box.claim(third.actor.tenantId,thirdJob.id,config.routeRef)).toBeNull();
  });
});
