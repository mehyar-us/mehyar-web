import {env} from 'cloudflare:workers';
import {describe,it,expect} from 'vitest';
import type {Env} from '../src/env';
import {createTenant} from '../src/tenants';
import {storeProviderGrant,revokeProviderGrant} from '../src/auth/vault';
import {MailboxSync} from '../src/connectors/mailbox-sync';
import {stopMailbox} from '../src/connectors/mailbox-control';
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
  return {actor,binding,credential,grantId,ledger,streamId,clock:()=>time,advance:(seconds=91)=>{time+=seconds*1000;}};
}
async function count(streamId:string) { return (await e.AGENT_DB.prepare('SELECT COUNT(*) AS n FROM agent_mailbox_changes WHERE stream_id=?').bind(streamId).first<{n:number}>())!.n; }
describe('durable mailbox synchronization',()=>{
  async function readable() {
    const f=await fixture();
    await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[{messageId:'a',kind:'upsert'}],syncCursor:'300'});
    const claim=(await f.ledger.claimChange(f.streamId))!;
    const snapshot={provider:'google' as const,id:'a',content:{id:'a',threadId:'t',payload:{mimeType:'text/plain',body:{size:5,data:'SGVsbG8'}}}};
    await f.ledger.saveChange(claim,snapshot);
    return {...f,receipt:claim.token,snapshot,read:()=>f.ledger.readText(f.streamId,'a',claim.token)};
  }
  it('reads a versioned untrusted projection only for its own exact observation receipt',async()=>{
    const f=await readable(),other=await fixture();
    expect(await f.read()).toMatchObject({messageId:'a',receipt:f.receipt,provider:'google',sourceMode:'incremental',projection:{version:1,text:'Hello',trustedForInstructions:false}});
    await expect(f.ledger.readText(f.streamId,'a',crypto.randomUUID())).rejects.toBeDefined();
    await expect(other.ledger.readText(f.streamId,'a',f.receipt)).rejects.toBeDefined();
    f.advance(301);
    await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[{messageId:'a',kind:'upsert'}],syncCursor:'400'});
    await expect(f.read()).rejects.toBeDefined();
    const next=(await f.ledger.claimChange(f.streamId))!;
    await f.ledger.saveChange(next,f.snapshot);
    await expect(f.read()).rejects.toBeDefined();
    expect((await f.ledger.readText(f.streamId,'a',next.token)).projection.text).toBe('Hello');
  });
  it('withholds projections after stop, consent replacement or recovery invalidation',async()=>{
    const stopped=await readable();await stopMailbox(e,stopped.actor,stopped.grantId);await expect(stopped.read()).rejects.toBeDefined();
    const changed=await readable();await storeProviderGrant(e,changed.binding,changed.credential,[]);await expect(changed.read()).rejects.toBeDefined();
    const recovery=await readable();
    await e.AGENT_DB.prepare('UPDATE agent_mailbox_messages SET needs_reconciliation=1 WHERE stream_id=?').bind(recovery.streamId).run();
    await expect(recovery.read()).rejects.toBeDefined();
  });
  it('rejects old, corrupt or falsely trusted stored projections',async()=>{
    const f=await readable();
    for(const value of [null,'not json',JSON.stringify({version:2,text:'Hello',omissions:[],trustedForInstructions:false}),JSON.stringify({version:1,text:'Hello',omissions:[],trustedForInstructions:true}),JSON.stringify({version:1,text:'🌍'.repeat(9000),omissions:[],trustedForInstructions:false})]){
      await e.AGENT_DB.prepare('UPDATE agent_mailbox_messages SET text_json=? WHERE stream_id=?').bind(value,f.streamId).run();
      await expect(f.read()).rejects.toBeDefined();
    }
  });
  it('stores extracted text with its source receipt and budget, and clears it on a confirmed missing message',async()=>{
    const f=await fixture('microsoft');
    await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[{messageId:'m',kind:'upsert'}],nextCursor:'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=one'});
    const snapshot={provider:'microsoft' as const,id:'m',content:{id:'m',conversationId:'t',body:{contentType:'html',content:'<p>Hello &amp; welcome</p>'}}};
    expect(await f.ledger.saveChange((await f.ledger.claimChange(f.streamId))!,snapshot)).toBe(true);
    const row=(await e.AGENT_DB.prepare('SELECT content_json,text_json,content_bytes FROM agent_mailbox_messages WHERE stream_id=?').bind(f.streamId).first<{content_json:string;text_json:string;content_bytes:number}>())!;
    expect(JSON.parse(row.text_json)).toMatchObject({version:1,text:'Hello & welcome',trustedForInstructions:false,omissions:[]});
    expect(row.content_bytes).toBe(new TextEncoder().encode(row.content_json+row.text_json).length);
    await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[{messageId:'m',kind:'delete'}],syncCursor:'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=done'});
    expect(await f.ledger.saveChange((await f.ledger.claimChange(f.streamId))!,null)).toBe(true);
    expect(await e.AGENT_DB.prepare('SELECT text_json,content_bytes FROM agent_mailbox_messages WHERE stream_id=?').bind(f.streamId).first()).toEqual({text_json:null,content_bytes:0});
  });
  it('records only completed scans, including empty scans, and clears freshness on restart',async()=>{
    const f=await fixture();
    const read=()=>e.AGENT_DB.prepare('SELECT last_completed_at FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first();
    const first=(await f.ledger.claim(f.streamId))!;
    await f.ledger.commit(first,{changes:[],nextCursor:'partial'});expect(await read()).toEqual({last_completed_at:null});
    f.advance(1);const final=(await f.ledger.claim(f.streamId))!;
    await f.ledger.commit(final,{changes:[],syncCursor:'300'});
    const completed=new Date(f.clock()).toISOString();expect(await read()).toEqual({last_completed_at:completed});
    f.advance(301);await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[],nextCursor:'later-partial'});
    expect(await read()).toEqual({last_completed_at:completed});
    const round=(await e.AGENT_DB.prepare('SELECT round_id FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first<{round_id:string}>())!.round_id;
    await e.AGENT_DB.prepare("UPDATE agent_mailbox_sync SET state='resync_required' WHERE id=?").bind(f.streamId).run();
    await f.ledger.restart(f.streamId,crypto.randomUUID(),round,'500');expect(await read()).toEqual({last_completed_at:null});
  });
  it('restarts a failed Gmail round atomically and does not reset newer progress on retry',async()=>{
    const f=await fixture(),key=crypto.randomUUID();
    await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[{messageId:'cached',kind:'upsert'},{messageId:'pending',kind:'upsert'}],nextCursor:'old-page'});
    await f.ledger.saveChange((await f.ledger.claimChange(f.streamId))!,{provider:'google',id:'cached',content:{id:'cached',threadId:'t',payload:{}}});
    const consumer=(await f.ledger.claimChange(f.streamId))!;
    const oldRound=(await e.AGENT_DB.prepare('SELECT round_id FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first<{round_id:string}>())!.round_id;
    await e.AGENT_DB.prepare("UPDATE agent_mailbox_sync SET state='resync_required' WHERE id=?").bind(f.streamId).run();
    expect(await f.ledger.restart(f.streamId,key,oldRound,'500')).toEqual({state:'restarted'});
    expect(await e.AGENT_DB.prepare('SELECT checkpoint,page_cursor,sync_mode,state FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first())
      .toEqual({checkpoint:'500',page_cursor:null,sync_mode:'bootstrap',state:'ready'});
    expect(await e.AGENT_DB.prepare('SELECT needs_reconciliation FROM agent_mailbox_messages WHERE stream_id=?').bind(f.streamId).first()).toEqual({needs_reconciliation:1});
    await expect(f.ledger.saveChange(consumer,null)).rejects.toBeDefined();
    const next=(await f.ledger.claim(f.streamId))!;
    await f.ledger.commit(next,{changes:[{messageId:'cached',kind:'upsert'}],nextCursor:'new-page'});
    await f.ledger.saveChange((await f.ledger.claimChange(f.streamId))!,{provider:'google',id:'cached',content:{id:'cached',threadId:'t',payload:{}}});
    expect(await e.AGENT_DB.prepare('SELECT needs_reconciliation FROM agent_mailbox_messages WHERE stream_id=?').bind(f.streamId).first()).toEqual({needs_reconciliation:0});
    expect(await f.ledger.restart(f.streamId,key,oldRound,'500')).toEqual({state:'restarted'});
    expect(await e.AGENT_DB.prepare('SELECT page_cursor FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first()).toEqual({page_cursor:'new-page'});
    await expect(f.ledger.restart(f.streamId,key,oldRound,'501')).rejects.toBeDefined();
  });
  it('rejects healthy or stale recovery rounds and restarts Graph without an old delta link',async()=>{
    const f=await fixture('microsoft');
    const round=(await e.AGENT_DB.prepare('SELECT round_id FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first<{round_id:string}>())!.round_id;
    await expect(f.ledger.restart(f.streamId,crypto.randomUUID(),round)).rejects.toBeDefined();
    await e.AGENT_DB.prepare("UPDATE agent_mailbox_sync SET state='resync_required' WHERE id=?").bind(f.streamId).run();
    await expect(f.ledger.restart(f.streamId,crypto.randomUUID(),crypto.randomUUID())).rejects.toBeDefined();
    expect(await f.ledger.restart(f.streamId,crypto.randomUUID(),round)).toEqual({state:'restarted'});
    expect(await f.ledger.claim(f.streamId)).toMatchObject({checkpoint:null,pageCursor:null});
  });
  it('rolls back a restart receipt and checkpoint when retiring pending work fails',async()=>{
    const f=await fixture();
    await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[{messageId:'pending',kind:'upsert'}],nextCursor:'old'});
    const round=(await e.AGENT_DB.prepare('SELECT round_id FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first<{round_id:string}>())!.round_id;
    await e.AGENT_DB.prepare("UPDATE agent_mailbox_sync SET state='resync_required' WHERE id=?").bind(f.streamId).run();
    await e.AGENT_DB.prepare("CREATE TRIGGER fail_resync BEFORE UPDATE OF state ON agent_mailbox_changes WHEN NEW.state='discarded' BEGIN SELECT RAISE(ABORT,'fixture reset failure'); END").run();
    try{await expect(f.ledger.restart(f.streamId,crypto.randomUUID(),round,'500')).rejects.toBeDefined();}
    finally{await e.AGENT_DB.prepare('DROP TRIGGER fail_resync').run();}
    expect(await e.AGENT_DB.prepare('SELECT COUNT(*) AS n FROM agent_mailbox_resync_receipts WHERE stream_id=?').bind(f.streamId).first()).toEqual({n:0});
    expect(await e.AGENT_DB.prepare('SELECT checkpoint,page_cursor,state FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first()).toEqual({checkpoint:'200',page_cursor:'old',state:'resync_required'});
  });
  it('stops one account without losing queued work, grants or checkpoints and fences active callbacks',async()=>{
    const f=await fixture(),other=await fixture();
    await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[{messageId:'pending',kind:'upsert'}],nextCursor:'next'});
    const polling=(await f.ledger.claim(f.streamId))!,consumer=(await f.ledger.claimChange(f.streamId))!;
    const before=await e.AGENT_DB.prepare('SELECT status,granted_scopes,ciphertext,authorization_revision FROM auth_provider_grants WHERE id=?').bind(f.grantId).first();
    expect(await stopMailbox(e,f.actor,f.grantId)).toEqual({state:'stopped'});
    expect(await stopMailbox(e,f.actor,f.grantId)).toEqual({state:'stopped'});
    expect(await e.AGENT_DB.prepare('SELECT status,granted_scopes,ciphertext,authorization_revision FROM auth_provider_grants WHERE id=?').bind(f.grantId).first()).toEqual(before);
    expect(await e.AGENT_DB.prepare('SELECT checkpoint,page_cursor,lease_token FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first()).toEqual({checkpoint:'200',page_cursor:'next',lease_token:null});
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_mailbox_changes WHERE stream_id=?').bind(f.streamId).first()).toEqual({state:'pending'});
    await expect(f.ledger.commit(polling,{changes:[],syncCursor:'300'})).rejects.toBeDefined();
    await expect(f.ledger.saveChange(consumer,null)).rejects.toBeDefined();
    await expect(f.ledger.claimChange(f.streamId)).rejects.toBeDefined();
    expect(await other.ledger.claim(other.streamId)).not.toBeNull();
    await expect(stopMailbox(e,other.actor,f.grantId)).rejects.toMatchObject({code:'mailbox_not_found'});
  });
  it('retires queued work and leases atomically on new consent without touching other accounts',async()=>{
    const f=await fixture(),other=await fixture();
    for(const item of [f,other])await item.ledger.commit((await item.ledger.claim(item.streamId))!,{changes:[{messageId:'pending',kind:'upsert'}],nextCursor:'next'});
    const page=(await f.ledger.claim(f.streamId))!,consumer=(await f.ledger.claimChange(f.streamId))!;
    await storeProviderGrant(e,f.binding,f.credential,[]);
    expect(await e.AGENT_DB.prepare('SELECT state,checkpoint,page_cursor,lease_token FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first())
      .toEqual({state:'resync_required',checkpoint:'200',page_cursor:'next',lease_token:null});
    expect(await e.AGENT_DB.prepare('SELECT state,lease_token FROM agent_mailbox_consumers WHERE stream_id=?').bind(f.streamId).first())
      .toEqual({state:'review_required',lease_token:null});
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_mailbox_changes WHERE stream_id=?').bind(f.streamId).first()).toEqual({state:'discarded'});
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_mailbox_changes WHERE stream_id=?').bind(other.streamId).first()).toEqual({state:'pending'});
    await expect(f.ledger.commit(page,{changes:[],syncCursor:'300'})).rejects.toMatchObject({code:'mailbox_sync_unavailable'});
    await expect(f.ledger.saveChange(consumer,null)).rejects.toMatchObject({code:'mailbox_sync_unavailable'});
    const current=await f.ledger.open(f.grantId,'google','mailbox','400');
    expect(current).not.toBe(f.streamId);expect(await f.ledger.claim(current)).not.toBeNull();
  });
  it('preserves pending work during token refresh but retires it on local revocation',async()=>{
    const f=await fixture();await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[{messageId:'pending',kind:'upsert'}],nextCursor:'next'});
    await e.AGENT_DB.prepare('UPDATE auth_provider_grants SET ciphertext=ciphertext,updated_at=? WHERE id=?').bind(new Date().toISOString(),f.grantId).run();
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_mailbox_changes WHERE stream_id=?').bind(f.streamId).first()).toEqual({state:'pending'});
    await revokeProviderGrant(e,f.actor.userId,f.grantId,f.actor.tenantId);
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_mailbox_changes WHERE stream_id=?').bind(f.streamId).first()).toEqual({state:'discarded'});
    expect(await count(f.streamId)).toBe(1);
  });
  it('rolls back consent replacement if retiring obsolete work fails',async()=>{
    const f=await fixture();await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[{messageId:'pending',kind:'upsert'}],nextCursor:'next'});
    const prior=await e.AGENT_DB.prepare('SELECT authorization_revision,ciphertext FROM auth_provider_grants WHERE id=?').bind(f.grantId).first();
    await e.AGENT_DB.prepare("CREATE TRIGGER reject_retirement BEFORE UPDATE OF state ON agent_mailbox_changes WHEN NEW.state='discarded' BEGIN SELECT RAISE(ABORT,'fixture retirement failure'); END").run();
    try{await expect(storeProviderGrant(e,f.binding,f.credential,[])).rejects.toBeDefined();}
    finally{await e.AGENT_DB.prepare('DROP TRIGGER reject_retirement').run();}
    expect(await e.AGENT_DB.prepare('SELECT authorization_revision,ciphertext FROM auth_provider_grants WHERE id=?').bind(f.grantId).first()).toEqual(prior);
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first()).toEqual({state:'ready'});
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_mailbox_changes WHERE stream_id=?').bind(f.streamId).first()).toEqual({state:'pending'});
  });
  it('fences concurrent consumers and callbacks from an expired processing lease',async()=>{
    const f=await fixture();await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[{messageId:'a',kind:'upsert'}],syncCursor:'300'});
    const claims=await Promise.all([f.ledger.claimChange(f.streamId),f.ledger.claimChange(f.streamId)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    f.advance();const current=(await f.ledger.claimChange(f.streamId))!;
    await expect(f.ledger.saveChange(claims.find(Boolean)!,null)).rejects.toMatchObject({code:'mailbox_sync_unavailable'});
    expect(await f.ledger.saveChange(current,null)).toBe(true);
    expect(await f.ledger.claimChange(f.streamId)).toBeNull();
  });
  it('rolls back the message snapshot if acknowledging the queue fails',async()=>{
    const f=await fixture();await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[{messageId:'a',kind:'upsert'}],syncCursor:'300'});
    const claim=(await f.ledger.claimChange(f.streamId))!;
    const snapshot={provider:'google' as const,id:'a',content:{id:'a',threadId:'t',payload:{mimeType:'text/plain',body:{size:5,data:'SGVsbG8'}}}};
    await e.AGENT_DB.prepare("CREATE TRIGGER mailbox_ack_failure BEFORE UPDATE OF state ON agent_mailbox_changes BEGIN SELECT RAISE(ABORT,'fixture acknowledgment failure'); END").run();
    try {await expect(f.ledger.saveChange(claim,snapshot)).rejects.toBeDefined();}
    finally {await e.AGENT_DB.prepare('DROP TRIGGER mailbox_ack_failure').run();}
    expect(await e.AGENT_DB.prepare('SELECT COUNT(*) AS n FROM agent_mailbox_messages WHERE stream_id=?').bind(f.streamId).first()).toEqual({n:0});
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_mailbox_changes WHERE stream_id=?').bind(f.streamId).first()).toEqual({state:'pending'});
    expect(await f.ledger.saveChange(claim,snapshot)).toBe(true);
    const stored=await e.AGENT_DB.prepare('SELECT text_json FROM agent_mailbox_messages WHERE stream_id=?').bind(f.streamId).first<{text_json:string}>();
    expect(JSON.parse(stored!.text_json).text).toBe('Hello');
  });
  it('blocks foreign consumer access and refuses an exhausted tenant snapshot budget without acknowledging',async()=>{
    const f=await fixture(),other=await fixture();
    await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[{messageId:'a',kind:'upsert'}],syncCursor:'300'});
    await expect(other.ledger.claimChange(f.streamId)).rejects.toMatchObject({code:'mailbox_sync_unavailable'});
    const claim=(await f.ledger.claimChange(f.streamId))!;
    await e.AGENT_DB.prepare("INSERT INTO agent_mailbox_messages(stream_id,message_id,state,content_json,content_bytes,source_mode,observed_at,receipt_token) VALUES (?,'existing','present','{}',10000000,'unknown',?,'fixture-budget')")
      .bind(f.streamId,new Date().toISOString()).run();
    expect(await f.ledger.saveChange(claim,{provider:'google',id:'a',content:{id:'a',threadId:'t',payload:{}}})).toBe(false);
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_mailbox_changes WHERE stream_id=?').bind(f.streamId).first()).toEqual({state:'pending'});
  });
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
    const restarted=new MailboxSync(e,f.actor,f.clock),next=(await restarted.claim(f.streamId))!;
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
