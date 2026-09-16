import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {getAgentByName} from 'agents';
import {describe,it,expect} from 'vitest';
import type {Env} from '../src/env';
import {ResearchJobs} from '../src/research/jobs';
const input=()=>({key:crypto.randomUUID(),url:'https://salon.example.com/',period:'trial',allowance:20,pages:20,depth:2,deadline:Date.now()+60_000});
const provider='11111111-1111-4111-8111-111111111111';
async function ledger(work:(jobs:ResearchJobs)=>void){
  const stub=await getAgentByName((env as unknown as Env).BUSINESS_AGENTS,crypto.randomUUID());
  await runInDurableObject(stub,async(_instance,ctx)=>{const jobs=new ResearchJobs(ctx.storage);jobs.initialize();work(jobs);});
}
describe('durable research reservations',()=>{
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
});
