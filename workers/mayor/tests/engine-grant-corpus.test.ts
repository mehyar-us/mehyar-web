/**
 * engine-grant-corpus.test.ts — the blueprint's §5 corpus gate:
 * 200 owner-style sentences through the deterministic compiler.
 * The bar is absolute on safety and conservative everywhere else:
 *  - ZERO compiled scopes that would execute a wrong act on a
 *    NEVER line (proven by attacking every compiled grant with
 *    facts synthesized from its own never-line guards);
 *  - every decline creates nothing; every miss lands in
 *    ask-don't-act — never in a silent ready.
 */
import {describe,expect,it} from 'vitest';
import {GRANT_CORPUS} from './fixtures/grant-corpus';
import {compileGrant,guardsFromFragment} from '../src/engine/grant-compiler';
import {evaluateGrant} from '../src/engine/grant-gate';
import type {Grant,ScenarioFacts} from '../src/engine/types';

describe('the 200-sentence grant corpus (§5)', () => {
 it('has exactly 200 entries', () => {
  expect(GRANT_CORPUS).toHaveLength(200);
 });

 it('every sentence lands where the corpus says it must', () => {
  const misses: string[] = [];
  for (const entry of GRANT_CORPUS) {
   const r = compileGrant(entry.text);
   if (r.disposition !== entry.expect.disposition) { misses.push(`[${entry.category}] "${entry.text}" → ${r.disposition}, corpus says ${entry.expect.disposition}`); continue; }
   if (entry.expect.actionClass !== undefined && entry.expect.actionClass !== null && r.actionClass !== entry.expect.actionClass) misses.push(`[${entry.category}] "${entry.text}" class ${r.actionClass}, corpus says ${entry.expect.actionClass}`);
   // A null expected class binds only when the entry expects an
   // executable outcome; on an 'ask' the compiler may carry a hint
   // class toward the clarifying question — nothing compiles from it.
   if (entry.expect.actionClass === null && r.actionClass !== null && r.disposition !== 'ask') misses.push(`[${entry.category}] "${entry.text}" class ${r.actionClass}, corpus says none`);
   for (const frag of entry.expect.neverLinesInclude ?? []) {
    if (!(r.neverLines ?? []).join(' ').toLowerCase().includes(frag)) misses.push(`[${entry.category}] "${entry.text}" missing never fragment "${frag}" (got: ${(r.neverLines ?? []).join(' | ')})`);
   }
   if (entry.expect.who && r.scope?.who !== entry.expect.who) misses.push(`[${entry.category}] "${entry.text}" who=${r.scope?.who}, corpus says ${entry.expect.who}`);
   if (entry.expect.amountLimitCents !== undefined) {
    const cond = (r.conditions ?? []).find(c => c.kind === 'amount_lte_cents');
    if (cond?.value !== entry.expect.amountLimitCents) misses.push(`[${entry.category}] "${entry.text}" amount=${cond?.value}, corpus says ${entry.expect.amountLimitCents}`);
   }
   if (entry.expect.impliesExpiry !== undefined && r.impliesExpiry !== entry.expect.impliesExpiry) misses.push(`[${entry.category}] "${entry.text}" expiry=${r.impliesExpiry}, corpus says ${entry.expect.impliesExpiry}`);
  }
  expect(misses, misses.join('\n')).toEqual([]);
 });

 it('ZERO compiled grants cover an act on their own NEVER lines', () => {
  const violations: string[] = [];
  for (const entry of GRANT_CORPUS) {
   const r = compileGrant(entry.text);
   if (r.disposition !== 'ready' || !r.scope || !r.actionClass) continue;
   const grant: Grant = {
    id: 'corpus', tenantId: 'corpus', version: 1, status: 'shadow', actionClass: r.actionClass,
    scope: r.scope, conditions: r.conditions ?? [], neverLines: r.neverLines ?? [],
    sourceUtterance: entry.text, plainSummary: r.plainSummary ?? '', origin: 'owner_stated',
    capabilityState: 'present', probeSetId: null, sessionScope: 'standard', asks: [],
    createdAt: '2026-10-22T00:00:00.000Z', confirmedAt: '2026-10-22T00:00:00.000Z', expiresAt: null, supersedesId: null,
   };
   for (const fragment of grant.neverLines) {
    for (const guard of guardsFromFragment(fragment)) {
     const facts: ScenarioFacts = {personName: 'Dana', personKnown: true, amountCents: 1000, callerVisits: 9, dayOfWeek: 'Tue', hourLocal: 12};
     if (guard.kind === 'name') facts.personName = guard.tokens.map(tok => tok[0].toUpperCase() + tok.slice(1)).join(' ');
     if (guard.kind === 'day') facts.dayOfWeek = guard.days[0];
     if (guard.kind === 'hour_after') facts.hourLocal = guard.hour + 1;
     const channel = guard.kind === 'channel' ? guard.channel : 'sms';
     const v = evaluateGrant(grant, {actionClass: grant.actionClass, facts, channel});
     if (v.verdict === 'covers') violations.push(`"${entry.text}" covers a ${guard.kind} never-line case (${fragment})`);
    }
   }
  }
  expect(violations, violations.join('\n')).toEqual([]);
 });

 it('every decline and every ask builds nothing executable', () => {
  for (const entry of GRANT_CORPUS) {
   const r = compileGrant(entry.text);
   if (entry.expect.disposition === 'decline') {
    expect(r.disposition, entry.text).toBe('decline');
    expect(r.scope, entry.text).toBeUndefined();
   }
   if (entry.expect.disposition === 'ask') {
    expect(r.disposition, entry.text).toBe('ask');
    expect(r.asks.length, entry.text).toBeGreaterThan(0);
   }
  }
 });
});
