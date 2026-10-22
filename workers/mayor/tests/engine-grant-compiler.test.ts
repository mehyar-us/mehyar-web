/**
 * engine-grant-compiler.test.ts — §1.3.2 step 2 targeted cases (the
 * 200-sentence corpus lives in engine-grant-corpus.test.ts). The
 * compiler is conservative by law: unclear ⇒ ask; never-grantable ⇒
 * decline; a NEVER target it cannot pin ⇒ ask, never a guess.
 */
import {describe,expect,it} from 'vitest';
import {compileGrant,extractNeverFragments,guardsFromFragment} from '../src/engine/grant-compiler';

describe('compile — the happy path',()=>{
 it('compiles "reschedule anyone who asks" clean',()=>{
  const r=compileGrant('Reschedule anyone who asks');
  expect(r.disposition).toBe('ready');
  expect(r.actionClass).toBe('reschedule');
  expect(r.scope?.who).toBe('any_customer');
  expect(r.neverLines).toEqual([]);
 });
 it('compiles a NEVER line as a hard fragment, verbatim',()=>{
  const r=compileGrant('You can reschedule anyone who asks, but never Mr. Ortiz');
  expect(r.disposition).toBe('ready');
  expect(r.neverLines?.join(' ')).toContain('Ortiz');
 });
 it('compiles an amount condition',()=>{
  const r=compileGrant('Book anyone for jobs under $500');
  expect(r.disposition).toBe('ready');
  expect(r.conditions).toContainEqual(expect.objectContaining({kind:'amount_lte_cents',value:50000}));
 });
 it('"over $X, check with me" compiles as a ceiling, not a floor',()=>{
  const r=compileGrant('Book the job if it is small — anything over $200, check with me first');
  expect(r.conditions).toContainEqual(expect.objectContaining({kind:'amount_lte_cents',value:20000}));
 });
 it('compiles "anyone but X" as not_named + a never line',()=>{
  const r=compileGrant('Reschedule anyone but the Hendersons');
  expect(r.scope?.who).toBe('not_named');
  expect(r.neverLines?.join(' ').toLowerCase()).toContain('henderson');
 });
 it('compiles named-only scope',()=>{
  const r=compileGrant('Only Dana and Marcus can be rescheduled without asking me');
  expect(r.scope?.who).toBe('named');
  expect(r.scope?.whoNames).toEqual(expect.arrayContaining(['Dana','Marcus']));
 });
 it('unspecified who on a send class defaults to existing customers (narrower)',()=>{
  const r=compileGrant('Text people when their appointment changes');
  expect(r.actionClass).toBe('send_sms_reply');
  expect(r.scope?.who).toBe('existing_customers_only');
 });
 it('a send rider is parsed as a SEPARATE permission, never folded in',()=>{
  const r=compileGrant('Reschedule anyone who asks and text them the new time');
  expect(r.actionClass).toBe('reschedule');
  expect(r.riders).toContain('send_sms_reply');
 });
 it('an implied expiry compiles to expiresAt',()=>{
  const r=compileGrant('Book anyone who calls this week only');
  expect(r.impliesExpiry).toBe(true);
  expect(r.expiresAt).toBeTruthy();
 });
});

describe('compile — ask-don\'t-act',()=>{
 it('vague "anyone important" asks',()=>{
  const r=compileGrant('Reschedule anyone important right away');
  expect(r.disposition).toBe('ask');
  expect(r.asks.length).toBeGreaterThan(0);
 });
 it('sarcasm asks — a joke is never compiled literally',()=>{
  const r=compileGrant('Oh sure, just cancel everyone whenever, lol');
  expect(r.disposition).toBe('ask');
 });
 it('no act verb asks',()=>{
  const r=compileGrant('Handle things like a boss');
  expect(r.disposition).toBe('ask');
  expect(r.actionClass).toBeNull();
 });
 it('a NEVER line with an unpinnable target asks',()=>{
  const r=compileGrant('Reschedule anyone, but never the usual suspects');
  expect(r.disposition).toBe('ask');
 });
});

describe('compile — declines (§1.3.5)',()=>{
 for(const text of ["Refund anyone who's unhappy",'Charge their card if they no-show','Give regulars a discount without asking me','Delete old customer records every month']){
  it(`declines: ${text}`,()=>{
   const r=compileGrant(text);
   expect(r.disposition).toBe('decline');
   expect(r.decline).toBeTruthy();
  });
 }
});

describe('never fragments + guards',()=>{
 it('extracts buried exceptions mid-sentence',()=>{
  const frags=extractNeverFragments('You can move appointments around for anyone who asks, except Ortiz, whenever they call');
  expect(frags.join(' ').toLowerCase()).toContain('ortiz');
 });
 it('a day fragment becomes a day guard',()=>{
  const guards=guardsFromFragment('never on Saturdays');
  expect(guards).toContainEqual(expect.objectContaining({kind:'day',days:['Sat']}));
 });
 it('an after-hours fragment becomes an hour guard',()=>{
  const guards=guardsFromFragment('never text anyone after 9pm');
  expect(guards).toContainEqual(expect.objectContaining({kind:'hour_after',hour:21}));
 });
 it('a name fragment becomes a name guard',()=>{
  const guards=guardsFromFragment('never Mr. Ortiz');
  expect(guards).toContainEqual(expect.objectContaining({kind:'name',tokens:['ortiz']}));
 });
});
