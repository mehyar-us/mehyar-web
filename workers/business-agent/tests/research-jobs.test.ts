import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {getAgentByName} from 'agents';
import {describe,it,expect} from 'vitest';
import type {Env} from '../src/env';
import {ResearchJobs} from '../src/research/jobs';
import {ResearchRunner} from '../src/research/runner';
import {ResearchSpend} from '../src/research/spend';
import {ResearchCancellation} from '../src/research/cancellation';
const input=()=>({key:crypto.randomUUID(),url:'https://salon.example.com/',period:'trial',allowance:20,pages:20,depth:2,deadline:Date.now()+60_000});
const provider='11111111-1111-4111-8111-111111111111';
async function ledger(work:(jobs:ResearchJobs,spend:ResearchSpend,storage:DurableObjectStorage)=>void|Promise<void>){
  const stub=await getAgentByName((env as unknown as Env).BUSINESS_AGENTS,crypto.randomUUID());
  await runInDurableObject(stub,async(_instance,ctx)=>{const jobs=new ResearchJobs(ctx.storage);jobs.initialize();await work(jobs,new ResearchSpend(ctx.storage),ctx.storage);});
}
describe('durable research reservations',()=>{
  it('persists stop acknowledgement without resending or releasing commitments',async()=>ledger(async(jobs,spend)=>{
    const job=jobs.reserve(input());jobs.reserveSpend(job.id,100,100,'fixture');jobs.beginFunded(job.id);jobs.submitted(job.id,provider);jobs.cancel(job.id);
    let calls=0,release!:()=>void;
    const pending=new Promise<void>(resolve=>{release=resolve;});
    const stop=new ResearchCancellation(jobs,{cancel:async()=>{calls++;await pending;return {requested:true};}},async()=>{});
    const first=stop.deliver(job.id);
    // Advance microtasks until the provider owns the pending request.
    while(calls===0)await Promise.resolve();
    await expect(stop.deliver(job.id)).rejects.toMatchObject({code:'research_stop_wait'});
    release();await first;jobs.initialize();
    await stop.deliver(job.id);expect(calls).toBe(1);
    expect(jobs.stopDelivery(job.id)).toMatchObject({attempts:1,lease_id:null,acknowledged_at:expect.any(String)});
    expect(jobs.get(job.id)).toMatchObject({status:'cancel_requested',reserved:20});expect(spend.get(job.id)?.status).toBe('dispatched');
  }));
  it('bounds stop retries across restarts and fences stale acknowledgements',async()=>ledger(jobs=>{
    const job=jobs.reserve(input());jobs.begin(job.id);jobs.submitted(job.id,provider);jobs.cancel(job.id);
    let now=Date.now();const first=jobs.claimStop(job.id,now)!;
    now+=60_001;const second=jobs.claimStop(job.id,now)!;
    expect(jobs.finishStop(job.id,first,true,now)).toBe(false);
    expect(jobs.finishStop(job.id,second,false,now)).toBe(true);
    expect(()=>jobs.claimStop(job.id,now+9999)).toThrow('waiting to retry');
    for(let attempt=2;attempt<8;attempt++){
      now+=900_001;const lease=jobs.claimStop(job.id,now)!;jobs.finishStop(job.id,lease,false,now);
    }
    jobs.initialize();expect(()=>jobs.claimStop(job.id,now+900_001)).toThrow('operator review');
    expect(jobs.stopDelivery(job.id)).toMatchObject({attempts:8,acknowledged_at:null});
    expect(jobs.summary(job.id).attention).toBe('stop_limit');
    expect(jobs.get(job.id).reserved).toBe(20);
    jobs.settle(job.id,'cancelled',0);expect(jobs.summary(job.id).attention).toBeNull();
  }));
  it('preserves the original business and requester across retries and restart',async()=>ledger(jobs=>{
    const actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()},request=input();
    const job=jobs.reserveFor(actor,request);jobs.initialize();
    expect(jobs.requester(job.id)).toEqual(actor);
    expect(jobs.reserveFor(actor,request).id).toBe(job.id);
    expect(()=>jobs.reserveFor({...actor,userId:crypto.randomUUID()},request)).toThrow('cannot be replaced');
    expect(()=>jobs.reserveFor({...actor,tenantId:crypto.randomUUID()},request)).toThrow('cannot be replaced');
    expect(jobs.requester(job.id)).toEqual(actor);
    expect(jobs.summary(job.id)).not.toHaveProperty('userId');
  }));
  it('never adopts unattributed work on replay',async()=>ledger(jobs=>{
    const request=input(),job=jobs.reserve(request);
    expect(()=>jobs.reserveFor({tenantId:crypto.randomUUID(),userId:crypto.randomUUID()},request)).toThrow('Unattributed');
    expect(jobs.requester(job.id)).toBeNull();
  }));
  it('serializes polls and rejects stale leases after recovery',async()=>ledger(jobs=>{
    const job=jobs.reserve(input());jobs.begin(job.id);jobs.submitted(job.id,provider);
    const now=Date.now(),first=jobs.claimPoll(job.id,now);
    expect(()=>jobs.claimPoll(job.id,now)).toThrow('already active');
    const next=jobs.claimPoll(job.id,now+60_001);
    expect(()=>jobs.assertPoll(job.id,first,now+60_001)).toThrow('newer research poll');
    jobs.finishPoll(job.id,first,true,0,now+60_001);
    jobs.assertPoll(job.id,next,now+60_001);
  }));
  it('backs off failed polling and stops after repeated failures without releasing uncertain spend',async()=>ledger((jobs,spend)=>{
    const job=jobs.reserve(input());jobs.reserveSpend(job.id,100,100,'fixture');jobs.beginFunded(job.id);jobs.submitted(job.id,provider);
    let now=Date.now();
    for(let i=0;i<8;i++){
      const lease=jobs.claimPoll(job.id,now);jobs.finishPoll(job.id,lease,false,0,now);
      if(i===0)expect(()=>jobs.claimPoll(job.id,now+4999)).toThrow('waiting to retry');
      now+=900_001;
    }
    jobs.initialize();expect(()=>jobs.claimPoll(job.id,now)).toThrow('operator review');
    expect(jobs.summary(job.id).attention).toBe('poll_failures');
    expect(spend.get(job.id)?.status).toBe('dispatched');
  }));
  it('bounds total polls even when every provider response reports running',async()=>ledger(jobs=>{
    const job=jobs.reserve({...input(),pages:1});jobs.begin(job.id);jobs.submitted(job.id,provider);
    let now=Date.now();
    for(let i=0;i<121;i++){const lease=jobs.claimPoll(job.id,now);jobs.finishPoll(job.id,lease,true,30_000,now);now+=30_001;}
    expect(()=>jobs.claimPoll(job.id,now)).toThrow('operator review');
    expect(jobs.summary(job.id).attention).toBe('poll_limit');
    jobs.settle(job.id,'completed',0);expect(jobs.summary(job.id).attention).toBeNull();
  }));
  it('requires supplier funding atomically before provider dispatch',async()=>ledger(async jobs=>{
    const job=jobs.reserve(input());let calls=0;
    const runner=new ResearchRunner(jobs,{start:async()=>{calls++;return {id:provider};},results:async()=>({id:provider,status:'running',records:[]}),cancel:async()=>({requested:true})},async()=>{});
    await expect(runner.submit(job.id)).rejects.toThrow('reserved before dispatch');
    expect(calls).toBe(0);expect(jobs.get(job.id).status).toBe('reserved');
    jobs.reserveSpend(job.id,100,100,'fixture-quote');await runner.submit(job.id);expect(calls).toBe(1);
  }));
  it('bounds commitments and accounts for reconciled overruns without masking expense',async()=>ledger((jobs,spend)=>{
    const a=jobs.reserve({...input(),pages:5}),b=jobs.reserve({...input(),pages:5});
    jobs.reserveSpend(a.id,100,150,'fixture');expect(()=>jobs.reserveSpend(b.id,100,150,'fixture')).toThrow('budget');
    expect(jobs.reserveSpend(a.id,100,150,'fixture').reserved_micros).toBe(100);
    expect(()=>jobs.reserveSpend(a.id,50,150,'changed')).toThrow('different terms');
    jobs.beginFunded(a.id);jobs.uncertain(a.id);expect(spend.release(a.id)?.status).toBe('dispatched');
    expect(spend.settle(a.id,200)).toMatchObject({actual_micros:200,status:'settled'});
    expect(spend.settle(a.id,200).actual_micros).toBe(200);
    expect(()=>spend.settle(a.id,100)).toThrow('dispatched');
    expect(()=>jobs.reserveSpend(b.id,1,150,'fixture')).toThrow('budget');
  }));
  it('releases only unsubmitted commitments on cancellation or expiry',async()=>ledger((jobs,spend)=>{
    const a=jobs.reserve({...input(),pages:5}),b=jobs.reserve({...input(),pages:5}),c=jobs.reserve({...input(),pages:5});
    for(const job of [a,b,c])jobs.reserveSpend(job.id,100,300,'fixture');
    jobs.cancel(a.id);expect(spend.get(a.id)?.status).toBe('released');
    jobs.beginFunded(c.id);jobs.expire(Date.now()+3_600_000);jobs.initialize();
    expect(spend.get(b.id)?.status).toBe('released');expect(spend.get(c.id)?.status).toBe('dispatched');
    expect(()=>spend.settle(b.id,0)).toThrow('dispatched');
  }));
  it('keeps missing provider usage unknown and explicit zero distinct across restarts',async()=>ledger(jobs=>{
    const job=jobs.reserve(input());jobs.begin(job.id);jobs.submitted(job.id,provider);
    expect(jobs.providerUsage(job.id)).toBeNull();
    expect(jobs.observeProviderUsage(job.id,provider,undefined,true)).toBeNull();
    expect(jobs.observeProviderUsage(job.id,provider,0,false)).toMatchObject({browser_seconds:0,terminal_observed:0});
    jobs.initialize();expect(jobs.providerUsage(job.id)).toMatchObject({browser_seconds:0});
  }));
  it('retains cumulative usage without summing polling duplicates or stale values',async()=>ledger(jobs=>{
    const job=jobs.reserve(input());jobs.begin(job.id);jobs.submitted(job.id,provider);
    jobs.observeProviderUsage(job.id,provider,12.75,false);
    jobs.observeProviderUsage(job.id,provider,12.75,false);
    jobs.observeProviderUsage(job.id,provider,5,false);
    expect(jobs.providerUsage(job.id)).toMatchObject({browser_seconds:12.75,terminal_observed:0});
    jobs.observeProviderUsage(job.id,provider,20.5,true);jobs.settle(job.id,'completed',0);jobs.initialize();
    expect(jobs.providerUsage(job.id)).toMatchObject({browser_seconds:20.5,terminal_observed:1});
    expect(jobs.summary(job.id)).not.toHaveProperty('browser_seconds');
  }));
  it('rejects malformed usage and foreign provider attribution',async()=>ledger(jobs=>{
    const job=jobs.reserve(input());jobs.begin(job.id);jobs.submitted(job.id,provider);
    for(const value of [-1,NaN,Infinity,Number.MAX_SAFE_INTEGER*2])expect(()=>jobs.observeProviderUsage(job.id,provider,value,false)).toThrow('invalid browser usage');
    expect(()=>jobs.observeProviderUsage(job.id,'different-provider',5,false)).toThrow('does not match');
    expect(jobs.providerUsage(job.id)).toBeNull();
  }));
  it('allows only one trial dispatch even when it used fewer than twenty pages',async()=>ledger(jobs=>{
    const request={...input(),maxJobs:1,pages:5},cancelled=jobs.reserve(request);jobs.cancel(cancelled.id);
    const job=jobs.reserve({...request,key:crypto.randomUUID()});jobs.begin(job.id);jobs.submitted(job.id,provider);jobs.settle(job.id,'completed',1);
    expect(()=>jobs.reserve({...request,key:crypto.randomUUID()})).toThrow('already been reserved or used');
    expect(jobs.reserve({...request,key:job.request_key}).id).toBe(job.id);
  }));
  it('reserves one allowance atomically and replays only the same request',async()=>ledger(jobs=>{
    const request=input(),job=jobs.reserve(request);
    expect(jobs.reserve(request)).toEqual(job);
    expect(()=>jobs.reserve({...request,url:'https://other.example.com/'})).toThrow('different research');
    expect(()=>jobs.reserve(input())).toThrow('allowance');
    expect(jobs.get(job.id)).toMatchObject({status:'reserved',used:0,reserved:20});
  }));
  it('retains uncertain submission reservations across reinitialization and forbids resubmission',async()=>ledger(jobs=>{
    const job=jobs.reserve(input());jobs.begin(job.id);jobs.initialize();
    expect(jobs.get(job.id)).toMatchObject({status:'uncertain',reserved:20});
    expect(jobs.summary(job.id).attention).toBe('submission_uncertain');
    expect(()=>jobs.begin(job.id)).toThrow('cannot be submitted');
    expect(jobs.cancel(job.id).status).toBe('uncertain');
    expect(()=>jobs.settle(job.id,'failed',0)).toThrow('verified');
    expect(()=>jobs.reserve(input())).toThrow('allowance');
  }));
  it('releases unsubmitted cancellations but retains provider cancellation reservations until settlement',async()=>ledger(jobs=>{
    const first=jobs.reserve(input());expect(jobs.cancel(first.id)).toMatchObject({status:'cancelled',reserved:0});
    const next=jobs.reserve(input());jobs.begin(next.id);jobs.submitted(next.id,provider);
    expect(jobs.cancel(next.id)).toMatchObject({status:'cancel_requested',reserved:20});
    expect(()=>jobs.reserve(input())).toThrow('allowance');
    expect(jobs.settle(next.id,'cancelled',3)).toMatchObject({used:3,reserved:0,status:'cancelled'});
    expect(jobs.settle(next.id,'cancelled',3).used).toBe(3);
    expect(()=>jobs.settle(next.id,'completed',0)).toThrow('verified');
    expect(jobs.reserve({...input(),pages:17}).reserved).toBe(17);
  }));
  it('enforces deadlines, limits, and provider claims without dropping reservations',async()=>ledger(jobs=>{
    const request=input(),job=jobs.reserve(request);
    expect(()=>jobs.begin(job.id,request.deadline)).toThrow('cannot be submitted');
    jobs.begin(job.id);
    expect(()=>jobs.submitted(job.id,'../invalid')).toThrow('identifier');
    jobs.submitted(job.id,provider);expect(jobs.submitted(job.id,provider).status).toBe('running');
    expect(()=>jobs.settle(job.id,'completed',21)).toThrow('page count');
    expect(jobs.settle(job.id,'completed',20)).toMatchObject({used:20,reserved:0});
    expect(()=>jobs.reserve({...input(),depth:6})).toThrow('bounded');
    expect(()=>jobs.reserve({...input(),deadline:Date.now()+7_200_000})).toThrow('bounded');
  }));
  it('keeps period accounting separate and never refunds an ambiguous submission',async()=>ledger(jobs=>{
    const first=jobs.reserve(input());jobs.begin(first.id);jobs.uncertain(first.id);
    const second=jobs.reserve({...input(),period:'next-month'});
    expect(second.reserved).toBe(20);expect(jobs.get(first.id).reserved).toBe(20);
  }));
  it('expires queued work but requires provider reconciliation for dispatched deadlines',async()=>ledger(jobs=>{
    const request={...input(),pages:5},queued=jobs.reserve(request);
    const running=jobs.reserve({...request,key:crypto.randomUUID()});jobs.begin(running.id);jobs.submitted(running.id,provider);
    const submitting=jobs.reserve({...request,key:crypto.randomUUID()});jobs.begin(submitting.id);
    jobs.expire(request.deadline);
    expect(jobs.get(queued.id)).toMatchObject({status:'cancelled',reserved:0});
    expect(jobs.get(running.id)).toMatchObject({status:'cancel_requested',reserved:5});
    expect(jobs.get(submitting.id)).toMatchObject({status:'uncertain',reserved:5});
  }));
  it('persists source-backed evidence once across concurrent delivery and restart',async()=>ledger(async jobs=>{
    const job=jobs.reserve(input());jobs.begin(job.id);jobs.submitted(job.id,provider);
    const record={url:job.source,status:'completed' as const,httpStatus:200,html:'<title>Oak Salon</title>'};
    const stamp=new Date().toISOString();
    const [a,b]=await Promise.all([jobs.ingest(job.id,provider,record,stamp),jobs.ingest(job.id,provider,record,stamp)]);
    expect(a).toEqual(b);jobs.initialize();
    expect(jobs.pages(job.id)).toEqual([a]);
    expect(a.evidence[0]).toMatchObject({value:'Oak Salon',sourceUrl:job.source,verification:'unverified',trustedForInstructions:false});
    await expect(jobs.ingest(job.id,provider,{...record,html:'<title>Different</title>'},stamp)).rejects.toThrow('conflicting content');
    expect(()=>jobs.settle(job.id,'completed',0)).toThrow('cannot omit');
    expect(jobs.settle(job.id,'completed',1)).toMatchObject({used:1,reserved:0});
  }));
  it('rejects foreign providers, origins, disallowed pages and over-limit evidence',async()=>ledger(async jobs=>{
    const job=jobs.reserve({...input(),pages:1});jobs.begin(job.id);jobs.submitted(job.id,provider);
    const record={url:job.source,status:'completed' as const,httpStatus:200,html:'<title>Page</title>'},stamp=new Date().toISOString();
    await expect(jobs.ingest(job.id,'another-provider',record,stamp)).rejects.toThrow('provider job');
    await expect(jobs.ingest(job.id,provider,{...record,finalUrl:'https://other.example.com/'},stamp)).rejects.toThrow('approved website');
    await expect(jobs.ingest(job.id,provider,{...record,status:'disallowed'},stamp)).rejects.toThrow('permitted');
    await jobs.ingest(job.id,provider,record,stamp);
    await expect(jobs.ingest(job.id,provider,{...record,url:job.source+'contact'},stamp)).rejects.toThrow('reserved page limit');
    expect(jobs.pages(job.id)).toHaveLength(1);
  }));
  it('rechecks settlement after asynchronous extraction before writing evidence',async()=>ledger(async jobs=>{
    const job=jobs.reserve(input());jobs.begin(job.id);jobs.submitted(job.id,provider);
    const pending=jobs.ingest(job.id,provider,{url:job.source,status:'completed',httpStatus:200,html:'<title>Late page</title>'},new Date().toISOString());
    jobs.settle(job.id,'cancelled',0);
    await expect(pending).rejects.toThrow('stopped accepting');expect(jobs.pages(job.id)).toEqual([]);
  }));
  it('deduplicates redirects by final source and keeps reads scoped to the job',async()=>ledger(async jobs=>{
    const job=jobs.reserve({...input(),pages:5});jobs.begin(job.id);jobs.submitted(job.id,provider);
    const record={url:job.source,status:'completed' as const,httpStatus:200,finalUrl:job.source+'about',html:'<title>About</title>'};
    await jobs.ingest(job.id,provider,record,new Date().toISOString());
    await jobs.ingest(job.id,provider,{...record,url:job.source+'old-about'},new Date().toISOString());
    expect(jobs.pages(job.id)).toHaveLength(1);expect(jobs.pages(job.id)[0].url).toBe(record.finalUrl);
    const other=jobs.reserve({...input(),pages:5});expect(jobs.pages(other.id)).toEqual([]);
    expect(jobs.pages(job.id,20)).toEqual([]);expect(()=>jobs.pages(job.id,-1)).toThrow('offset');
  }));
  it('submits once and resumes paginated terminal evidence after restart before settling',async()=>ledger(async(jobs,_spend,storage)=>{
    const job=jobs.reserve(input());let starts=0;
    const api={start:async()=>{starts++;return {id:provider};},cancel:async()=>({requested:true}),results:async(_id:string,_url:string,cursor?:number)=>({id:provider,status:'completed' as const,browserSecondsUsed:15.5,
      records:[{url:job.source+(cursor?'contact':''),status:'completed' as const,httpStatus:200,html:'<title>Salon</title>'}],...(cursor?{}:{cursor:1})})};
    const runner=new ResearchRunner(jobs,api,async()=>{});
    jobs.reserveSpend(job.id,100,100,'fixture');await runner.submit(job.id);await expect(runner.submit(job.id)).rejects.toThrow('cannot be submitted');expect(starts).toBe(1);
    expect((await runner.poll(job.id)).status).toBe('running');expect(jobs.checkpoint(job.id).cursor).toBe(1);
    jobs.initialize();
    storage.sql.exec('UPDATE research_poll_work SET next_at=0 WHERE job_id=?',job.id);
    expect(await new ResearchRunner(jobs,api,async()=>{}).poll(job.id)).toMatchObject({status:'completed',used:2,reserved:0});
    expect(jobs.pages(job.id)).toHaveLength(2);
    expect(jobs.providerUsage(job.id)).toMatchObject({browser_seconds:15.5,terminal_observed:1});
  }));
  it('retains ambiguous submissions and captures late receipts after cancellation',async()=>ledger(async jobs=>{
    const job=jobs.reserve({...input(),pages:5});let calls=0;
    const api={start:async()=>{calls++;throw new Error('network lost');},cancel:async()=>({requested:true}),results:async()=>({id:provider,status:'running' as const,records:[]})};
    const runner=new ResearchRunner(jobs,api,async()=>{});
    jobs.reserveSpend(job.id,100,100,'fixture');await expect(runner.submit(job.id)).rejects.toThrow('network lost');await expect(runner.submit(job.id)).rejects.toThrow('cannot be submitted');
    expect(calls).toBe(1);expect(jobs.get(job.id)).toMatchObject({status:'uncertain',reserved:5});
    expect(jobs.submitted(job.id,provider)).toMatchObject({status:'cancel_requested',provider_id:provider});
  }));
  it('does not ingest running results and rejects looping terminal pagination',async()=>ledger(async(jobs,_spend,storage)=>{
    const job=jobs.reserve(input());jobs.begin(job.id);jobs.submitted(job.id,provider);let running=true;
    const runner=new ResearchRunner(jobs,{start:async()=>({id:provider}),cancel:async()=>({requested:true}),results:async()=>({id:provider,status:running?'running':'completed',records:[],cursor:0})},async()=>{});
    await runner.poll(job.id);expect(jobs.checkpoint(job.id).steps).toBe(0);running=false;
    storage.sql.exec('UPDATE research_poll_work SET next_at=0 WHERE job_id=?',job.id);
    await expect(runner.poll(job.id)).rejects.toThrow('looping');expect(jobs.get(job.id).reserved).toBe(20);
  }));
  it('withholds fetched evidence after access is revoked during polling',async()=>ledger(async jobs=>{
    const job=jobs.reserve(input());jobs.begin(job.id);jobs.submitted(job.id,provider);let allowed=true;
    const runner=new ResearchRunner(jobs,{start:async()=>({id:provider}),cancel:async()=>({requested:true}),results:async()=>{allowed=false;return {id:provider,status:'completed',records:[{url:job.source,status:'completed',httpStatus:200,html:'<title>Private</title>'}]};}},async()=>{if(!allowed)throw new Error('revoked');});
    await expect(runner.poll(job.id)).rejects.toThrow('revoked');expect(jobs.pages(job.id)).toEqual([]);expect(jobs.checkpoint(job.id).steps).toBe(0);
  }));
  it('retains cancellation allowance until a terminal provider snapshot is consumed',async()=>ledger(async jobs=>{
    const job=jobs.reserve(input());jobs.begin(job.id);jobs.submitted(job.id,provider);let cancelled=0;
    const api={start:async()=>({id:provider}),cancel:async()=>{cancelled++;return {requested:true};},results:async()=>({id:provider,status:'cancelled_by_user' as const,records:[]})};
    const runner=new ResearchRunner(jobs,api,async()=>{});
    jobs.withdraw(job.id,'owner');
    expect(await new ResearchCancellation(jobs,api,async()=>{}).deliver(job.id)).toMatchObject({status:'cancel_requested',reserved:20});expect(cancelled).toBe(1);
    expect(await runner.poll(job.id)).toMatchObject({status:'cancelled',reserved:0,used:0});
  }));
  it('delivers a recorded stop after execution authority is revoked without starting or importing work',async()=>ledger(async(jobs,spend)=>{
    const job=jobs.reserve(input());jobs.reserveSpend(job.id,100,100,'fixture');jobs.beginFunded(job.id);jobs.submitted(job.id,provider);
    let starts=0,reads=0,stops=0;
    const api={start:async()=>{starts++;return {id:provider};},results:async()=>{reads++;return {id:provider,status:'running' as const,records:[]};},cancel:async(id:string)=>{expect(id).toBe(provider);stops++;return {requested:true};}};
    const runner=new ResearchRunner(jobs,api,async()=>{throw new Error('revoked');});
    jobs.withdraw(job.id,'another-current-owner');jobs.initialize();
    await expect(runner.submit(job.id)).rejects.toThrow('revoked');
    await expect(runner.poll(job.id)).rejects.toThrow('revoked');
    await new ResearchCancellation(jobs,api,async id=>{expect(id).toBe(job.id);}).deliver(job.id);
    expect({starts,reads,stops}).toEqual({starts:0,reads:0,stops:1});
    expect(jobs.get(job.id)).toMatchObject({status:'cancel_requested',reserved:20});
    expect(spend.get(job.id)?.status).toBe('dispatched');expect(jobs.pages(job.id)).toEqual([]);
  }));
  it('requires recorded stop intent, a known provider and independent stop authority',async()=>ledger(async jobs=>{
    const job=jobs.reserve(input());let calls=0;
    const api={cancel:async()=>{calls++;return {requested:true};}},stop=new ResearchCancellation(jobs,api,async()=>{});
    await expect(stop.deliver(job.id)).rejects.toMatchObject({code:'research_stop_not_ready'});
    jobs.begin(job.id);jobs.submitted(job.id,provider);
    await expect(stop.deliver(job.id)).rejects.toMatchObject({code:'research_stop_not_ready'});
    jobs.cancel(job.id);
    await expect(new ResearchCancellation(jobs,api,async()=>{throw new Error('wrong workspace');}).deliver(job.id)).rejects.toThrow('wrong workspace');
    expect(calls).toBe(0);
    await expect(new ResearchCancellation(jobs,{cancel:async()=>{throw new Error('network lost');}},async()=>{}).deliver(job.id)).rejects.toThrow('network lost');
    expect(jobs.get(job.id)).toMatchObject({status:'cancel_requested',reserved:20});
    jobs.settle(job.id,'cancelled',0);await stop.deliver(job.id);expect(calls).toBe(0);
  }));
});
