import {env} from 'cloudflare:workers';
import {describe,it,expect} from 'vitest';
import type {Env} from '../src/env';
import {createTenant} from '../src/tenants';
import {inviteMember} from '../src/team';
import {InvitationEmailOutbox} from '../src/email/outbox';
import {PlatformEmailAllowance} from '../src/email/allowance';
import {runEmailMaintenance} from '../src/email/maintenance';
import {cancelInvitationEmail} from '../src/email/customer';
const e={...env,APP_ORIGIN:'https://app.mehyar.us',AGENT_PLATFORM_EMAIL_ENABLED:'false',AGENT_PLATFORM_EMAIL_RECOVERY_ENABLED:'false'} as unknown as Env;
async function fixture(){
  const userId=crypto.randomUUID(),tenant=await createTenant(e,userId,{name:'Oak Studio',website:'https://oakstudio.com',goal:'Manage appointments'},crypto.randomUUID()),actor={userId,tenantId:tenant.id};
  const invite=await inviteMember(e,actor,{email:`${crypto.randomUUID()}@example.test`,role:'staff'},crypto.randomUUID()),outbox=new InvitationEmailOutbox(e),job=await outbox.prepare(actor,invite.invitation.id,{from:'notices@example.test',routeRef:'fixture'});
  await new PlatformEmailAllowance(e).reserve(tenant.id,job.id,{period:'fixture',resetsAt:new Date(Date.now()+86400000).toISOString(),limit:1});
  return {actor,invite:invite.invitation,job,outbox};
}
describe('local email maintenance independent of sending',()=>{
  it('preserves active leases and settles cancelled abandoned attempts while paused and disabled',async()=>{
    const f=await fixture(),claim=(await f.outbox.claim(f.actor.tenantId,f.job.id,'fixture'))!;
    await cancelInvitationEmail(e,f.actor,f.invite.id);await e.AGENT_DB.prepare("UPDATE agent_tenants SET status='paused' WHERE id=?").bind(f.actor.tenantId).run();
    expect(await runEmailMaintenance(e)).toEqual({checked:0,failed:0});
    expect(await runEmailMaintenance(e,()=>Date.now()+91000)).toEqual({checked:1,failed:0});
    expect(await e.AGENT_DB.prepare('SELECT state,attempts FROM agent_platform_email_outbox WHERE id=?').bind(f.job.id).first()).toEqual({state:'review_required',attempts:1});
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_platform_email_reservations WHERE job_id=?').bind(f.job.id).first()).toEqual({state:'held'});
    expect(await f.outbox.settle(claim,{state:'accepted',providerId:'4ef9a417-02e9-4d39-ad75-9611e0fcc33c'})).toBe(false);
  });
  it('repairs interrupted cancellation and accepted-capacity settlement without a provider call',async()=>{
    const cancelled=await fixture(),accepted=await fixture();
    await e.AGENT_DB.prepare('UPDATE agent_platform_email_outbox SET cancel_requested_at=?,cancel_requested_by=? WHERE id=?').bind(new Date().toISOString(),cancelled.actor.userId,cancelled.job.id).run();
    const claim=(await accepted.outbox.claim(accepted.actor.tenantId,accepted.job.id,'fixture'))!;
    await accepted.outbox.settle(claim,{state:'accepted',providerId:'4ef9a417-02e9-4d39-ad75-9611e0fcc33c'}); // simulate interruption before allowance reconciliation
    expect(await runEmailMaintenance(e)).toEqual({checked:2,failed:0});
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_platform_email_reservations WHERE job_id=?').bind(cancelled.job.id).first()).toEqual({state:'released'});
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_platform_email_reservations WHERE job_id=?').bind(accepted.job.id).first()).toEqual({state:'consumed'});
    expect(await runEmailMaintenance(e)).toEqual({checked:0,failed:0});
    expect(await e.AGENT_DB.prepare('SELECT status FROM agent_team_invitations WHERE id=?').bind(cancelled.invite.id).first()).toEqual({status:'pending'});
  });
  it('bounds cleanup and leaves healthy paused jobs resumable',async()=>{
    const healthy=await fixture();await e.AGENT_DB.prepare("UPDATE agent_tenants SET status='paused' WHERE id=?").bind(healthy.actor.tenantId).run();
    for(let i=0;i<26;i++){const f=await fixture();await e.AGENT_DB.prepare("UPDATE agent_team_invitations SET status='revoked' WHERE id=?").bind(f.invite.id).run();}
    expect(await runEmailMaintenance(e)).toEqual({checked:25,failed:0});expect(await runEmailMaintenance(e)).toEqual({checked:1,failed:0});
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_platform_email_outbox WHERE id=?').bind(healthy.job.id).first()).toEqual({state:'prepared'});
  });
});
