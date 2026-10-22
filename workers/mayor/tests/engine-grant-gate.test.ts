/**
 * engine-grant-gate.test.ts — Stage 4 (Slice 2, blueprint §1.1 /
 * §1.3.3): deterministic coverage. AMBIGUOUS = NOT COVERED; conflict
 * law: most specific → most restrictive → newest confirmed (older
 * auto-narrowed). Zero model calls live here by construction — these
 * are pure functions over grant objects.
 */
import {describe,expect,it} from 'vitest';
import {evaluateCoverage,evaluateGrant,proactiveAllowed} from '../src/engine/grant-gate';
import type {Grant} from '../src/engine/types';

let seq=0;
function grant(partial:Partial<Grant>):Grant{
 seq++;
 return {
  id:`g${seq}`,tenantId:'t1',version:1,status:'shadow',actionClass:'reschedule',
  scope:{who:'any_customer',what:'any_service',when:'any_time',channel:'any',limits:{maxMessagesPerPersonPerDay:1}},
  conditions:[],neverLines:[],sourceUtterance:'rule',plainSummary:'rule',origin:'owner_stated',
  capabilityState:'present',probeSetId:null,sessionScope:'standard',asks:[],createdAt:'2026-10-22T10:00:00.000Z',
  confirmedAt:'2026-10-22T10:00:00.000Z',expiresAt:null,supersedesId:null,...partial,
 };
}
const act=(facts:Record<string,unknown>,channel='sms')=>({actionClass:'reschedule' as const,facts,channel});

describe('coverage',()=>{
 it('covers an in-scope act and names the predicate',()=>{
  const g=grant({conditions:[{kind:'amount_lte_cents',value:50000,label:'under $500'}]});
  const v=evaluateGrant(g,act({personName:'Dana',amountCents:38000}));
  expect(v.verdict).toBe('covers');
  expect(v.predicate).toContain('$380 < $500');
 });
 it('a NEVER line excludes even when scope would cover',()=>{
  const g=grant({neverLines:['never Mr. Ortiz']});
  expect(evaluateGrant(g,act({personName:'Ortiz'})).verdict).toBe('excludes');
  expect(evaluateGrant(g,act({personName:'Dana'})).verdict).toBe('covers');
 });
 it('a day never-line excludes that day via its compiled condition',()=>{
  const g=grant({conditions:[{kind:'day_not_in',value:'Sat',label:'never on Sat'}]});
  expect(evaluateGrant(g,act({personName:'Dana',dayOfWeek:'Sat'})).verdict).toBe('excludes');
  expect(evaluateGrant(g,act({personName:'Dana',dayOfWeek:'Tue'})).verdict).toBe('covers');
 });
 it('existing-only scope with an unknown person is AMBIGUOUS, never covered',()=>{
  const g=grant({scope:{who:'existing_customers_only',what:'any_service',when:'any_time',channel:'any',limits:{maxMessagesPerPersonPerDay:1}}});
  const v=evaluateGrant(g,act({personName:'Marcus'}));
  expect(v.verdict).toBe('ambiguous');
  expect(v.reason).toContain("isn't in your customer list yet");
 });
 it('an amount limit with no amount to check is ambiguous',()=>{
  const g=grant({conditions:[{kind:'amount_lte_cents',value:50000,label:'under $500'}]});
  expect(evaluateGrant(g,act({personName:'Dana'})).verdict).toBe('ambiguous');
 });
 it('session-one scope excludes real customer bookings',()=>{
  const g=grant({sessionScope:'owner_test'});
  expect(evaluateGrant(g,act({personName:'Dana',personKnown:true})).verdict).toBe('excludes');
  expect(evaluateGrant(g,act({personName:'Dana',isOwnerTestBooking:true})).verdict).toBe('covers');
 });
 it('a dormant grant (dead connector) cannot fire',()=>{
  const g=grant({capabilityState:'revoked'});
  expect(evaluateGrant(g,act({personName:'Dana'})).verdict).toBe('dormant');
  expect(evaluateCoverage([g],act({personName:'Dana'})).outcome).toBe('not_covered');
 });
 it('near-boundary acts are flagged even when covered',()=>{
  const g=grant({conditions:[{kind:'amount_lte_cents',value:50000,label:'under $500'}]});
  const v=evaluateGrant(g,act({personName:'Dana',amountCents:48000}));
  expect(v.verdict).toBe('covers');
  expect(v.nearBoundary).toBe(true);
 });
});

describe('conflict law (§1.3.3)',()=>{
 it('most specific wins: a named grant beats an any-customer block',()=>{
  const named=grant({scope:{who:'named',whoNames:['Dana'],what:'any_service',when:'any_time',channel:'any',limits:{maxMessagesPerPersonPerDay:1}}});
  const blocker=grant({neverLines:['never Dana'],createdAt:'2026-10-20T10:00:00.000Z',confirmedAt:'2026-10-20T10:00:00.000Z'});
  const r=evaluateCoverage([blocker,named],act({personName:'Dana'}));
  expect(r.outcome).toBe('covered');
  expect(r.grant?.id).toBe(named.id);
 });
 it('tied specificity: the restrictive grant wins',()=>{
  const cover=grant({});
  const blocker=grant({neverLines:['never Dana']});
  const r=evaluateCoverage([cover,blocker],act({personName:'Dana'}));
  expect(r.outcome).toBe('not_covered');
 });
 it('tied and the covering grant is newest: it wins and the older is named for narrowing',()=>{
  const cover=grant({createdAt:'2026-10-22T10:00:00.000Z',confirmedAt:'2026-10-22T10:00:00.000Z'});
  const blocker=grant({neverLines:['never Dana'],createdAt:'2026-10-20T10:00:00.000Z',confirmedAt:'2026-10-20T10:00:00.000Z'});
  const r=evaluateCoverage([cover,blocker],act({personName:'Dana'}));
  expect(r.outcome).toBe('covered');
  expect(r.narrowedGrantId).toBe(blocker.id);
  expect(r.conflictNote).toContain('narrowed');
 });
 it('no grants at all is not_covered, never ambiguous silence',()=>{
  expect(evaluateCoverage([],act({personName:'Dana'})).outcome).toBe('not_covered');
 });
});

describe('proactive law (Stage 4 rule 2)',()=>{
 it('quiet hours block proactive surfacing',()=>{
  expect(proactiveAllowed({hourLocal:22,nudgesToday:0}).allowed).toBe(false);
  expect(proactiveAllowed({hourLocal:7,nudgesToday:0}).allowed).toBe(false);
  expect(proactiveAllowed({hourLocal:10,nudgesToday:0}).allowed).toBe(true);
 });
 it('the ration is three a day',()=>{
  expect(proactiveAllowed({hourLocal:10,nudgesToday:3}).allowed).toBe(false);
  expect(proactiveAllowed({hourLocal:10,nudgesToday:2}).allowed).toBe(true);
 });
});
