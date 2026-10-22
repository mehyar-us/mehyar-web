/**
 * engine-decide-cost.test.ts — Stage 5 threshold registry + band
 * math (§1.2) and the §8.6 cost fences. decide() unavailable ⇒ band
 * 'unavailable' ⇒ the loop falls back to prepare-and-ask; the
 * DecisionLog row is written either way, with a state HASH and
 * never state text.
 */
import {describe,expect,it} from 'vitest';
import {THRESHOLD_PROFILES,consultDecision,unavailableDecideProvider,type DecideProvider} from '../src/engine/decide';
import {fenceFor} from '../src/engine/cost';
import type {EngineState} from '../src/engine/store';

function fakeDb(){
 const rows:Array<Record<string,unknown>>=[];
 const db={
  prepare(sql:string){
   return {bind(...args:unknown[]){
    return {async run(){rows.push({sql,args});return {success:true,meta:{}};}};
   }};
  },
 } as unknown as D1Database;
 return {rows,db};
}
const fixedProvider=(confidences:Record<string,number>):DecideProvider=>({consult:async()=>({answers:{intent_class:'grant_statement'},confidences,model:'fake',costMicrocents:123})});

describe('threshold registry (§1.2)',()=>{
 it('carries the four named profiles with the blueprint bands',()=>{
  expect(THRESHOLD_PROFILES.mayor_intent).toEqual({auto:0.8,review:0.55});
  expect(THRESHOLD_PROFILES.mayor_urgency).toEqual({auto:0.8,review:0.55});
  expect(THRESHOLD_PROFILES.mayor_commitment_risk).toEqual({auto:0.85,review:0.6});
  expect(THRESHOLD_PROFILES.mayor_proactive_rank).toEqual({auto:0.75,review:0.5});
 });
});

describe('consultDecision',()=>{
 it('bands on the WEAKEST question confidence',async()=>{
  const {db}=fakeDb();
  const out=await consultDecision(db,{tenantId:'t1',runId:'r1',profile:'mayor_intent',state:{a:1},questions:[{id:'intent_class',kind:'classify',prompt:'?'}],provider:fixedProvider({intent_class:0.9})});
  expect(out.band).toBe('auto');
  const review=await consultDecision(db,{tenantId:'t1',runId:'r1',profile:'mayor_intent',state:{a:1},questions:[{id:'intent_class',kind:'classify',prompt:'?'}],provider:fixedProvider({intent_class:0.6})});
  expect(review.band).toBe('review');
  const hold=await consultDecision(db,{tenantId:'t1',runId:'r1',profile:'mayor_intent',state:{a:1},questions:[{id:'intent_class',kind:'classify',prompt:'?'}],provider:fixedProvider({intent_class:0.3})});
  expect(hold.band).toBe('hold');
 });
 it('an unavailable provider bands unavailable and still writes the log row',async()=>{
  const {db,rows}=fakeDb();
  const out=await consultDecision(db,{tenantId:'t1',runId:'r1',profile:'mayor_intent',state:{secret:'customer text'},questions:[{id:'intent_class',kind:'classify',prompt:'?'}],provider:unavailableDecideProvider});
  expect(out.band).toBe('unavailable');
  expect(rows).toHaveLength(1);
  const args=rows[0].args as unknown[];
  // state_hash is a sha-256 hex — the state TEXT never lands in the log.
  expect(args.some(a=>typeof a==='string'&&/^[a-f0-9]{64}$/.test(a))).toBe(true);
  expect(JSON.stringify(args)).not.toContain('customer text');
 });
 it('a throwing provider is an outage, not a crash',async()=>{
  const {db}=fakeDb();
  const out=await consultDecision(db,{tenantId:'t1',runId:'r1',profile:'mayor_intent',state:{},questions:[{id:'intent_class',kind:'classify',prompt:'?'}],provider:{consult:async()=>{throw new Error('down');}}});
  expect(out.band).toBe('unavailable');
 });
});

describe('cost fences (§1.1 / §8.6 default)',()=>{
 const state=(costMicrocents:number,ceiling=1000):EngineState=>({tenantId:'t1',mode:'talk',onboarding:{},costPeriod:'2026-10',costMicrocents,costCeilingMicrocents:ceiling,anonymous:false,claimedAt:null,createdAt:'2026-10-01T00:00:00.000Z'});
 it('under 70% nothing sheds',()=>{expect(fenceFor(state(500)).level).toBe(0);});
 it('at 70% the largest tier sheds',()=>{const f=fenceFor(state(700));expect(f.level).toBe(70);expect(f.shedLargestTier).toBe(true);expect(f.deterministicOnly).toBe(false);});
 it('at 90% proactive drafting drops to templates',()=>{const f=fenceFor(state(900));expect(f.level).toBe(90);expect(f.proactiveTemplatesOnly).toBe(true);});
 it('at 100% only deterministic acts + prepare-and-ask continue',()=>{const f=fenceFor(state(1000));expect(f.level).toBe(100);expect(f.deterministicOnly).toBe(true);});
});
