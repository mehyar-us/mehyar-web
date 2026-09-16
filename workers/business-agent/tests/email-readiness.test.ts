import {env} from 'cloudflare:workers';
import {describe,it,expect} from 'vitest';
import type {Env} from '../src/env';
import {platformSenderConfiguration,requirePlatformSender,PLATFORM_EMAIL_GATES} from '../src/email/readiness';
import {VerifiedInvitationOutbox} from '../src/email/verified-outbox';
import {createTenant} from '../src/tenants';
import {inviteMember,revokeInvitation,teamDirectory} from '../src/team';
import {queueInvitationEmail} from '../src/email/customer';
import {platformEmailUsage,emailUsageWarning} from '../src/email/usage';
import {handleEmailWebhook,linkEmailWebhookHints} from '../src/email/webhook';
import {PlatformEmailSupplierBudget} from '../src/email/supplier-budget';
import {platformEmailAccess} from '../src/email/access';
import {CATALOG_VERSION} from '../src/catalog';
import {RELEASE_GATES} from '../src/billing/service';
import {dispatchInvitationEmail} from '../src/email/dispatch';
import {reconcileInvitationDelivery} from '../src/email/delivery';
import {runEmailRecovery} from '../src/email/recovery';
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
  async function notification(e:Env,providerId:string,id=crypto.randomUUID(),type='email.complained'){
    e.AGENT_PLATFORM_EMAIL_WEBHOOK_ENABLED='true';e.AGENT_PLATFORM_EMAIL_WEBHOOK_SECRET='whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    const raw=JSON.stringify({type,created_at:new Date().toISOString(),data:{email_id:providerId}}),stamp=String(Math.floor(Date.now()/1000));
    const key=await crypto.subtle.importKey('raw',new Uint8Array(32),{name:'HMAC',hash:'SHA-256'},false,['sign']),signed=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${id}.${stamp}.${raw}`)));
    const signature=btoa(String.fromCharCode(...signed));return new Request('https://app.mehyar.us/api/platform-email/webhook',{method:'POST',body:raw,headers:{'svix-id':id,'svix-timestamp':stamp,'svix-signature':`v1,${signature}`}});
  }
  it('deduplicates signed receipt hints and wakes exhausted polling without trusting the event as delivery',async()=>{
    const f=await accepted(),config=await platformSenderConfiguration(f.e),request=await notification(f.e,'4ef9a417-02e9-4d39-ad75-9611e0fcc33c');
    await f.e.AGENT_DB.prepare('INSERT INTO agent_platform_email_delivery(job_id,tenant_id,next_check_at,checks) VALUES (?,?,?,48)').bind(f.job.id,f.invite.actor.tenantId,new Date(Date.now()+86400000).toISOString()).run();
    expect((await handleEmailWebhook(request.clone(),f.e)).status).toBe(202);expect((await handleEmailWebhook(request.clone(),f.e)).status).toBe(202);
    await linkEmailWebhookHints(f.e,`resend:${config.configurationHash}`);
    expect(await f.e.AGENT_DB.prepare('SELECT checks,complained_seen FROM agent_platform_email_delivery WHERE job_id=?').bind(f.job.id).first()).toEqual({checks:47,complained_seen:0});
    expect(await f.e.AGENT_DB.prepare('SELECT recipient FROM agent_platform_email_suppressions WHERE recipient=?').bind(f.message.to[0]).first()).toBeNull();
    await f.e.AGENT_DB.prepare('UPDATE agent_platform_email_delivery SET checks=48 WHERE job_id=?').bind(f.job.id).run();
    await handleEmailWebhook(request.clone(),f.e);await linkEmailWebhookHints(f.e,`resend:${config.configurationHash}`);
    expect(await f.e.AGENT_DB.prepare('SELECT checks FROM agent_platform_email_delivery WHERE job_id=?').bind(f.job.id).first()).toEqual({checks:48});
  });
  it('retains early events for reconciliation and rejects signed event-ID payload changes',async()=>{
    const e=fixture();await evidence(e);const providerId=crypto.randomUUID(),id=crypto.randomUUID(),request=await notification(e,providerId,id);
    await handleEmailWebhook(request,e);const config=await platformSenderConfiguration(e);await linkEmailWebhookHints(e,`resend:${config.configurationHash}`);
    expect(await e.AGENT_DB.prepare('SELECT state,attempts FROM agent_platform_email_events WHERE event_id=?').bind(id).first()).toEqual({state:'pending',attempts:1});
    await expect(handleEmailWebhook(await notification(e,providerId,id,'email.bounced'),e)).rejects.toMatchObject({code:'email_webhook_conflict'});
    const invite=await invitation(e),box=new VerifiedInvitationOutbox(e),job=await box.prepare(invite.actor,invite.id),claim=(await box.claim(invite.actor.tenantId,job.id))!;
    await box.settle(claim,{state:'accepted',providerId});
    await linkEmailWebhookHints(e,`resend:${config.configurationHash}`,()=>Date.now()+3600001);
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_platform_email_events WHERE event_id=?').bind(id).first()).toEqual({state:'linked'});
    expect(await e.AGENT_DB.prepare('SELECT job_id FROM agent_platform_email_delivery WHERE job_id=? AND tenant_id=?').bind(job.id,invite.actor.tenantId).first()).toEqual({job_id:job.id});
  });
  it('keeps webhook intake disabled before database access',async()=>{
    await expect(handleEmailWebhook(new Request('https://example.test',{method:'POST',body:'{}'}),{} as Env)).rejects.toMatchObject({code:'email_webhook_disabled'});
  });
  it.each([[699,'normal'],[700,'70'],[900,'90'],[1000,'100'],[1001,'100']] as const)('warns at email capacity thresholds %s', (used,expected)=>{expect(emailUsageWarning(used,1000)).toBe(expected);});
  it('reports held versus accepted capacity privately and denies non-billing roles',async()=>{
    const e=fixture(),invite=await invitation(e);await evidence(e);const box=new VerifiedInvitationOutbox(e),job=await box.prepare(invite.actor,invite.id),claim=(await box.claim(invite.actor.tenantId,job.id))!;
    const held=await platformEmailUsage(e,invite.actor);expect(held).toMatchObject({state:'available',accepted:0,reserved:1,limit:1000,remaining:999,warning:'normal',deliveryEnabled:false});expect(JSON.stringify(held)).not.toContain('sub_');
    await box.settle(claim,{state:'accepted',providerId:'4ef9a417-02e9-4d39-ad75-9611e0fcc33c'});
    expect(await platformEmailUsage(e,invite.actor)).toMatchObject({accepted:1,reserved:0,remaining:999});
    const other=await invitation(e);expect(await platformEmailUsage(e,other.actor)).toMatchObject({accepted:0,reserved:0,remaining:1000});
    await e.AGENT_DB.prepare("UPDATE agent_memberships SET role='billing' WHERE tenant_id=? AND user_id=?").bind(invite.actor.tenantId,invite.actor.userId).run();expect(await platformEmailUsage(e,invite.actor)).toMatchObject({accepted:1});
    await e.AGENT_DB.prepare("UPDATE agent_memberships SET role='manager' WHERE tenant_id=? AND user_id=?").bind(invite.actor.tenantId,invite.actor.userId).run();await expect(platformEmailUsage(e,invite.actor)).rejects.toMatchObject({code:'permission_denied'});
  });
  it('does not report a zero balance as verified when subscription access is unavailable',async()=>{
    const e=fixture(),invite=await invitation(e);await e.AGENT_DB.prepare("UPDATE agent_billing_subscriptions SET paid_through='2000-01-01T00:00:00Z' WHERE tenant_id=?").bind(invite.actor.tenantId).run();
    expect(await platformEmailUsage(e,invite.actor)).toEqual({state:'unavailable'});
  });
  it('queues one frozen email only on an authorized explicit owner request and presents private delivery state',async()=>{
    const e=fixture();e.AGENT_PLATFORM_EMAIL_RECOVERY_ENABLED='true';const invite=await invitation(e);await evidence(e);
    const before=await teamDirectory(e,invite.actor);expect(before.emailQueueEnabled).toBe(true);expect(before.invitations[0].emailDelivery.state).toBe('not_queued');
    expect(await queueInvitationEmail(e,invite.actor,invite.id)).toEqual({email:{state:'queued',checkedAt:null}});
    expect(await queueInvitationEmail(e,invite.actor,invite.id)).toEqual({email:{state:'queued',checkedAt:null}});
    expect(await e.AGENT_DB.prepare('SELECT count(*) AS count FROM agent_platform_email_outbox WHERE invitation_id=?').bind(invite.id).first()).toEqual({count:1});
    const directory=await teamDirectory(e,invite.actor);expect(directory.invitations[0].emailDelivery.state).toBe('queued');
    expect(JSON.stringify(directory)).not.toContain('configurationHash');expect(JSON.stringify(directory)).not.toContain('re_synthetic_fixture');expect(JSON.stringify(directory)).not.toContain('payload_json');
    const other=await invitation(e);await expect(queueInvitationEmail(e,other.actor,invite.id)).rejects.toMatchObject({code:'invitation_email_unavailable'});
    await e.AGENT_DB.prepare("UPDATE agent_memberships SET role='manager' WHERE tenant_id=? AND user_id=?").bind(invite.actor.tenantId,invite.actor.userId).run();
    await expect(queueInvitationEmail(e,invite.actor,invite.id)).rejects.toMatchObject({code:'permission_denied'});
    await expect(teamDirectory(e,invite.actor)).rejects.toMatchObject({code:'permission_denied'});
  });
  it('does not queue an email while recovery is disabled or billing is expired',async()=>{
    const e=fixture(),invite=await invitation(e);await evidence(e);
    await expect(queueInvitationEmail(e,invite.actor,invite.id)).rejects.toMatchObject({code:'platform_email_disabled'});
    expect((await teamDirectory(e,invite.actor)).emailQueueEnabled).toBe(false);
    e.AGENT_PLATFORM_EMAIL_RECOVERY_ENABLED='true';
    await e.AGENT_DB.prepare("UPDATE agent_billing_subscriptions SET paid_through='2000-01-01T00:00:00Z' WHERE tenant_id=?").bind(invite.actor.tenantId).run();
    await expect(queueInvitationEmail(e,invite.actor,invite.id)).rejects.toMatchObject({code:'email_subscription_expired'});
    expect(await e.AGENT_DB.prepare('SELECT id FROM agent_platform_email_outbox WHERE invitation_id=?').bind(invite.id).first()).toBeNull();
  });
  it('keeps recovery disabled before database or credential access',async()=>{
    expect(await runEmailRecovery({AGENT_PLATFORM_EMAIL_ENABLED:'true'} as Env)).toEqual({disabled:true,sent:0,checked:0,deferred:0});
    expect(await runEmailRecovery({AGENT_PLATFORM_EMAIL_RECOVERY_ENABLED:'true'} as Env)).toEqual({disabled:true,sent:0,checked:0,deferred:0});
  });
  it('recovers healthy jobs despite blocked billing and checks delivery on a later tick without resending',async()=>{
    const e=fixture();e.AGENT_PLATFORM_EMAIL_RECOVERY_ENABLED='true';const bad=await invitation(e),good=await invitation(e);await evidence(e);const box=new VerifiedInvitationOutbox(e),badJob=await box.prepare(bad.actor,bad.id),goodJob=await box.prepare(good.actor,good.id);
    await e.AGENT_DB.prepare("UPDATE agent_billing_subscriptions SET paid_through='2000-01-01T00:00:00Z' WHERE tenant_id=?").bind(bad.actor.tenantId).run();
    const stored=await e.AGENT_DB.prepare('SELECT payload_json FROM agent_platform_email_outbox WHERE id=?').bind(goodJob.id).first<{payload_json:string}>();let sends=0,reads=0;
    const transport=async(_url:string,init:RequestInit)=>{if(init.method==='GET'){reads++;return Response.json({...JSON.parse(stored!.payload_json),id:'4ef9a417-02e9-4d39-ad75-9611e0fcc33c',cc:[],bcc:[],last_event:'delivered'});}sends++;return Response.json({id:'4ef9a417-02e9-4d39-ad75-9611e0fcc33c'});};
    expect(await runEmailRecovery(e,transport)).toEqual({disabled:false,sent:1,checked:0,deferred:1});
    const blocked=await e.AGENT_DB.prepare('SELECT attempts,next_attempt_at FROM agent_platform_email_outbox WHERE id=?').bind(badJob.id).first<{attempts:number;next_attempt_at:string}>();expect(blocked!.attempts).toBe(0);expect(Date.parse(blocked!.next_attempt_at)).toBeGreaterThan(Date.now());
    expect(await runEmailRecovery(e,transport)).toEqual({disabled:false,sent:0,checked:1,deferred:0});expect(sends).toBe(1);expect(reads).toBe(1);
  });
  it('bounds one recovery batch to five tenants and leaves remaining work due',async()=>{
    const e=fixture();e.AGENT_PLATFORM_EMAIL_RECOVERY_ENABLED='true';await evidence(e);const box=new VerifiedInvitationOutbox(e);
    for(let i=0;i<6;i++){const invite=await invitation(e);await box.prepare(invite.actor,invite.id);}
    let calls=0;const result=await runEmailRecovery(e,async()=>{calls++;return Response.json({id:'4ef9a417-02e9-4d39-ad75-9611e0fcc33c'});});
    expect(result.sent).toBe(5);expect(calls).toBe(5);
    const config=await platformSenderConfiguration(e);expect(await e.AGENT_DB.prepare("SELECT count(*) AS pending FROM agent_platform_email_outbox WHERE route_ref=? AND state='prepared'").bind(`resend:${config.configurationHash}`).first()).toEqual({pending:1});
  });
  async function accepted(){const e=fixture(),invite=await invitation(e);await evidence(e);const job=await new VerifiedInvitationOutbox(e).prepare(invite.actor,invite.id);await dispatchInvitationEmail(e,invite.actor.tenantId,job.id,async()=>Response.json({id:'4ef9a417-02e9-4d39-ad75-9611e0fcc33c'}));const stored=await e.AGENT_DB.prepare('SELECT payload_json FROM agent_platform_email_outbox WHERE id=?').bind(job.id).first<{payload_json:string}>();return {e,invite,job,message:JSON.parse(stored!.payload_json)};}
  it('backs off corrupt receipt candidates without contacting the provider',async()=>{
    const f=await accepted();f.e.AGENT_PLATFORM_EMAIL_RECOVERY_ENABLED='true';
    await f.e.AGENT_DB.prepare("UPDATE agent_platform_email_outbox SET payload_hash='corrupt' WHERE id=?").bind(f.job.id).run();
    let calls=0;const transport=async()=>{calls++;return Response.json({});};
    expect(await runEmailRecovery(f.e,transport)).toEqual({disabled:false,sent:0,checked:0,deferred:1});
    expect(await runEmailRecovery(f.e,transport)).toEqual({disabled:false,sent:0,checked:0,deferred:0});
    expect(calls).toBe(0);
    const saved=await f.e.AGENT_DB.prepare('SELECT checks,next_check_at,last_error_code FROM agent_platform_email_delivery WHERE job_id=?').bind(f.job.id).first<{checks:number;next_check_at:string;last_error_code:string}>();
    expect(saved!.checks).toBe(1);expect(saved!.last_error_code).toBe('email_receipt_unverified');expect(Date.parse(saved!.next_check_at)).toBeGreaterThan(Date.now());
  });
  it('records verified delivery without treating opened events as a delivery receipt',async()=>{
    const f=await accepted();let now=Date.now(),event='opened';const transport=async(_url:string,init:RequestInit)=>{expect(init.method).toBe('GET');return Response.json({...f.message,id:'4ef9a417-02e9-4d39-ad75-9611e0fcc33c',cc:[],bcc:[],last_event:event});};
    expect(await reconcileInvitationDelivery(f.e,f.invite.actor.tenantId,f.job.id,transport,()=>now)).toEqual({state:'recorded'});
    expect(await f.e.AGENT_DB.prepare('SELECT delivered_seen FROM agent_platform_email_delivery WHERE job_id=?').bind(f.job.id).first()).toEqual({delivered_seen:0});
    now+=3600001;event='delivered';await reconcileInvitationDelivery(f.e,f.invite.actor.tenantId,f.job.id,transport,()=>now);
    now+=3600001;event='clicked';await reconcileInvitationDelivery(f.e,f.invite.actor.tenantId,f.job.id,transport,()=>now);
    expect(await f.e.AGENT_DB.prepare('SELECT last_event,delivered_seen FROM agent_platform_email_delivery WHERE job_id=?').bind(f.job.id).first()).toEqual({last_event:'clicked',delivered_seen:1});
  });
  it('polls once concurrently and suppresses each verified complaint only once',async()=>{
    const f=await accepted();let calls=0,now=Date.now(),event='complained';const transport=async()=>{calls++;return Response.json({...f.message,id:'4ef9a417-02e9-4d39-ad75-9611e0fcc33c',cc:[],bcc:[],last_event:event});};
    const results=await Promise.all([reconcileInvitationDelivery(f.e,f.invite.actor.tenantId,f.job.id,transport,()=>now),reconcileInvitationDelivery(f.e,f.invite.actor.tenantId,f.job.id,transport,()=>now)]);
    expect(calls).toBe(1);expect(results).toContainEqual({state:'recorded'});expect(results).toContainEqual({state:'not_checked'});
    expect(await f.e.AGENT_DB.prepare("SELECT reason,status FROM agent_platform_email_suppressions WHERE recipient=? AND scope_key='*'").bind(f.message.to[0]).first()).toEqual({reason:'complaint',status:'active'});
    await f.e.AGENT_DB.prepare("UPDATE agent_platform_email_suppressions SET status='released' WHERE recipient=?").bind(f.message.to[0]).run();
    now+=3600001;await reconcileInvitationDelivery(f.e,f.invite.actor.tenantId,f.job.id,transport,()=>now);
    expect(await f.e.AGENT_DB.prepare("SELECT status FROM agent_platform_email_suppressions WHERE recipient=? AND scope_key='*'").bind(f.message.to[0]).first()).toEqual({status:'released'});
    event='bounced';now+=3600001;await reconcileInvitationDelivery(f.e,f.invite.actor.tenantId,f.job.id,transport,()=>now);
    expect(await f.e.AGENT_DB.prepare('SELECT reason,status FROM agent_platform_email_suppressions WHERE recipient=?').bind(f.message.to[0]).first()).toEqual({reason:'hard_bounce',status:'active'});
  });
  it('rejects mismatched receipts and never queries foreign jobs or changed credential routes',async()=>{
    const f=await accepted();let calls=0;const transport=async()=>{calls++;return Response.json({...f.message,to:['foreign@example.test'],id:'4ef9a417-02e9-4d39-ad75-9611e0fcc33c',cc:[],bcc:[],last_event:'bounced'});};
    expect(await reconcileInvitationDelivery(f.e,crypto.randomUUID(),f.job.id,transport)).toEqual({state:'not_checked'});expect(calls).toBe(0);
    expect(await reconcileInvitationDelivery(f.e,f.invite.actor.tenantId,f.job.id,transport)).toEqual({state:'unverified'});
    expect(await f.e.AGENT_DB.prepare('SELECT bounced_seen,last_event FROM agent_platform_email_delivery WHERE job_id=?').bind(f.job.id).first()).toEqual({bounced_seen:0,last_event:null});
    expect(await f.e.AGENT_DB.prepare('SELECT recipient FROM agent_platform_email_suppressions WHERE recipient=?').bind(f.message.to[0]).first()).toBeNull();
    f.e.AGENT_PLATFORM_RESEND_API_KEY='re_rotated';await evidence(f.e);
    expect(await reconcileInvitationDelivery(f.e,f.invite.actor.tenantId,f.job.id,transport)).toEqual({state:'not_checked'});expect(calls).toBe(1);
  });
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
