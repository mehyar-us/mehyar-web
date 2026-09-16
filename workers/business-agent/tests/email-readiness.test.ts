import {env} from 'cloudflare:workers';
import {describe,it,expect} from 'vitest';
import type {Env} from '../src/env';
import {platformSenderConfiguration,requirePlatformSender,PLATFORM_EMAIL_GATES} from '../src/email/readiness';
import {VerifiedInvitationOutbox} from '../src/email/verified-outbox';
import {createTenant} from '../src/tenants';
import {inviteMember,revokeInvitation} from '../src/team';
import {PlatformEmailSupplierBudget} from '../src/email/supplier-budget';
import {platformEmailAccess} from '../src/email/access';
import {CATALOG_VERSION} from '../src/catalog';
import {RELEASE_GATES} from '../src/billing/service';
import {dispatchInvitationEmail} from '../src/email/dispatch';
async function activate(e:Env,tenantId:string){
  const now=new Date().toISOString(),until=new Date(Date.now()+86400000).toISOString();
  await e.AGENT_DB.prepare("UPDATE agent_tenants SET plan_id='business',status='active' WHERE id=?").bind(tenantId).run();
  await e.AGENT_DB.prepare("INSERT INTO agent_billing_subscriptions(tenant_id,stripe_subscription_id,plan_id,status,paid_through,updated_at,access_state,usage_anchor) VALUES (?,?,'business','active',?,?,'active',?)")
    .bind(tenantId,`sub_${crypto.randomUUID()}`,until,now,now).run();
  for(const [scope,gate] of [...RELEASE_GATES.map(g=>['catalog',g]),[tenantId,'activation_approved']])await e.AGENT_DB.prepare("INSERT INTO agent_billing_readiness(scope_id,gate,catalog_version,status,evidence_ref,verified_by,verified_at,valid_until) VALUES (?,?,?,'verified','fixture-only','test-operator',?,?) ON CONFLICT(scope_id,gate,catalog_version) DO UPDATE SET status='verified',valid_until=excluded.valid_until")
    .bind(scope,gate,CATALOG_VERSION,now,until).run();
}
async function invitation(e:Env){const userId=crypto.randomUUID(),tenant=await createTenant(e,userId,{name:'Oak Studio',website:'https://oakstudio.com',goal:'Help with scheduling'},crypto.randomUUID()),actor={userId,tenantId:tenant.id};const value=await inviteMember(e,actor,{email:`${crypto.randomUUID()}@example.test`,role:'staff'},crypto.randomUUID());await activate(e,tenant.id);return {actor,id:value.invitation.id};}
function fixture():Env{return {...env,ENVIRONMENT:'staging',APP_ORIGIN:'https://app.mehyar.us',AGENT_PLATFORM_EMAIL_ENABLED:'true',AGENT_PLATFORM_EMAIL_FROM:'notices@example.test',AGENT_PLATFORM_EMAIL_ROUTE:`resend:${crypto.randomUUID()}`,AGENT_PLATFORM_RESEND_API_KEY:'re_synthetic_fixture'} as unknown as Env;}
async function evidence(e:Env){
  const config=await platformSenderConfiguration(e),now=Date.now(),start=new Date(now-1000).toISOString(),end=new Date(now+86400000).toISOString();
  await e.AGENT_DB.batch(PLATFORM_EMAIL_GATES.map(gate=>e.AGENT_DB.prepare("INSERT INTO agent_platform_email_readiness(route_ref,gate,configuration_hash,status,evidence_ref,verified_by,verified_at,valid_until) VALUES (?,?,?,'verified','fixture-only','test-operator',?,?)").bind(config.routeRef,gate,config.configurationHash,start,end)));
  // Synthetic account/cost evidence, never a quote or production approval.
  await e.AGENT_DB.prepare("INSERT OR IGNORE INTO agent_email_supplier_budgets(account_ref,window_start,window_end,limit_microusd,job_microusd,status,evidence_ref,verified_by,verified_at,valid_until) VALUES (?,?,?,10000,100,'verified','fixture-only','test-operator',?,?)").bind(config.routeRef,start,end,start,end).run();
  await e.AGENT_DB.prepare('INSERT INTO agent_email_supplier_routes(configuration_hash,account_ref) VALUES (?,?)').bind(config.configurationHash,config.routeRef).run();
  return config;
}
describe('dedicated platform sender readiness',()=>{
  it('dispatches once across concurrent workers and durably records acceptance and capacity',async()=>{
    const e=fixture(),invite=await invitation(e);await evidence(e);const box=new VerifiedInvitationOutbox(e),job=await box.prepare(invite.actor,invite.id);let calls=0;
    const transport=async(_url:string,init:RequestInit)=>{calls++;expect(JSON.parse(String(init.body)).to).toHaveLength(1);return Response.json({id:'4ef9a417-02e9-4d39-ad75-9611e0fcc33c'});};
    const results=await Promise.all([dispatchInvitationEmail(e,invite.actor.tenantId,job.id,transport),dispatchInvitationEmail(e,invite.actor.tenantId,job.id,transport)]);
    expect(calls).toBe(1);expect(results).toContainEqual({state:'recorded',outcome:'accepted'});expect(results).toContainEqual({state:'not_claimed'});
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_platform_email_reservations WHERE job_id=?').bind(job.id).first()).toEqual({state:'consumed'});
    expect(await dispatchInvitationEmail(e,invite.actor.tenantId,job.id,transport)).toEqual({state:'not_claimed'});expect(calls).toBe(1);
  });
  it('recovers a lost response with the same payload and idempotency key after durable backoff',async()=>{
    const e=fixture(),invite=await invitation(e);await evidence(e);let now=Date.now();const box=new VerifiedInvitationOutbox(e,()=>now),job=await box.prepare(invite.actor,invite.id),requests:Array<{body:unknown;key:string|null}>=[];
    const transport=async(_url:string,init:RequestInit)=>{requests.push({body:init.body,key:new Headers(init.headers).get('Idempotency-Key')});if(requests.length===1)throw new Error('synthetic response lost');return Response.json({id:'4ef9a417-02e9-4d39-ad75-9611e0fcc33c'});};
    expect(await dispatchInvitationEmail(e,invite.actor.tenantId,job.id,transport,()=>now)).toEqual({state:'recorded',outcome:'uncertain'});
    const first=await e.AGENT_DB.prepare('SELECT first_attempt_at FROM agent_platform_email_outbox WHERE id=?').bind(job.id).first();
    expect(await dispatchInvitationEmail(e,invite.actor.tenantId,job.id,transport,()=>now)).toEqual({state:'not_claimed'});expect(requests).toHaveLength(1);
    now+=180000;
    expect(await dispatchInvitationEmail(e,invite.actor.tenantId,job.id,transport,()=>now)).toEqual({state:'recorded',outcome:'accepted'});
    expect(requests[1]).toEqual(requests[0]);expect(await e.AGENT_DB.prepare('SELECT first_attempt_at FROM agent_platform_email_outbox WHERE id=?').bind(job.id).first()).toEqual(first);
  });
  it('never transports disabled or suppressed mail and records acceptance after in-flight evidence withdrawal',async()=>{
    const e=fixture(),invite=await invitation(e),config=await evidence(e),box=new VerifiedInvitationOutbox(e),job=await box.prepare(invite.actor,invite.id);let calls=0;
    const transport=async()=>{calls++;await e.AGENT_DB.prepare("UPDATE agent_platform_email_readiness SET status='revoked' WHERE route_ref=?").bind(config.routeRef).run();return Response.json({id:'4ef9a417-02e9-4d39-ad75-9611e0fcc33c'});};
    e.AGENT_PLATFORM_EMAIL_ENABLED='false';await expect(dispatchInvitationEmail(e,invite.actor.tenantId,job.id,transport)).rejects.toMatchObject({code:'platform_email_disabled'});expect(calls).toBe(0);
    e.AGENT_PLATFORM_EMAIL_ENABLED='true';
    expect(await dispatchInvitationEmail(e,invite.actor.tenantId,job.id,transport)).toEqual({state:'recorded',outcome:'accepted'});expect(calls).toBe(1);
    const other=fixture(),otherInvite=await invitation(other);await evidence(other);const otherBox=new VerifiedInvitationOutbox(other),otherJob=await otherBox.prepare(otherInvite.actor,otherInvite.id);
    await other.AGENT_DB.prepare("INSERT INTO agent_platform_email_suppressions(recipient,scope_key,reason,status,evidence_ref,recorded_by,created_at,updated_at) SELECT recipient,'*','complaint','active','fixture-only','test-operator',created_at,created_at FROM agent_platform_email_outbox WHERE id=?").bind(otherJob.id).run();
    expect(await dispatchInvitationEmail(other,otherInvite.actor.tenantId,otherJob.id,transport)).toEqual({state:'not_claimed'});expect(calls).toBe(1);
  });
  it('enforces one supplier budget across simultaneous claims from separate tenants',async()=>{
    const e=fixture(),first=await invitation(e),second=await invitation(e),config=await evidence(e),box=new VerifiedInvitationOutbox(e);
    await e.AGENT_DB.prepare('UPDATE agent_email_supplier_budgets SET limit_microusd=100 WHERE account_ref=?').bind(config.routeRef).run();
    const jobs=await Promise.all([box.prepare(first.actor,first.id),box.prepare(second.actor,second.id)]);
    const outcomes=await Promise.allSettled([box.claim(first.actor.tenantId,jobs[0].id),box.claim(second.actor.tenantId,jobs[1].id)]);
    expect(outcomes.filter(v=>v.status==='fulfilled'&&v.value)).toHaveLength(1);
    expect(outcomes.filter(v=>v.status==='rejected')).toHaveLength(1);
    expect((outcomes.find(v=>v.status==='rejected') as PromiseRejectedResult).reason).toMatchObject({code:'email_supplier_budget_unavailable'});
    expect(await e.AGENT_DB.prepare("SELECT sum(amount_microusd) AS amount FROM agent_email_supplier_commitments WHERE account_ref=? AND status='held'").bind(config.routeRef).first()).toEqual({amount:100});
  });
  it('rechecks supplier revocation and preserves possible cost after provider acceptance',async()=>{
    const e=fixture(),invite=await invitation(e),config=await evidence(e),box=new VerifiedInvitationOutbox(e),job=await box.prepare(invite.actor,invite.id),claim=(await box.claim(invite.actor.tenantId,job.id))!;
    await e.AGENT_DB.prepare("UPDATE agent_email_supplier_budgets SET status='revoked' WHERE account_ref=?").bind(config.routeRef).run();
    expect(await box.mayDispatch(claim)).toBe(false);
    await box.settle(claim,{state:'accepted',providerId:'4ef9a417-02e9-4d39-ad75-9611e0fcc33c'});
    expect(await e.AGENT_DB.prepare('SELECT status,amount_microusd FROM agent_email_supplier_commitments WHERE job_id=?').bind(job.id).first()).toEqual({status:'held',amount_microusd:100});
  });
  it('fails closed on missing routes, cost increases and expired evidence, releasing only unattempted cancellation',async()=>{
    const e=fixture(),invite=await invitation(e),config=await evidence(e),box=new VerifiedInvitationOutbox(e),job=await box.prepare(invite.actor,invite.id),supplier=new PlatformEmailSupplierBudget(e);
    expect(await supplier.reserve(invite.actor.tenantId,job.id,'missing')).toBe(false);
    expect(await supplier.reserve(invite.actor.tenantId,job.id,config.configurationHash)).toBe(true);
    expect(await supplier.reserve(invite.actor.tenantId,job.id,config.configurationHash)).toBe(true);
    expect(await supplier.permits(crypto.randomUUID(),job.id,config.configurationHash)).toBe(false);
    await e.AGENT_DB.prepare('UPDATE agent_email_supplier_budgets SET job_microusd=101 WHERE account_ref=?').bind(config.routeRef).run();
    expect(await supplier.permits(invite.actor.tenantId,job.id,config.configurationHash)).toBe(false);
    await e.AGENT_DB.prepare("UPDATE agent_email_supplier_budgets SET job_microusd=100,valid_until='2000-01-01T00:00:00Z' WHERE account_ref=?").bind(config.routeRef).run();
    expect(await supplier.permits(invite.actor.tenantId,job.id,config.configurationHash)).toBe(false);
    await revokeInvitation(e,invite.actor,invite.id);await box.reconcileAuthority(invite.actor.tenantId,job.id);
    expect(await e.AGENT_DB.prepare('SELECT status FROM agent_email_supplier_commitments WHERE job_id=?').bind(job.id).first()).toEqual({status:'released'});
  });
  it('resolves catalog email allowances in monthly anniversary windows even with annual billing',async()=>{
    const e=fixture(),invite=await invitation(e),tenant=invite.actor.tenantId,anchor=new Date(Date.now()-1000).toISOString();
    await e.AGENT_DB.prepare("UPDATE agent_billing_subscriptions SET billing_interval='annual',usage_anchor=? WHERE tenant_id=?").bind(anchor,tenant).run();
    for(const [plan,limit] of [['business',1000],['growth',3000],['operations',10000]] as const){
      await e.AGENT_DB.batch([e.AGENT_DB.prepare('UPDATE agent_tenants SET plan_id=? WHERE id=?').bind(plan,tenant),e.AGENT_DB.prepare('UPDATE agent_billing_subscriptions SET plan_id=? WHERE tenant_id=?').bind(plan,tenant)]);
      const access=await platformEmailAccess(e,tenant);expect(access.limit).toBe(limit);expect(access.period.endsWith(anchor)).toBe(true);
      expect(Date.parse(access.resetsAt)-Date.parse(anchor)).toBeLessThanOrEqual(31*86400000);
    }
  });
  it('rejects invalid subscription authority and rechecks expiry after an email claim',async()=>{
    const e=fixture(),invite=await invitation(e),tenant=invite.actor.tenantId;await evidence(e);
    const box=new VerifiedInvitationOutbox(e),job=await box.prepare(invite.actor,invite.id),claim=(await box.claim(tenant,job.id))!;
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_platform_email_reservations WHERE job_id=?').bind(job.id).first()).toEqual({state:'held'});
    await e.AGENT_DB.prepare("UPDATE agent_billing_subscriptions SET paid_through='2000-01-01T00:00:00Z' WHERE tenant_id=?").bind(tenant).run();
    await expect(box.mayDispatch(claim)).rejects.toMatchObject({code:'email_subscription_expired'});
    expect(await box.settle(claim,{state:'accepted',providerId:'4ef9a417-02e9-4d39-ad75-9611e0fcc33c'})).toBe(true);
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_platform_email_reservations WHERE job_id=?').bind(job.id).first()).toEqual({state:'consumed'});
    for(const change of ["dispute_state='open'","catalog_version='obsolete'","plan_id='growth'"]){
      await e.AGENT_DB.prepare(`UPDATE agent_billing_subscriptions SET ${change} WHERE tenant_id=?`).bind(tenant).run();
      await expect(platformEmailAccess(e,tenant)).rejects.toMatchObject({code:'email_subscription_required'});
      await e.AGENT_DB.prepare("UPDATE agent_billing_subscriptions SET dispute_state=NULL,catalog_version=?,plan_id='business' WHERE tenant_id=?").bind(CATALOG_VERSION,tenant).run();
    }
  });
  it('rejects trial and revoked activation without claiming a provider attempt',async()=>{
    const e=fixture(),invite=await invitation(e),tenant=invite.actor.tenantId;await evidence(e);
    const box=new VerifiedInvitationOutbox(e),job=await box.prepare(invite.actor,invite.id);
    await e.AGENT_DB.prepare("UPDATE agent_tenants SET plan_id='trial',status='trial' WHERE id=?").bind(tenant).run();
    await expect(box.claim(tenant,job.id)).rejects.toMatchObject({code:'email_subscription_required'});
    await e.AGENT_DB.prepare("UPDATE agent_tenants SET plan_id='business',status='active' WHERE id=?").bind(tenant).run();
    await e.AGENT_DB.prepare("UPDATE agent_billing_readiness SET status='revoked' WHERE scope_id=?").bind(tenant).run();
    await expect(box.claim(tenant,job.id)).rejects.toMatchObject({code:'activation_not_ready'});
    expect(await e.AGENT_DB.prepare('SELECT attempts FROM agent_platform_email_outbox WHERE id=?').bind(job.id).first()).toEqual({attempts:0});
  });
  it('binds prepared jobs to verified credentials rather than a reusable routing label',async()=>{
    const e=fixture(),invite=await invitation(e),config=await evidence(e),box=new VerifiedInvitationOutbox(e),job=await box.prepare(invite.actor,invite.id);
    expect(await e.AGENT_DB.prepare('SELECT route_ref FROM agent_platform_email_outbox WHERE id=?').bind(job.id).first()).toEqual({route_ref:`resend:${config.configurationHash}`});
    e.AGENT_PLATFORM_RESEND_API_KEY='re_changed_account';await evidence(e);
    expect(await box.claim(invite.actor.tenantId,job.id)).toBeNull();
    await expect(box.prepare(invite.actor,invite.id)).rejects.toMatchObject({code:'email_payload_changed'});
    expect(await e.AGENT_DB.prepare('SELECT attempts,state FROM agent_platform_email_outbox WHERE id=?').bind(job.id).first()).toEqual({attempts:0,state:'prepared'});
  });
  it('rechecks readiness before dispatch but retains an accepted outcome after readiness withdrawal',async()=>{
    const e=fixture(),invite=await invitation(e),config=await evidence(e),box=new VerifiedInvitationOutbox(e),job=await box.prepare(invite.actor,invite.id),claim=(await box.claim(invite.actor.tenantId,job.id))!;
    expect(await box.mayDispatch(claim)).toBe(true);
    await e.AGENT_DB.prepare("UPDATE agent_platform_email_readiness SET status='revoked' WHERE route_ref=?").bind(config.routeRef).run();
    await expect(box.mayDispatch(claim)).rejects.toMatchObject({code:'platform_email_not_ready'});
    expect(await box.settle(claim,{state:'accepted',providerId:'4ef9a417-02e9-4d39-ad75-9611e0fcc33c'})).toBe(true);
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_platform_email_outbox WHERE id=?').bind(job.id).first()).toEqual({state:'accepted'});
  });
  it('does not prepare or claim mail when disabled and refuses a changed sender on an existing claim',async()=>{
    const e=fixture(),invite=await invitation(e),box=new VerifiedInvitationOutbox(e);e.AGENT_PLATFORM_EMAIL_ENABLED='false';
    await expect(box.prepare(invite.actor,invite.id)).rejects.toMatchObject({code:'platform_email_disabled'});
    expect(await e.AGENT_DB.prepare('SELECT id FROM agent_platform_email_outbox WHERE invitation_id=?').bind(invite.id).first()).toBeNull();
    e.AGENT_PLATFORM_EMAIL_ENABLED='true';await evidence(e);const job=await box.prepare(invite.actor,invite.id),claim=(await box.claim(invite.actor.tenantId,job.id))!;
    e.AGENT_PLATFORM_EMAIL_FROM='changed@example.test';await evidence(e);expect(await box.mayDispatch(claim)).toBe(false);
    e.AGENT_PLATFORM_EMAIL_ENABLED='false';await expect(box.claim(invite.actor.tenantId,job.id)).rejects.toMatchObject({code:'platform_email_disabled'});
  });
  it('remains disabled before touching provider configuration or the database and never falls back to legacy keys',async()=>{
    const e={AGENT_PLATFORM_EMAIL_ENABLED:'false'} as Env;await expect(requirePlatformSender(e)).rejects.toMatchObject({code:'platform_email_disabled'});
    const legacy={...fixture(),AGENT_PLATFORM_RESEND_API_KEY:undefined,RESEND_API_KEY:'re_legacy',RESEND_FROM_EMAIL:'legacy@example.test'};await expect(requirePlatformSender(legacy)).rejects.toMatchObject({code:'platform_email_unconfigured'});
  });
  it('requires complete evidence bound to exact sender, credential, environment, route and origin',async()=>{
    const e=fixture();await expect(requirePlatformSender(e)).rejects.toMatchObject({code:'platform_email_not_ready'});
    const config=await evidence(e);expect(await requirePlatformSender(e)).toEqual(config);expect(JSON.stringify(config)).not.toContain(e.AGENT_PLATFORM_RESEND_API_KEY!);
    for(const change of [{AGENT_PLATFORM_EMAIL_FROM:'other@example.test'},{AGENT_PLATFORM_RESEND_API_KEY:'re_rotated'},{ENVIRONMENT:'production' as const},{AGENT_PLATFORM_EMAIL_ROUTE:'other'},{APP_ORIGIN:'https://other.mehyar.us'}])await expect(requirePlatformSender({...e,...change})).rejects.toMatchObject({code:'platform_email_not_ready'});
  });
  it('rejects revoked, empty, expired, future-dated or overly long evidence and unsafe origins',async()=>{
    for(const change of ["status='revoked'","evidence_ref=' '","verified_by=' '","valid_until='2000-01-01T00:00:00Z'","verified_at='2999-01-01T00:00:00Z'","valid_until='2999-01-01T00:00:00Z'"]){const e=fixture(),config=await evidence(e);await e.AGENT_DB.prepare(`UPDATE agent_platform_email_readiness SET ${change} WHERE route_ref=? AND gate=?`).bind(config.routeRef,PLATFORM_EMAIL_GATES[0]).run();await expect(requirePlatformSender(e)).rejects.toMatchObject({code:'platform_email_not_ready'});}
    for(const APP_ORIGIN of ['http://app.mehyar.us','https://app.mehyar.us/path','https://user:pass@app.mehyar.us','https://app.mehyar.us/?next=other'])await expect(platformSenderConfiguration({...fixture(),APP_ORIGIN})).rejects.toMatchObject({code:'platform_email_origin_unverified'});
  });
});
