import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {getAgentByName} from 'agents';
import {describe,it,expect} from 'vitest';
import type {Env} from '../src/env';
import {TextUsage} from '../src/billing/text-usage';
const access={period:'trial',limit:2,attemptLimit:3},hash='a'.repeat(64);
async function fixture(work:(usage:TextUsage,storage:DurableObjectStorage)=>void){
  const stub=await getAgentByName((env as unknown as Env).BUSINESS_AGENTS,crypto.randomUUID());
  await runInDurableObject(stub,(_instance,ctx)=>{const usage=new TextUsage(ctx.storage);usage.initialize();work(usage,ctx.storage);});
}
describe('shared chat and background text accounting',()=>{
  it('reserves multiple credits atomically and charges the same units on completion',async()=>fixture((usage,storage)=>{
    const allowance={...access,limit:5};
    storage.sql.exec("INSERT INTO turns(request_key,user_id,content,message_id,status,period,created_at) VALUES ('chat','owner','hello','m','complete','trial','now')");
    const job=usage.reserve('large','owner',hash,allowance,3);
    expect(usage.usage('trial')).toEqual({used:1,reserved:3});
    expect(()=>usage.reserve('too-large','owner',hash,allowance,2)).toThrow();
    expect(storage.sql.exec("SELECT id FROM background_text_usage WHERE id='too-large'").toArray()).toEqual([]);
    expect(()=>usage.startAttempt(job.token,{...allowance,limit:3})).toThrow();
    usage.startAttempt(job.token,allowance);usage.finish(job.token,true);
    expect(usage.usage('trial')).toEqual({used:4,reserved:0});
    expect(usage.reserve('large','owner',hash,allowance,3).state).toBe('complete');
    expect(()=>usage.reserve('large','owner',hash,allowance,1)).toThrow();
  }));
  it('releases all failed units but retains supplier attempts and immutable retry size',async()=>fixture((usage,storage)=>{
    const allowance={...access,limit:5},job=usage.reserve('large','owner',hash,allowance,4);
    usage.startAttempt(job.token,allowance);usage.finish(job.token,false);
    expect(usage.usage('trial')).toEqual({used:0,reserved:0});
    expect(storage.sql.exec('SELECT id FROM provider_attempts').toArray()).toHaveLength(1);
    expect(()=>usage.reserve('large','owner',hash,allowance,3)).toThrow();
    usage.reserve('large','owner',hash,allowance,4);expect(usage.usage('trial')).toEqual({used:0,reserved:4});
    usage.interrupt();expect(usage.usage('trial')).toEqual({used:0,reserved:0});
  }));
  it('rejects invalid unit counts without writing reservations',async()=>fixture((usage,storage)=>{
    for(const units of [0,-1,1.5,33,NaN,Infinity])expect(()=>usage.reserve('invalid','owner',hash,access,units)).toThrow();
    expect(storage.sql.exec('SELECT id FROM background_text_usage').toArray()).toEqual([]);
  }));
  it('upgrades existing single-credit rows idempotently',async()=>fixture((usage,storage)=>{
    storage.sql.exec('DROP TABLE background_text_usage');
    storage.sql.exec('CREATE TABLE background_text_usage(id TEXT PRIMARY KEY,user_id TEXT,payload_hash TEXT,period TEXT,status TEXT,token TEXT)');
    storage.sql.exec("INSERT INTO background_text_usage VALUES ('old','owner',?,'trial','complete','old-token')",hash);
    usage.initialize();usage.initialize();
    expect(usage.usage('trial')).toEqual({used:1,reserved:0});
    expect(usage.reserve('old','owner',hash,access)).toEqual({state:'complete',token:'old-token',period:'trial'});
  }));
  it('counts existing chat work and background reservations against one allowance',async()=>fixture((usage,storage)=>{
    storage.sql.exec("INSERT INTO turns(request_key,user_id,content,message_id,status,period,created_at) VALUES ('chat','owner','hello','m','complete','trial','now')");
    const job=usage.reserve('job','owner',hash,access);
    expect(usage.usage('trial')).toEqual({used:1,reserved:1});
    expect(()=>usage.reserve('other','owner',hash,access)).toThrow();
    usage.startAttempt(job.token,access);usage.finish(job.token,true);
    expect(usage.usage('trial')).toEqual({used:2,reserved:0});
    expect(usage.reserve('job','owner',hash,{...access,period:'later'})).toEqual({state:'complete',token:job.token,period:'trial'});
  }));
  it('retains failed supplier attempts while releasing customer reservations and fences retries',async()=>fixture(usage=>{
    const first=usage.reserve('job','owner',hash,access);usage.startAttempt(first.token,access);
    expect(()=>usage.startAttempt(first.token,access)).toThrow();
    usage.finish(first.token,false);expect(usage.usage('trial')).toEqual({used:0,reserved:0});
    const retry=usage.reserve('job','owner',hash,access);expect(retry.token).not.toBe(first.token);
    expect(()=>usage.finish(first.token,true)).toThrow();
    usage.startAttempt(retry.token,access);usage.finish(retry.token,false);
    const third=usage.reserve('job','owner',hash,access);usage.startAttempt(third.token,access);usage.finish(third.token,false);
    const fourth=usage.reserve('job','owner',hash,access);expect(()=>usage.startAttempt(fourth.token,access)).toThrow();
    usage.finish(fourth.token,false);
  }));
  it('counts prior chat provider attempts even when they failed',async()=>fixture((usage,storage)=>{
    for(let i=0;i<3;i++)storage.sql.exec("INSERT INTO provider_attempts VALUES (?,?,?,'trial','failed','now')",String(i),'owner',`chat-${i}`);
    const job=usage.reserve('job','owner',hash,access);expect(()=>usage.startAttempt(job.token,access)).toThrow();
    expect(()=>usage.finish(job.token,true)).toThrow();usage.finish(job.token,false);
  }));
  it('preserves identity and payload binding and rejects changed periods before dispatch',async()=>fixture(usage=>{
    const job=usage.reserve('job','owner',hash,access);
    expect(()=>usage.reserve('job','other',hash,access)).toThrow();
    expect(()=>usage.reserve('job','owner','b'.repeat(64),access)).toThrow();
    expect(()=>usage.startAttempt(job.token,{...access,period:'later'})).toThrow();
    expect(()=>usage.startAttempt(job.token,{...access,limit:0})).toThrow();
    usage.interrupt();expect(()=>usage.finish(job.token,true)).toThrow();
    const next=usage.reserve('job','owner',hash,{...access,period:'later'});
    expect(next.period).toBe('later');expect(usage.usage('trial')).toEqual({used:0,reserved:0});
  }));
  it('rolls completion back with failed result persistence',async()=>fixture((usage,storage)=>{
    const job=usage.reserve('job','owner',hash,access);usage.startAttempt(job.token,access);
    expect(()=>storage.transactionSync(()=>{usage.finish(job.token,true);throw new Error('result write failed');})).toThrow();
    expect(usage.usage('trial')).toEqual({used:0,reserved:1});
    usage.finish(job.token,true);expect(usage.usage('trial')).toEqual({used:1,reserved:0});
  }));
});
