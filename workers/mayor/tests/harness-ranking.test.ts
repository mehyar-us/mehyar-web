import {describe,it,expect} from 'vitest';
import {rankOrder,planDrain,RANK_DAILY_BUDGET,type QueuedSignal} from '../src/harness-ranking';
import {readHarnessRuntime} from '../src/harness-runtime';
import type {Env} from '../src/env';

/* Harness slice 1 (2026-10-17): the thin ranker + the HARD daily
 * cap, and the runtime flag's fail-safe default. */
const sig=(detector:QueuedSignal['detector'],queuedAt:number,id=detector+queuedAt):QueuedSignal=>
 ({detectionId:id,detector,queuedAt});

describe('rankOrder',()=>{
 it('orders by evidence level, newest first inside a level',()=>{
  const ordered=rankOrder([
   sig('slow_day',300),sig('missed_call_followup',100),sig('unanswered_lead',200),sig('lapsed_regular',400),
  ]);
  expect(ordered.map(s=>s.detector)).toEqual(['unanswered_lead','missed_call_followup','lapsed_regular','slow_day']);
 });
 it('does not mutate its input',()=>{
  const input=[sig('slow_day',1),sig('missed_call_followup',2)];
  rankOrder(input);
  expect(input[0].detector).toBe('slow_day');
 });
});

describe('planDrain — the hard cap',()=>{
 it('drains everything when the budget has room',()=>{
  const plan=planDrain([sig('slow_day',1),sig('missed_call_followup',2)],0);
  expect(plan.toRank).toHaveLength(2);
  expect(plan.deferred).toHaveLength(0);
  expect(plan.breach).toBe(false);
 });
 it('defers beyond the budget and flags the breach',()=>{
  const many=Array.from({length:RANK_DAILY_BUDGET+3},(_,i)=>sig('missed_call_followup',i,'d'+i));
  const plan=planDrain(many,0);
  expect(plan.toRank).toHaveLength(RANK_DAILY_BUDGET);
  expect(plan.deferred).toHaveLength(3);
  expect(plan.breach).toBe(true);
 });
 it('counts what was already ranked today against the budget',()=>{
  const plan=planDrain([sig('missed_call_followup',1),sig('missed_call_followup',2)],RANK_DAILY_BUDGET-1);
  expect(plan.toRank).toHaveLength(1);
  expect(plan.breach).toBe(true);
 });
 it('a spent budget defers everything, still a breach, never an error',()=>{
  const plan=planDrain([sig('slow_day',1)],RANK_DAILY_BUDGET);
  expect(plan.toRank).toHaveLength(0);
  expect(plan.deferred).toHaveLength(1);
  expect(plan.breach).toBe(true);
 });
 it('no work is never a breach',()=>{
  expect(planDrain([],RANK_DAILY_BUDGET).breach).toBe(false);
 });
});

/* The flag reader against a minimal prepared-statement fake. */
function fakeEnv(rows:Record<string,string>,throws=false){
 const prepare=(sql:string)=>({
  bind:(..._args:unknown[])=>({
   first:async()=>{
    if(throws)throw new Error('db down');
    const field=Object.keys(rows)[0];
    return field?{value_json:rows[field]}:null;
   },
  }),
 });
 return {AGENT_DB:{prepare}} as unknown as Env;
}

describe('readHarnessRuntime',()=>{
 it("defaults to 'cron' when no flag is stored",async()=>{
  expect(await readHarnessRuntime(fakeEnv({}),'t1')).toBe('cron');
 });
 it("reads 'do' only from an explicit stored flag",async()=>{
  expect(await readHarnessRuntime(fakeEnv({harness_runtime:JSON.stringify({runtime:'do'})}),'t1')).toBe('do');
  expect(await readHarnessRuntime(fakeEnv({harness_runtime:JSON.stringify({runtime:'cron'})}),'t1')).toBe('cron');
  expect(await readHarnessRuntime(fakeEnv({harness_runtime:'not json'}),'t1')).toBe('cron');
  expect(await readHarnessRuntime(fakeEnv({harness_runtime:JSON.stringify({runtime:'bogus'})}),'t1')).toBe('cron');
 });
 it("fails safe to 'cron' when the read throws",async()=>{
  expect(await readHarnessRuntime(fakeEnv({},true),'t1')).toBe('cron');
 });
});
