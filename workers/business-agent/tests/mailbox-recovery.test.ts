import {env} from 'cloudflare:workers';
import {getAgentByName} from 'agents';
import {beforeEach,describe,it,expect} from 'vitest';
import type {Env} from '../src/env';
import {createTenant} from '../src/tenants';
import {storeProviderGrant} from '../src/auth/vault';
import {MailboxSync} from '../src/connectors/mailbox-sync';
import {runMailboxRecovery} from '../src/connectors/mailbox-recovery';
import {runMailboxProcessing} from '../src/connectors/mailbox-processing';
import {runMailboxMaintenance} from '../src/connectors/mailbox-maintenance';
const e={...env,MAILBOX_SYNC_ENABLED:'true',MAILBOX_RECOVERY_ENABLED:'true'} as unknown as Env;
async function fixture() {
  const userId=crypto.randomUUID();
  await e.AGENT_DB.prepare('INSERT INTO auth_user(id,name,email,createdAt,updatedAt) VALUES (?,?,?,?,?)')
    .bind(userId,'Fixture',`${userId}@example.test`,Date.now(),Date.now()).run();
  const tenant=await createTenant(e,userId,{name:'Mailbox scheduler'},crypto.randomUUID()),actor={userId,tenantId:tenant.id};
  const addStream=async()=>{
    const grantId=await storeProviderGrant(e,{...actor,provider:'google',accountId:crypto.randomUUID()},
      {accountEmail:'work@example.test',accessToken:'fixture',refreshToken:'fixture',grantedScopes:['https://www.googleapis.com/auth/gmail.readonly']},[]);
    const streamId=await new MailboxSync(e,actor).open(grantId,'google','mailbox','200');
    return {grantId,streamId};
  };
  const stream=await addStream();
  await e.AGENT_DB.prepare("UPDATE agent_tenants SET status='active',plan_id='business' WHERE id=?").bind(tenant.id).run();
  return {actor,addStream,...stream};
}
describe('bounded recurring mailbox dispatch',()=>{
  beforeEach(async()=>{
    await e.AGENT_DB.prepare("UPDATE agent_mailbox_sync SET state='resync_required'").run();
    await e.AGENT_DB.prepare("UPDATE agent_tenants SET status='paused'").run();
  });
  async function queued() {
    const f=await fixture(),ledger=new MailboxSync(e,f.actor),claim=(await ledger.claim(f.streamId))!;
    await ledger.commit(claim,{changes:[{messageId:'message',kind:'upsert'}],syncCursor:'300'});
    return {...f,ledger,pageToken:claim.token};
  }
  const processing={...e,MAILBOX_PROCESSING_ENABLED:'true'};
  it('retires expired membership work with provider execution disabled while preserving paused accounts',async()=>{
    const f=await queued(),paused=await queued();
    const claim=(await f.ledger.claimChange(f.streamId))!;
    await e.AGENT_DB.prepare('UPDATE agent_memberships SET expires_at=? WHERE tenant_id=? AND user_id=?')
      .bind(new Date(Date.now()-1000).toISOString(),f.actor.tenantId,f.actor.userId).run();
    await e.AGENT_DB.prepare("UPDATE agent_tenants SET status='paused' WHERE id=?").bind(paused.actor.tenantId).run();
    expect(await runMailboxMaintenance({...e,MAILBOX_SYNC_ENABLED:'false'})).toMatchObject({retired:1,failed:0});
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_mailbox_changes WHERE stream_id=?').bind(f.streamId).first()).toEqual({state:'discarded'});
    expect(await e.AGENT_DB.prepare('SELECT state,lease_token FROM agent_mailbox_consumers WHERE stream_id=?').bind(f.streamId).first()).toEqual({state:'review_required',lease_token:null});
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_mailbox_changes WHERE stream_id=?').bind(paused.streamId).first()).toEqual({state:'pending'});
    await expect(f.ledger.saveChange(claim,null)).rejects.toBeDefined();
    expect(await runMailboxMaintenance(e)).toMatchObject({selected:0});
  });
  it('rolls back failed retirement and continues other withdrawn mailboxes',async()=>{
    const f=await queued(),other=await queued();
    await e.AGENT_DB.prepare("UPDATE agent_tenants SET status='offboarding' WHERE id IN (?,?)").bind(f.actor.tenantId,other.actor.tenantId).run();
    await e.AGENT_DB.prepare(`CREATE TRIGGER mailbox_maintenance_failure BEFORE UPDATE OF state ON agent_mailbox_changes
      WHEN NEW.stream_id='${f.streamId}' AND NEW.state='discarded' BEGIN SELECT RAISE(ABORT,'fixture maintenance failure'); END`).run();
    try{expect(await runMailboxMaintenance(e)).toMatchObject({selected:2,retired:1,failed:1});}
    finally{await e.AGENT_DB.prepare('DROP TRIGGER mailbox_maintenance_failure').run();}
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first()).toEqual({state:'ready'});
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_mailbox_changes WHERE stream_id=?').bind(f.streamId).first()).toEqual({state:'pending'});
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_mailbox_changes WHERE stream_id=?').bind(other.streamId).first()).toEqual({state:'discarded'});
    expect(await runMailboxMaintenance(e)).toMatchObject({selected:1,retired:1,failed:0});
  });
  it('gates message processing before database access on all three flags',async()=>{
    const db={prepare(){throw new Error('must not read');}} as unknown as D1Database;
    for(const flag of ['MAILBOX_SYNC_ENABLED','MAILBOX_RECOVERY_ENABLED','MAILBOX_PROCESSING_ENABLED'])
      expect(await runMailboxProcessing({...processing,[flag]:'false',AGENT_DB:db})).toEqual({disabled:true,selected:0,processed:0,deferred:0});
  });
  it('limits processing to five tenants and five round-robin calls per tenant',async()=>{
    for(let i=0;i<6;i++)await queued();
    const seen:string[]=[];
    expect(await runMailboxProcessing(processing,async actor=>{seen.push(actor.tenantId);return {ok:true,value:{state:'processed'}};}))
      .toEqual({disabled:false,selected:5,processed:25,deferred:0});
    expect(new Set(seen.slice(0,5)).size).toBe(5);
    expect(seen.slice(0,5)).toEqual(seen.slice(5,10));
    for(const tenant of new Set(seen))expect(seen.filter(id=>id===tenant)).toHaveLength(5);
  });
  it('drains a full queue even when polling requires resynchronization',async()=>{
    const f=await queued();
    await e.AGENT_DB.prepare(`INSERT INTO agent_mailbox_changes(stream_id,page_token,ordinal,message_id,kind,created_at)
      SELECT ?,?,CAST(key AS INTEGER)+1,'seed-'||key,'upsert',? FROM json_each(?)`)
      .bind(f.streamId,f.pageToken,new Date().toISOString(),JSON.stringify(Array.from({length:9999},(_,i)=>i))).run();
    await e.AGENT_DB.prepare("UPDATE agent_mailbox_sync SET state='resync_required' WHERE id=?").bind(f.streamId).run();
    expect(await runMailboxRecovery(e,async()=>{throw new Error('polling must be blocked');})).toMatchObject({selected:0});
    expect(await runMailboxProcessing(processing,async()=>{
      const claim=(await f.ledger.claimChange(f.streamId))!;
      expect(await f.ledger.saveChange(claim,null)).toBe(true);
      return {ok:true,value:{state:'processed'}};
    })).toEqual({disabled:false,selected:1,processed:5,deferred:0});
    expect(await e.AGENT_DB.prepare("SELECT COUNT(*) AS n FROM agent_mailbox_changes WHERE stream_id=? AND state='pending'").bind(f.streamId).first()).toEqual({n:9995});
  });
  it('stops a failed tenant without blocking others and preserves concurrent consumer backoff',async()=>{
    const failed=await queued(),successful=await queued();
    const later=new Date(Date.now()+3600000).toISOString();let calls=0;
    const result=await runMailboxProcessing(processing,async(_actor,id)=>{
      if(id===failed.streamId){calls++;
        await e.AGENT_DB.prepare('INSERT INTO agent_mailbox_consumers(stream_id,next_attempt_at) VALUES (?,?)').bind(id,later).run();
        throw new Error('fixture failure');
      }
      expect(id).toBe(successful.streamId);return {ok:true,value:{state:'processed'}};
    });
    expect(result).toEqual({disabled:false,selected:2,processed:5,deferred:1});expect(calls).toBe(1);
    expect(await e.AGENT_DB.prepare('SELECT next_attempt_at FROM agent_mailbox_consumers WHERE stream_id=?').bind(failed.streamId).first()).toEqual({next_attempt_at:later});
  });
  it('excludes active consumers, retry delays and review-required streams',async()=>{
    const held=await queued(),delayed=await queued(),review=await queued(),eligible=await queued();
    await held.ledger.claimChange(held.streamId);
    const delayClaim=(await delayed.ledger.claimChange(delayed.streamId))!;await delayed.ledger.deferChange(delayClaim,3600);
    const reviewClaim=(await review.ledger.claimChange(review.streamId))!;await review.ledger.deferChange(reviewClaim,300,true);
    const seen:string[]=[];
    expect(await runMailboxProcessing(processing,async(_actor,id)=>{seen.push(id);return {ok:true,value:{state:'review_required'}};}))
      .toEqual({disabled:false,selected:1,processed:0,deferred:1});
    expect(seen).toEqual([eligible.streamId]);
  });
  it('honors actual Agent pause during processing and creates bounded delay for an unstarted consumer',async()=>{
    const f=await queued();
    const agent=await getAgentByName(e.BUSINESS_AGENTS,f.actor.tenantId);
    await agent.provision(f.actor);await agent.pause(f.actor,true);
    expect(await runMailboxProcessing(processing)).toEqual({disabled:false,selected:1,processed:0,deferred:1});
    const saved=await e.AGENT_DB.prepare('SELECT next_attempt_at,attempts FROM agent_mailbox_consumers WHERE stream_id=?').bind(f.streamId).first<{next_attempt_at:string;attempts:number}>();
    expect(saved!.attempts).toBe(0);expect(Date.parse(saved!.next_attempt_at)).toBeGreaterThan(Date.now()+800000);
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_mailbox_changes WHERE stream_id=?').bind(f.streamId).first()).toEqual({state:'pending'});
  });
  it('does no database or dispatch work when either flag is disabled',async()=>{
    const db={prepare(){throw new Error('disabled database access');}} as unknown as D1Database;
    for(const flags of [{MAILBOX_SYNC_ENABLED:'false'},{MAILBOX_RECOVERY_ENABLED:'false'}]) {
      expect(await runMailboxRecovery({...e,...flags,AGENT_DB:db},async()=>{throw new Error('disabled dispatch');}))
        .toEqual({disabled:true,selected:0,completed:0,deferred:0});
    }
  });
  it('selects at most five distinct tenants and delays unchanged failures',async()=>{
    const fixtures=[];
    for(let i=0;i<6;i++)fixtures.push(await fixture());
    await fixtures[0].addStream();
    const seen:string[]=[];
    const result=await runMailboxRecovery(e,async(actor)=>{seen.push(actor.tenantId);throw new Error('fixture failure');});
    expect(result).toEqual({disabled:false,selected:5,completed:0,deferred:5});
    expect(new Set(seen).size).toBe(5);
    const delayed=await e.AGENT_DB.prepare("SELECT COUNT(*) AS n FROM agent_mailbox_sync WHERE state='ready' AND next_poll_at>'2000-01-01T00:00:00.000Z'").first<{n:number}>();
    expect(delayed!.n).toBe(5);
  });
  it('excludes paused tenants, revoked grants, future polls and active leases',async()=>{
    const paused=await fixture(),revoked=await fixture(),future=await fixture(),leased=await fixture(),eligible=await fixture();
    const later=new Date(Date.now()+3600000).toISOString();
    await e.AGENT_DB.batch([
      e.AGENT_DB.prepare("UPDATE agent_tenants SET status='paused' WHERE id=?").bind(paused.actor.tenantId),
      e.AGENT_DB.prepare("UPDATE auth_provider_grants SET status='revoked' WHERE id=?").bind(revoked.grantId),
      e.AGENT_DB.prepare('UPDATE agent_mailbox_sync SET next_poll_at=? WHERE id=?').bind(later,future.streamId),
      e.AGENT_DB.prepare("UPDATE agent_mailbox_sync SET lease_token='fixture',lease_until=? WHERE id=?").bind(later,leased.streamId),
    ]);
    const seen:string[]=[];
    expect(await runMailboxRecovery(e,async(_actor,id)=>{seen.push(id);return {ok:true,value:{state:'saved'}};}))
      .toEqual({disabled:false,selected:1,completed:1,deferred:0});
    expect(seen).toEqual([eligible.streamId]);
  });
  it('preserves concurrent provider backoff, changed progress and a live claim after dispatch failure',async()=>{
    const fixtures=[await fixture(),await fixture(),await fixture()];
    const later=new Date(Date.now()+7200000).toISOString();
    const byId=new Map(fixtures.map((f,i)=>[f.streamId,i]));
    await runMailboxRecovery(e,async(_actor,id)=>{
      const index=byId.get(id);
      if(index===0)await e.AGENT_DB.prepare('UPDATE agent_mailbox_sync SET next_poll_at=? WHERE id=?').bind(later,id).run();
      if(index===1)await e.AGENT_DB.prepare("UPDATE agent_mailbox_sync SET updated_at='2099-01-01T00:00:00.000Z',checkpoint='300' WHERE id=?").bind(id).run();
      if(index===2)await e.AGENT_DB.prepare("UPDATE agent_mailbox_sync SET lease_token='other-worker',lease_until=? WHERE id=?").bind(later,id).run();
      return {ok:false};
    });
    expect(await e.AGENT_DB.prepare('SELECT next_poll_at FROM agent_mailbox_sync WHERE id=?').bind(fixtures[0].streamId).first()).toEqual({next_poll_at:later});
    for(const f of fixtures.slice(1))expect(await e.AGENT_DB.prepare('SELECT next_poll_at FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first()).toEqual({next_poll_at:'1970-01-01T00:00:00.000Z'});
  });
  it('uses the actual owning Agent and respects its pause without contacting a provider',async()=>{
    const f=await fixture(),other=await fixture();
    const agent=await getAgentByName(e.BUSINESS_AGENTS,f.actor.tenantId);
    expect(await agent.provision(f.actor)).toMatchObject({ok:true});
    expect(await agent.pause(f.actor,true)).toMatchObject({ok:true});
    expect(await agent.syncMailbox(f.actor,f.streamId)).toMatchObject({ok:false,error:{code:'agent_paused'}});
    expect(await agent.syncMailbox(other.actor,other.streamId)).toMatchObject({ok:false,error:{code:'agent_mismatch'}});
    // The default dispatcher calls real Agent RPC. The other Agent has disabled
    // runtime mailbox flags, so both jobs fail locally and receive bounded delay.
    expect(await runMailboxRecovery(e)).toEqual({disabled:false,selected:2,completed:0,deferred:2});
    expect(await e.AGENT_DB.prepare('SELECT checkpoint,consecutive_attempts FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first())
      .toEqual({checkpoint:'200',consecutive_attempts:0});
  });
});
