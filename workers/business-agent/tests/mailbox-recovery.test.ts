import {env} from 'cloudflare:workers';
import {getAgentByName} from 'agents';
import {beforeEach,describe,it,expect} from 'vitest';
import type {Env} from '../src/env';
import {createTenant} from '../src/tenants';
import {storeProviderGrant} from '../src/auth/vault';
import {MailboxSync} from '../src/connectors/mailbox-sync';
import {runMailboxRecovery} from '../src/connectors/mailbox-recovery';
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
  beforeEach(async()=>{await e.AGENT_DB.prepare("UPDATE agent_mailbox_sync SET state='resync_required'").run();});
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
