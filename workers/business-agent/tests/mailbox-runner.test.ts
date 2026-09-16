import {env} from 'cloudflare:workers';
import {describe,it,expect} from 'vitest';
import type {Env} from '../src/env';
import {createTenant} from '../src/tenants';
import {storeProviderGrant} from '../src/auth/vault';
import {CATALOG_VERSION} from '../src/catalog';
import {RELEASE_GATES} from '../src/billing/service';
import {MailboxSync} from '../src/connectors/mailbox-sync';
import {runMailboxPage} from '../src/connectors/mailbox-runner';
const e={...env,MAILBOX_SYNC_ENABLED:'true',GOOGLE_ENABLED_CAPABILITIES:'gmail_read',MICROSOFT_ENABLED_CAPABILITIES:'mail_read'} as unknown as Env;
const guard=async()=>{};
async function fixture(provider:'google'|'microsoft'='google') {
  const userId=crypto.randomUUID();
  await e.AGENT_DB.prepare('INSERT INTO auth_user(id,name,email,createdAt,updatedAt) VALUES (?,?,?,?,?)')
    .bind(userId,'Fixture',`${userId}@example.test`,Date.now(),Date.now()).run();
  const tenant=await createTenant(e,userId,{name:'Mailbox runner'},crypto.randomUUID()),actor={userId,tenantId:tenant.id};
  const binding={...actor,provider,accountId:crypto.randomUUID()};
  const credential={accountEmail:'owner@example.test',accessToken:'fixture-access',refreshToken:'fixture-refresh',accessTokenExpiresAt:new Date(Date.now()+3600000).toISOString(),
    grantedScopes:provider==='google'?['https://www.googleapis.com/auth/gmail.readonly']:['Mail.Read']};
  const grantId=await storeProviderGrant(e,binding,credential,[]);
  await e.AGENT_DB.prepare("UPDATE agent_tenants SET status='active',plan_id='business' WHERE id=?").bind(tenant.id).run();
  await e.AGENT_DB.prepare("INSERT INTO agent_billing_subscriptions(tenant_id,stripe_subscription_id,plan_id,status,paid_through,updated_at,access_state,usage_anchor) VALUES (?,?,'business','active',?,?,'active',?)")
    .bind(tenant.id,'sub_'+crypto.randomUUID(),new Date(Date.now()+86400000).toISOString(),new Date().toISOString(),new Date(Date.now()-10000).toISOString()).run();
  for(const [scope,gates] of [['catalog',RELEASE_GATES],[tenant.id,['activation_approved']],[`connector:${provider}.mail.read`,['provider_approval','live_acceptance']]] as const)
    for(const gate of gates)await e.AGENT_DB.prepare("INSERT OR REPLACE INTO agent_billing_readiness(scope_id,gate,catalog_version,status,evidence_ref,verified_by,verified_at,valid_until) VALUES (?,?,?,'verified','fixture-only','test',?,?)")
      .bind(scope,gate,CATALOG_VERSION,new Date().toISOString(),new Date(Date.now()+86400000).toISOString()).run();
  const ledger=new MailboxSync(e,actor),streamId=await ledger.open(grantId,provider,provider==='google'?'mailbox':'inbox',provider==='google'?'200':undefined);
  return {actor,streamId,ledger,grantId,binding,credential};
}
async function changes(streamId:string) {return (await e.AGENT_DB.prepare('SELECT message_id,kind FROM agent_mailbox_changes WHERE stream_id=? ORDER BY created_at,ordinal').bind(streamId).all()).results;}
describe('one-page mailbox provider runner',()=>{
  it('stops the twelfth transient failure for recovery rather than scheduling another retry',async()=>{
    const f=await fixture();
    await e.AGENT_DB.prepare('UPDATE agent_mailbox_sync SET consecutive_attempts=11 WHERE id=?').bind(f.streamId).run();
    expect(await runMailboxPage(e,f.actor,f.streamId,guard,async()=>Response.json({}, {status:503}))).toEqual({state:'resync_required'});
    expect(await f.ledger.claim(f.streamId)).toBeNull();
    expect(await changes(f.streamId)).toEqual([]);
  });
  it('resumes Gmail pages, preserves deletions and deduplicates general/specific history references',async()=>{
    const f=await fixture();let calls=0;
    const transport:typeof fetch=async(input,init)=>{
      calls++;const url=new URL(String(input));expect(url.searchParams.get('startHistoryId')).toBe('200');expect(init?.method).toBe('GET');
      if(calls===1)return Response.json({historyId:'300',nextPageToken:'second',history:[{id:'250',messages:[{id:'a',threadId:'t'}],messagesAdded:[{message:{id:'a',threadId:'t'}}],messagesDeleted:[{message:{id:'b',threadId:'t'}}]}]});
      expect(url.searchParams.get('pageToken')).toBe('second');return Response.json({historyId:'301'});
    };
    expect(await runMailboxPage(e,f.actor,f.streamId,guard,transport)).toEqual({state:'saved',changes:2,hasMore:true});
    expect(await runMailboxPage(e,f.actor,f.streamId,guard,transport)).toEqual({state:'saved',changes:0,hasMore:false});
    expect(calls).toBe(2);expect(await changes(f.streamId)).toEqual([{message_id:'a',kind:'upsert'},{message_id:'b',kind:'delete'}]);
    expect(await f.ledger.claim(f.streamId)).toBeNull();
    expect(await e.AGENT_DB.prepare('SELECT checkpoint,page_cursor FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first()).toEqual({checkpoint:'301',page_cursor:null});
  });
  it('reads Graph bootstrap and persists folder removal references without copying bodies',async()=>{
    const f=await fixture('microsoft');
    const result=await runMailboxPage(e,f.actor,f.streamId,guard,async()=>Response.json({value:[{id:'a',body:{content:'private'}},{id:'b','@removed':{reason:'changed'}}],
      '@odata.deltaLink':'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=private'}));
    expect(result).toEqual({state:'saved',changes:2,hasMore:false});
    expect(JSON.stringify(result)).not.toContain('private');
    expect(await changes(f.streamId)).toEqual([{message_id:'a',kind:'upsert'},{message_id:'b',kind:'delete'}]);
  });
  it.each(['disabled','capability','billing','readiness','pause'] as const)('does not contact the provider when %s is unavailable',async condition=>{
    const f=await fixture();let calls=0;
    if(condition==='billing')await e.AGENT_DB.prepare("UPDATE agent_billing_subscriptions SET access_state='suspended' WHERE tenant_id=?").bind(f.actor.tenantId).run();
    if(condition==='readiness')await e.AGENT_DB.prepare("DELETE FROM agent_billing_readiness WHERE scope_id='connector:google.mail.read'").run();
    const config={...e,...condition==='disabled'?{MAILBOX_SYNC_ENABLED:'false'}:{},...condition==='capability'?{GOOGLE_ENABLED_CAPABILITIES:''}:{}};
    await expect(runMailboxPage(config,f.actor,f.streamId,async()=>{if(condition==='pause')throw new Error('fixture paused');},async()=>{calls++;return Response.json({historyId:'300'});})).rejects.toBeDefined();
    expect(calls).toBe(0);expect(await changes(f.streamId)).toEqual([]);
  });
  it.each(['consent','billing','pause'] as const)('withholds a provider page when %s changes in flight',async condition=>{
    const f=await fixture();let paused=false;
    await expect(runMailboxPage(e,f.actor,f.streamId,async()=>{if(paused)throw new Error('fixture paused');},async()=>{
      if(condition==='consent')await storeProviderGrant(e,f.binding,f.credential,[]);
      if(condition==='billing')await e.AGENT_DB.prepare("UPDATE agent_billing_subscriptions SET paid_through='2000-01-01T00:00:00.000Z' WHERE tenant_id=?").bind(f.actor.tenantId).run();
      if(condition==='pause')paused=true;
      return Response.json({historyId:'300',history:[{id:'250',messagesAdded:[{message:{id:'private',threadId:'t'}}]}]});
    })).rejects.toBeDefined();
    expect(await changes(f.streamId)).toEqual([]);
    expect(await e.AGENT_DB.prepare('SELECT checkpoint FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first()).toEqual({checkpoint:'200'});
  });
  it('marks expired history for resync without advancing it',async()=>{
    const f=await fixture();
    expect(await runMailboxPage(e,f.actor,f.streamId,guard,async()=>Response.json({}, {status:404}))).toEqual({state:'resync_required'});
    expect(await f.ledger.claim(f.streamId)).toBeNull();
    expect(await changes(f.streamId)).toEqual([]);
  });
  it('requires review for malformed pages without saving partial changes',async()=>{
    const f=await fixture();
    expect(await runMailboxPage(e,f.actor,f.streamId,guard,async()=>Response.json({historyId:'300',history:[{id:'250',messagesAdded:[{}]}]})))
      .toEqual({state:'resync_required'});
    expect(await changes(f.streamId)).toEqual([]);
    expect(await e.AGENT_DB.prepare('SELECT checkpoint FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first()).toEqual({checkpoint:'200'});
  });
  it('rejects an expired lease after a provider read',async()=>{
    const f=await fixture();
    await expect(runMailboxPage(e,f.actor,f.streamId,guard,async()=>{
      await e.AGENT_DB.prepare("UPDATE agent_mailbox_sync SET lease_until='2000-01-01T00:00:00.000Z' WHERE id=?").bind(f.streamId).run();
      return Response.json({historyId:'300'});
    })).rejects.toMatchObject({code:'mailbox_sync_unavailable'});
    expect(await e.AGENT_DB.prepare('SELECT checkpoint FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first()).toEqual({checkpoint:'200'});
  });
  it('defers transient provider failures on the original checkpoint',async()=>{
    const f=await fixture();let calls=0;
    expect(await runMailboxPage(e,f.actor,f.streamId,guard,async()=>{calls++;return Response.json({}, {status:503});})).toEqual({state:'deferred'});
    expect(calls).toBe(1);expect(await f.ledger.claim(f.streamId)).toBeNull();
    expect(await e.AGENT_DB.prepare('SELECT checkpoint FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first()).toEqual({checkpoint:'200'});
  });
  it('persists rate-limit backoff and performs no immediate retry',async()=>{
    const f=await fixture();let calls=0;
    const before=Date.now();
    expect(await runMailboxPage(e,f.actor,f.streamId,guard,async()=>{calls++;return Response.json({}, {status:429,headers:{'retry-after':'3600'}});})).toEqual({state:'deferred'});
    expect(calls).toBe(1);expect(await f.ledger.claim(f.streamId)).toBeNull();
    const row=await e.AGENT_DB.prepare('SELECT checkpoint,next_poll_at,lease_token FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first<{checkpoint:string;next_poll_at:string;lease_token:string|null}>();
    expect(row!.checkpoint).toBe('200');expect(row!.lease_token).toBeNull();expect(Date.parse(row!.next_poll_at)).toBeGreaterThanOrEqual(before+3600000);
  });
});
