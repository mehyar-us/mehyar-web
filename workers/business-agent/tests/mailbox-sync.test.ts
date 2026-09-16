import {env} from 'cloudflare:workers';
import {describe,it,expect} from 'vitest';
import type {Env} from '../src/env';
import {createTenant} from '../src/tenants';
import {storeProviderGrant} from '../src/auth/vault';
import {MailboxSync} from '../src/connectors/mailbox-sync';
const e=env as unknown as Env;
async function fixture(provider:'google'|'microsoft'='google') {
  const userId=crypto.randomUUID();
  await e.AGENT_DB.prepare('INSERT INTO auth_user(id,name,email,createdAt,updatedAt) VALUES (?,?,?,?,?)')
    .bind(userId,'Fixture',`${userId}@example.test`,Date.now(),Date.now()).run();
  const tenant=await createTenant(e,userId,{name:'Mailbox fixture'},crypto.randomUUID());
  const actor={userId,tenantId:tenant.id},binding={...actor,provider,accountId:crypto.randomUUID()};
  const credential={accountEmail:'mail@example.test',accessToken:'fixture',refreshToken:'fixture-refresh',grantedScopes:provider==='google'?['https://www.googleapis.com/auth/gmail.readonly']:['Mail.Read']};
  const grantId=await storeProviderGrant(e,binding,credential,[]);
  let time=Date.now();
  const ledger=new MailboxSync(e,actor,()=>time);
  const streamId=await ledger.open(grantId,provider,provider==='google'?'mailbox':'inbox',provider==='google'?'200':undefined);
  return {actor,binding,credential,grantId,ledger,streamId,advance:(seconds=91)=>{time+=seconds*1000;}};
}
async function count(streamId:string) { return (await e.AGENT_DB.prepare('SELECT COUNT(*) AS n FROM agent_mailbox_changes WHERE stream_id=?').bind(streamId).first<{n:number}>())!.n; }
describe('durable mailbox synchronization',()=>{
  it('bounds abandoned attempts and never advances their checkpoint',async()=>{
    const f=await fixture();
    for(let i=0;i<12;i++){expect(await f.ledger.claim(f.streamId)).not.toBeNull();f.advance();}
    expect(await f.ledger.claim(f.streamId)).toBeNull();
    expect(await e.AGENT_DB.prepare('SELECT state,checkpoint,consecutive_attempts FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first())
      .toEqual({state:'resync_required',checkpoint:'200',consecutive_attempts:12});
  });
  it('resets attempts only on a saved page and preserves durable failure delays',async()=>{
    const f=await fixture();
    const first=(await f.ledger.claim(f.streamId))!;
    expect(await f.ledger.defer(first,3600)).toBe(true);
    f.advance(3599);expect(await f.ledger.claim(f.streamId)).toBeNull();
    f.advance(2);const next=(await f.ledger.claim(f.streamId))!;
    expect((await f.ledger.context(next)).attempts).toBe(2);
    await f.ledger.commit(next,{changes:[],nextCursor:'next'});
    const last=(await f.ledger.claim(f.streamId))!;
    expect((await f.ledger.context(last)).attempts).toBe(1);
    expect(await f.ledger.defer(first,3600)).toBe(false);
  });
  it('atomically caps tenant backlog across streams, preserves rejected cursors and resumes after draining',async()=>{
    const f=await fixture(),seed=(await f.ledger.claim(f.streamId))!;
    await f.ledger.commit(seed,{changes:[{messageId:'seed',kind:'upsert'}],nextCursor:'more'});
    await e.AGENT_DB.prepare(`INSERT INTO agent_mailbox_changes(stream_id,page_token,ordinal,message_id,kind,created_at)
      SELECT ?,?,CAST(key AS INTEGER)+1,'seed-'||key,'upsert',? FROM json_each(?)`)
      .bind(f.streamId,seed.token,new Date().toISOString(),JSON.stringify(Array.from({length:8999},(_,i)=>i))).run();
    const grant=await storeProviderGrant(e,{...f.binding,accountId:crypto.randomUUID()},f.credential,[]);
    const second=await f.ledger.open(grant,'google','mailbox','200');
    const a=(await f.ledger.claim(f.streamId))!,b=(await f.ledger.claim(second))!;
    expect(a).not.toBeNull();expect(b).not.toBeNull();
    const page={changes:Array.from({length:1000},(_,i)=>({messageId:`new-${i}`,kind:'upsert' as const})),syncCursor:'300'};
    const results=await Promise.all([f.ledger.commit(a,page),f.ledger.commit(b,page)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await count(f.streamId)+await count(second)).toBe(10000);
    const rejected=results[0]?second:f.streamId;
    expect(await e.AGENT_DB.prepare('SELECT checkpoint FROM agent_mailbox_sync WHERE id=?').bind(rejected).first()).toEqual({checkpoint:'200'});
    f.advance(301);expect(await f.ledger.claim(rejected)).toBeNull();
    const other=await fixture();expect(await other.ledger.claim(other.streamId)).not.toBeNull();
    // Simulate the future consumer acknowledging work, not deleting queued evidence.
    await e.AGENT_DB.prepare("UPDATE agent_mailbox_changes SET state='applied' WHERE stream_id=? AND page_token=? AND ordinal<1000")
      .bind(f.streamId,seed.token).run();
    expect(await f.ledger.claim(rejected)).toMatchObject({checkpoint:'200'});
  });
  it('rolls back the receipt and checkpoint when persisting a change fails',async()=>{
    const f=await fixture(),claim=(await f.ledger.claim(f.streamId))!;
    await e.AGENT_DB.prepare("CREATE TRIGGER mailbox_test_failure BEFORE INSERT ON agent_mailbox_changes BEGIN SELECT RAISE(ABORT,'fixture storage failure'); END").run();
    const page={changes:[{messageId:'a',kind:'upsert' as const}],syncCursor:'300'};
    try { await expect(f.ledger.commit(claim,page)).rejects.toBeDefined(); }
    finally { await e.AGENT_DB.prepare('DROP TRIGGER mailbox_test_failure').run(); }
    expect(await count(f.streamId)).toBe(0);
    expect(await e.AGENT_DB.prepare('SELECT checkpoint,lease_token FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first()).toEqual({checkpoint:'200',lease_token:claim.token});
    expect(await e.AGENT_DB.prepare('SELECT COUNT(*) AS n FROM agent_mailbox_sync_pages WHERE stream_id=?').bind(f.streamId).first()).toEqual({n:0});
    expect(await f.ledger.commit(claim,page)).toBe(true);
    expect(await count(f.streamId)).toBe(1);
  });
  it('resumes pages across instances and atomically queues changes before advancing the final checkpoint',async()=>{
    const f=await fixture(),claim=(await f.ledger.claim(f.streamId))!;
    expect(claim).toMatchObject({checkpoint:'200',pageCursor:null});
    expect(await f.ledger.commit(claim,{changes:[{messageId:'a',kind:'upsert'}],nextCursor:'page-two'})).toBe(true);
    const restarted=new MailboxSync(e,f.actor),next=(await restarted.claim(f.streamId))!;
    expect(next).toMatchObject({checkpoint:'200',pageCursor:'page-two'});
    expect(await restarted.commit(next,{changes:[{messageId:'b',kind:'delete'}],syncCursor:'300'})).toBe(true);
    expect(await count(f.streamId)).toBe(2);
    expect(await restarted.claim(f.streamId)).toBeNull();
    f.advance(301);
    expect(await f.ledger.claim(f.streamId)).toMatchObject({checkpoint:'300',pageCursor:null});
  });
  it('fences concurrent claims and stale callbacks after an expired lease',async()=>{
    const f=await fixture(),claims=await Promise.all([f.ledger.claim(f.streamId),f.ledger.claim(f.streamId)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    f.advance();const fresh=(await f.ledger.claim(f.streamId))!;
    expect(await f.ledger.commit(claims.find(Boolean)!,{changes:[{messageId:'stale',kind:'upsert'}],syncCursor:'250'})).toBe(false);
    expect(await f.ledger.commit(fresh,{changes:[],syncCursor:'300'})).toBe(true);
    expect(await count(f.streamId)).toBe(0);
  });
  it('replays a saved page exactly once and rejects changed replay content',async()=>{
    const f=await fixture(),claim=(await f.ledger.claim(f.streamId))!;
    const page={changes:[{messageId:'a',kind:'upsert' as const}],syncCursor:'300'};
    expect(await f.ledger.commit(claim,page)).toBe(true);
    expect(await f.ledger.commit(claim,page)).toBe(true);
    expect(await count(f.streamId)).toBe(1);
    await expect(f.ledger.commit(claim,{...page,changes:[]})).rejects.toMatchObject({code:'mailbox_sync_unavailable'});
  });
  it('does not reset a saved checkpoint on reopen and stops an oversized round for review',async()=>{
    const f=await fixture();
    await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[],syncCursor:'300'});
    expect(await f.ledger.open(f.grantId,'google','mailbox','200')).toBe(f.streamId);
    f.advance(301);
    await e.AGENT_DB.prepare('UPDATE agent_mailbox_sync SET page_number=499 WHERE id=?').bind(f.streamId).run();
    const claim=(await f.ledger.claim(f.streamId))!;
    expect(claim.checkpoint).toBe('300');
    expect(await f.ledger.commit(claim,{changes:[],nextCursor:'page-501'})).toBe(true);
    expect(await f.ledger.claim(f.streamId)).toBeNull();
    expect(await e.AGENT_DB.prepare('SELECT checkpoint,page_cursor,state FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first())
      .toEqual({checkpoint:'300',page_cursor:'page-501',state:'resync_required'});
  });
  it('does not duplicate queued changes when two identical page completions race',async()=>{
    const f=await fixture(),claim=(await f.ledger.claim(f.streamId))!;
    const page={changes:[{messageId:'one',kind:'upsert' as const}],syncCursor:'300'};
    const results=await Promise.all([f.ledger.commit(claim,page),f.ledger.commit(claim,page)]);
    expect(results.some(Boolean)).toBe(true);
    expect(await count(f.streamId)).toBe(1);
    expect(await f.ledger.claim(f.streamId)).toBeNull();
    f.advance(301);
    expect(await f.ledger.claim(f.streamId)).toMatchObject({checkpoint:'300',pageCursor:null});
  });
  it.each(['consent','revoke','pause','role'] as const)('withholds changes and checkpoints after %s changes',async change=>{
    const f=await fixture(),claim=(await f.ledger.claim(f.streamId))!;
    if(change==='consent')await storeProviderGrant(e,f.binding,f.credential,[]);
    if(change==='revoke')await e.AGENT_DB.prepare("UPDATE auth_provider_grants SET status='revoked' WHERE id=?").bind(f.grantId).run();
    if(change==='pause')await e.AGENT_DB.prepare("UPDATE agent_tenants SET status='paused' WHERE id=?").bind(f.actor.tenantId).run();
    if(change==='role')await e.AGENT_DB.prepare("UPDATE agent_memberships SET role='viewer' WHERE tenant_id=? AND user_id=?").bind(f.actor.tenantId,f.actor.userId).run();
    await expect(f.ledger.commit(claim,{changes:[{messageId:'private',kind:'upsert'}],syncCursor:'300'})).rejects.toBeDefined();
    expect(await count(f.streamId)).toBe(0);
    expect(await e.AGENT_DB.prepare('SELECT checkpoint FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first()).toEqual({checkpoint:'200'});
  });
  it('rejects a foreign tenant and isolates new consent from old cursors',async()=>{
    const f=await fixture(),other=await fixture();
    await expect(other.ledger.claim(f.streamId)).rejects.toMatchObject({code:'mailbox_sync_unavailable'});
    await storeProviderGrant(e,f.binding,f.credential,[]);
    const next=await f.ledger.open(f.grantId,'google','mailbox','500');
    expect(next).not.toBe(f.streamId);
    expect(await f.ledger.claim(next)).toMatchObject({checkpoint:'500'});
  });
  it('detects loops without queuing changes and preserves the expired checkpoint for resync',async()=>{
    const f=await fixture();
    await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[],nextCursor:'same'});
    const next=(await f.ledger.claim(f.streamId))!;
    await expect(f.ledger.commit(next,{changes:[{messageId:'loop',kind:'upsert'}],nextCursor:'same'})).rejects.toMatchObject({code:'mailbox_cursor_loop'});
    expect(await f.ledger.requireResync(next)).toBe(true);
    expect(await f.ledger.claim(f.streamId)).toBeNull();
    expect(await count(f.streamId)).toBe(0);
    expect(await e.AGENT_DB.prepare('SELECT checkpoint,state FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first()).toEqual({checkpoint:'200',state:'resync_required'});
  });
  it('starts Graph bootstrap with no checkpoint and rejects another folder delta link',async()=>{
    const f=await fixture('microsoft'),claim=(await f.ledger.claim(f.streamId))!;
    expect(claim.checkpoint).toBeNull();
    await expect(f.ledger.commit(claim,{changes:[],syncCursor:'https://graph.microsoft.com/v1.0/me/mailFolders/other/messages/delta?t=x'})).rejects.toMatchObject({kind:'invalid_input'});
    expect(await f.ledger.commit(claim,{changes:[{messageId:'deleted',kind:'delete'}],syncCursor:'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=x'})).toBe(true);
    expect(await count(f.streamId)).toBe(1);
  });
});
