/**
 * engine-prober.test.ts — §1.3.2 step 3: probe sets are generated
 * FROM THE PREDICATE EDGES — 5–7 scenarios, NEVER-line
 * counter-examples first-class, expectations computed by the same
 * gate that will judge real acts.
 */
import {describe,expect,it} from 'vitest';
import {generateScenarioDrafts} from '../src/engine/grant-prober';
import type {Grant} from '../src/engine/types';

function grant(partial:Partial<Grant>):Grant{
 return {
  id:'g1',tenantId:'t1',version:1,status:'probed',actionClass:'reschedule',
  scope:{who:'any_customer',what:'any_service',when:'any_time',channel:'any',limits:{maxMessagesPerPersonPerDay:1}},
  conditions:[],neverLines:[],sourceUtterance:'rule',plainSummary:'rule',origin:'owner_stated',
  capabilityState:'present',probeSetId:null,sessionScope:'standard',asks:[],createdAt:'2026-10-22T10:00:00.000Z',
  confirmedAt:null,expiresAt:null,supersedesId:null,...partial,
 };
}

describe('probe generation',()=>{
 it('generates 5–7 scenarios for a plain rule',()=>{
  const drafts=generateScenarioDrafts(grant({}),['Dana','Marcus']);
  expect(drafts.length).toBeGreaterThanOrEqual(5);
  expect(drafts.length).toBeLessThanOrEqual(7);
 });
 it('every NEVER line gets a counter-example scenario expected blocked',()=>{
  const drafts=generateScenarioDrafts(grant({neverLines:['never Mr. Ortiz']}),['Dana']);
  const ortiz=drafts.find(d=>d.description.includes('Ortiz'));
  expect(ortiz).toBeTruthy();
  expect(ortiz!.description).toContain('blocked');
 });
 it('an amount limit generates both edges: over (blocked) and near (allowed)',()=>{
  const drafts=generateScenarioDrafts(grant({conditions:[{kind:'amount_lte_cents',value:50000,label:'under $500'}]}),['Dana']);
  const over=drafts.find(d=>d.detail.amountCents===52000);
  const near=drafts.find(d=>d.detail.nearBoundary===true);
  expect(over?.description).toContain('blocked');
  expect(near?.description).toContain('allowed');
 });
 it('an existing-customers rule probes a first-timer as blocked',()=>{
  const drafts=generateScenarioDrafts(grant({scope:{who:'existing_customers_only',what:'any_service',when:'any_time',channel:'any',limits:{maxMessagesPerPersonPerDay:1}}}),['Dana']);
  expect(drafts.some(d=>d.detail.personKnown===false&&d.description.includes('blocked'))).toBe(true);
 });
 it('a session-one rule probes a real customer booking as blocked (test bookings only)',()=>{
  const drafts=generateScenarioDrafts(grant({sessionScope:'owner_test'}),['Dana']);
  expect(drafts.some(d=>d.detail.isOwnerTestBooking===false&&d.description.includes('blocked'))).toBe(true);
  expect(drafts.some(d=>d.detail.isOwnerTestBooking===true&&d.description.includes('allowed'))).toBe(true);
 });
 it('scenario descriptions are plain language with the compiled expectation stated',()=>{
  const drafts=generateScenarioDrafts(grant({}),['Dana']);
  for(const d of drafts)expect(d.description).toMatch(/your rule says: (allowed|blocked)/);
 });
});
