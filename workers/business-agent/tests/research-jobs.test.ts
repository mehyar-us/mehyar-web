import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {getAgentByName} from 'agents';
import {describe,it,expect} from 'vitest';
import type {Env} from '../src/env';
import {ResearchJobs} from '../src/research/jobs';
import {ResearchRunner} from '../src/research/runner';
const input=()=>({key:crypto.randomUUID(),url:'https://salon.example.com/',period:'trial',allowance:20,pages:20,depth:2,deadline:Date.now()+60_000});
const provider='11111111-1111-4111-8111-111111111111';
async function ledger(work:(jobs:ResearchJobs)=>void|Promise<void>){
  const stub=await getAgentByName((env as unknown as Env).BUSINESS_AGENTS,crypto.randomUUID());
  await runInDurableObject(stub,async(_instance,ctx)=>{const jobs=new ResearchJobs(ctx.storage);jobs.initialize();await work(jobs);});
}
describe('durable research reservations',()=>{
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
  it('submits once and resumes paginated terminal evidence after restart before settling',async()=>ledger(async jobs=>{
    const job=jobs.reserve(input());let starts=0;
    const api={start:async()=>{starts++;return {id:provider};},cancel:async()=>({requested:true}),results:async(_id:string,_url:string,cursor?:number)=>({id:provider,status:'completed' as const,
      records:[{url:job.source+(cursor?'contact':''),status:'completed' as const,httpStatus:200,html:'<title>Salon</title>'}],...(cursor?{}:{cursor:1})})};
    const runner=new ResearchRunner(jobs,api,async()=>{});
    await runner.submit(job.id);await expect(runner.submit(job.id)).rejects.toThrow('cannot be submitted');expect(starts).toBe(1);
    expect((await runner.poll(job.id)).status).toBe('running');expect(jobs.checkpoint(job.id).cursor).toBe(1);
    jobs.initialize();
    expect(await new ResearchRunner(jobs,api,async()=>{}).poll(job.id)).toMatchObject({status:'completed',used:2,reserved:0});
    expect(jobs.pages(job.id)).toHaveLength(2);
  }));
  it('retains ambiguous submissions and captures late receipts after cancellation',async()=>ledger(async jobs=>{
    const job=jobs.reserve({...input(),pages:5});let calls=0;
    const api={start:async()=>{calls++;throw new Error('network lost');},cancel:async()=>({requested:true}),results:async()=>({id:provider,status:'running' as const,records:[]})};
    const runner=new ResearchRunner(jobs,api,async()=>{});
    await expect(runner.submit(job.id)).rejects.toThrow('network lost');await expect(runner.submit(job.id)).rejects.toThrow('cannot be submitted');
    expect(calls).toBe(1);expect(jobs.get(job.id)).toMatchObject({status:'uncertain',reserved:5});
    expect(jobs.submitted(job.id,provider)).toMatchObject({status:'cancel_requested',provider_id:provider});
  }));
  it('does not ingest running results and rejects looping terminal pagination',async()=>ledger(async jobs=>{
    const job=jobs.reserve(input());jobs.begin(job.id);jobs.submitted(job.id,provider);let running=true;
    const runner=new ResearchRunner(jobs,{start:async()=>({id:provider}),cancel:async()=>({requested:true}),results:async()=>({id:provider,status:running?'running':'completed',records:[],cursor:0})},async()=>{});
    await runner.poll(job.id);expect(jobs.checkpoint(job.id).steps).toBe(0);running=false;
    await expect(runner.poll(job.id)).rejects.toThrow('looping');expect(jobs.get(job.id).reserved).toBe(20);
  }));
  it('withholds fetched evidence after access is revoked during polling',async()=>ledger(async jobs=>{
    const job=jobs.reserve(input());jobs.begin(job.id);jobs.submitted(job.id,provider);let allowed=true;
    const runner=new ResearchRunner(jobs,{start:async()=>({id:provider}),cancel:async()=>({requested:true}),results:async()=>{allowed=false;return {id:provider,status:'completed',records:[{url:job.source,status:'completed',httpStatus:200,html:'<title>Private</title>'}]};}},async()=>{if(!allowed)throw new Error('revoked');});
    await expect(runner.poll(job.id)).rejects.toThrow('revoked');expect(jobs.pages(job.id)).toEqual([]);expect(jobs.checkpoint(job.id).steps).toBe(0);
  }));
  it('retains cancellation allowance until a terminal provider snapshot is consumed',async()=>ledger(async jobs=>{
    const job=jobs.reserve(input());jobs.begin(job.id);jobs.submitted(job.id,provider);let cancelled=0;
    const runner=new ResearchRunner(jobs,{start:async()=>({id:provider}),cancel:async()=>{cancelled++;return {requested:true};},results:async()=>({id:provider,status:'cancelled_by_user',records:[]})},async()=>{});
    expect(await runner.cancel(job.id)).toMatchObject({status:'cancel_requested',reserved:20});expect(cancelled).toBe(1);
    expect(await runner.poll(job.id)).toMatchObject({status:'cancelled',reserved:0,used:0});
  }));
});
