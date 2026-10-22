/**
 * engine/grant-prober.ts — §1.3.2 step 3: PROBED. Before a rule can
 * touch anything real, the engine generates 5–7 boundary scenarios
 * FROM THE ACTUAL PREDICATE EDGES — worked examples and
 * counter-examples in plain language. The owner rules on each. A
 * scenario the owner flips RE-COMPILES the rule, and the recompile
 * produces a human-readable predicate diff. This replaces
 * compile-once activation, which the adversarial pass killed: a
 * summary generated from the compiled meaning is the compiler
 * checking itself — no check at all.
 */
import type {Grant,ProbeScenario,ScenarioFacts} from './types';
import {evaluateGrant} from './grant-gate';
import {guardsFromFragment} from './grant-compiler';
import {getGrant,getProbeSetGrantId,insertProbeSet,listScenarios,ruleScenario,saveGrantVersion,updateScenarioExpectation} from './store';

type DB = D1Database;

const VERBS: Record<string, string> = {
 schedule_new: 'Book', reschedule: 'Move', cancel_booking: 'Cancel', send_sms_reply: 'Text',
 send_email_reply: 'Email', answer_call: 'Answer a call from', offer_alternate_slot: 'Offer another time to',
 send_reminder: 'Send a reminder to', send_followup: 'Follow up with', winback_message: 'Send a win-back to',
 request_review: 'Ask for a review from', update_record: 'Update the record for', create_task: 'Make a task about',
};
const DAY_NAMES: Record<string, string> = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };

export interface ScenarioDraft { description: string; detail: ScenarioFacts & { nearBoundary?: boolean }; }

function describe(grant: Grant, facts: ScenarioFacts & { nearBoundary?: boolean }, channel: string): string {
 const verb = VERBS[grant.actionClass] ?? 'Act for';
 const who = facts.isOwnerTestBooking ? 'you (your own test booking)' : (facts.personName ?? 'someone');
 const bits: string[] = [];
 if (facts.personKnown === true && !facts.isOwnerTestBooking) bits.push('a regular');
 if (facts.personKnown === false) bits.push('first visit');
 if (facts.dayOfWeek) bits.push(DAY_NAMES[facts.dayOfWeek] ?? facts.dayOfWeek);
 if (facts.hourLocal !== undefined) bits.push(facts.hourLocal === 12 ? '12pm' : facts.hourLocal > 12 ? `${facts.hourLocal - 12}pm` : `${facts.hourLocal}am`);
 if (facts.amountCents !== undefined) bits.push(`a $${(facts.amountCents / 100).toFixed(0)} job`);
 if (channel !== 'any' && channel !== grant.scope.channel) bits.push(`by ${channel}`);
 if (facts.callerVisits !== undefined) bits.push(`${facts.callerVisits} visits`);
 return `${verb} ${who}${bits.length ? ` (${bits.join(', ')})` : ''}`;
}

function expectedOf(grant: Grant, facts: ScenarioFacts, channel: string): 'allowed' | 'blocked' {
 const v = evaluateGrant(grant, { actionClass: grant.actionClass, facts, channel });
 return v.verdict === 'covers' ? 'allowed' : 'blocked';
}

/** Generate the probe set from the grant's predicate edges. */
export function generateScenarioDrafts(grant: Grant, knownPeople: string[]): ScenarioDraft[] {
 const regular = knownPeople[0] ?? 'Dana';
 const other = knownPeople[1] ?? 'Marcus';
 const amountCond = grant.conditions.find(c => c.kind === 'amount_lte_cents');
 const visitsCond = grant.conditions.find(c => c.kind === 'caller_visits_gte');
 const baseAmount = amountCond ? Math.floor((amountCond.value as number) * 0.6) : 6000;
 const base: ScenarioFacts = {
  personName: regular, personKnown: true, dayOfWeek: 'Tue', hourLocal: 11,
  amountCents: baseAmount, callerVisits: visitsCond ? (visitsCond.value as number) + 2 : 3,
  ...(grant.sessionScope === 'owner_test' ? { isOwnerTestBooking: true, personName: undefined } : {}),
 };
 const drafts: ScenarioDraft[] = [];
 const push = (facts: ScenarioFacts & { nearBoundary?: boolean }, channel = grant.scope.channel === 'any' ? 'sms' : grant.scope.channel) => {
  drafts.push({ description: describe(grant, facts, channel), detail: facts });
 };

 // The worked example: everything in bounds.
 push({ ...base });
 // NEVER-line counter-examples come first-class, one per guard.
 for (const fragment of grant.neverLines) {
  for (const guard of guardsFromFragment(fragment)) {
   if (guard.kind === 'name') push({ ...base, personName: guard.tokens.map(t => t[0].toUpperCase() + t.slice(1)).join(' '), personKnown: true });
   if (guard.kind === 'day') push({ ...base, dayOfWeek: guard.days[0] });
   if (guard.kind === 'hour_after') push({ ...base, hourLocal: Math.min(23, guard.hour + 1) });
   if (guard.kind === 'channel') push({ ...base }, guard.channel);
  }
 }
 // Who edges.
 if (grant.scope.who === 'existing_customers_only') push({ ...base, personName: 'A first-time caller', personKnown: false });
 if (grant.scope.who === 'named') push({ ...base, personName: other, personKnown: true });
 if (grant.sessionScope === 'owner_test') push({ ...base, isOwnerTestBooking: false, personName: regular, personKnown: true });
 // Amount edges: just over (blocked) and near the line (allowed, escalates forever).
 if (amountCond) {
  push({ ...base, amountCents: (amountCond.value as number) + 2000 });
  push({ ...base, amountCents: Math.floor((amountCond.value as number) * 0.95), nearBoundary: true });
 }
 if (visitsCond) push({ ...base, callerVisits: Math.max(0, (visitsCond.value as number) - 1) });
 // Pad to the 5–7 window with in-bounds variations.
 const pads: ScenarioFacts[] = [
  { ...base, dayOfWeek: 'Thu', hourLocal: 14 },
  { ...base, personName: other, dayOfWeek: 'Wed', hourLocal: 10 },
  { ...base, dayOfWeek: 'Fri', hourLocal: 16 },
  { ...base, personName: other, dayOfWeek: 'Tue', hourLocal: 11 },
  { ...base, dayOfWeek: 'Mon', hourLocal: 9 },
  { ...base, personName: other, dayOfWeek: 'Sat', hourLocal: 12 },
 ];
 for (const pad of pads) { if (drafts.length >= 5) break; push(pad); }
 return drafts.slice(0, 7).map(d => ({ ...d, description: `${d.description} → your rule says: ${expectedOf(grant, d.detail, grant.scope.channel === 'any' ? 'sms' : grant.scope.channel) === 'allowed' ? 'allowed' : 'blocked'}` }));
}

export async function createProbeSet(db: DB, grant: Grant, knownPeople: string[]): Promise<{ probeSetId: string; scenarios: ProbeScenario[] }> {
 const drafts = generateScenarioDrafts(grant, knownPeople);
 return insertProbeSet(db, grant.tenantId, grant.id, drafts.map(d => ({
  description: d.description, detail: d.detail as unknown as Record<string, unknown>,
  expectedOutcome: expectedOf(grant, d.detail, grant.scope.channel === 'any' ? 'sms' : grant.scope.channel),
 })));
}

/** Apply the owner's ruling. A flip re-compiles the rule and returns
 * the predicate diff; when the whole set is ruled, the grant enters
 * SHADOW (the slice's terminal state) with confirmedAt set. */
export async function applyScenarioRuling(db: DB, tenantId: string, scenario: ProbeScenario, ruling: 'allowed' | 'blocked'): Promise<{ grant: Grant; flipped: boolean; diff: string[]; advancedToShadow: boolean }> {
 const grantId = await getProbeSetGrantId(db, tenantId, scenario.probeSetId);
 let grant = grantId ? await getGrant(db, tenantId, grantId) : null;
 if (!grant) throw new Error('grant_not_found');
 const flipped = ruling !== scenario.expectedOutcome;
 await ruleScenario(db, tenantId, scenario.id, ruling, flipped);
 const diff: string[] = [];
 if (flipped) {
  grant = recompileAfterFlip(grant, scenario, ruling, diff);
  grant = await saveGrantVersion(db, grant);
  // Unruled scenarios are re-scored against the new predicates.
  const all = await listScenarios(db, tenantId, scenario.probeSetId);
  for (const s of all) {
   if (s.ownerRuling === null && s.id !== scenario.id) {
    const next = expectedOf(grant, s.detail, grant.scope.channel === 'any' ? 'sms' : grant.scope.channel);
    if (next !== s.expectedOutcome) await updateScenarioExpectation(db, tenantId, s.id, next);
   }
  }
 }
 const all = await listScenarios(db, tenantId, scenario.probeSetId);
 const done = all.length > 0 && all.every(s => s.ownerRuling !== null);
 let advancedToShadow = false;
 if (done && grant.status === 'probed') {
  grant = await saveGrantVersion(db, { ...grant, status: 'shadow', confirmedAt: new Date().toISOString() });
  advancedToShadow = true;
 }
 return { grant, flipped, diff, advancedToShadow };
}

function recompileAfterFlip(grant: Grant, scenario: ProbeScenario, ruling: 'allowed' | 'blocked', diff: string[]): Grant {
 const facts = scenario.detail;
 const next: Grant = { ...grant, conditions: [...grant.conditions], neverLines: [...grant.neverLines], scope: { ...grant.scope } };
 if (ruling === 'allowed') {
  // Something blocked it; the owner's ruling removes that block for
  // this edge — an explicit owner statement for exactly this case.
  if (facts.personName && next.neverLines.some(fr => guardsFromFragment(fr).some(g => g.kind === 'name' && g.tokens.some(tok => facts.personName!.toLowerCase().includes(tok))))) {
   const removed = next.neverLines.filter(fr => guardsFromFragment(fr).some(g => g.kind === 'name' && g.tokens.some(tok => facts.personName!.toLowerCase().includes(tok))));
   next.neverLines = next.neverLines.filter(fr => !removed.includes(fr));
   for (const r of removed) diff.push(`Removed your never line "${r}" — you ruled this case allowed.`);
  }
  const amountIdx = next.conditions.findIndex(c => c.kind === 'amount_lte_cents');
  if (amountIdx >= 0 && facts.amountCents !== undefined && facts.amountCents > (next.conditions[amountIdx].value as number)) {
   const old = next.conditions[amountIdx].value as number;
   next.conditions[amountIdx] = { ...next.conditions[amountIdx], value: facts.amountCents, label: `under $${(facts.amountCents / 100).toFixed(0)}` };
   diff.push(`Amount limit raised from $${(old / 100).toFixed(0)} to $${(facts.amountCents / 100).toFixed(0)} — you ruled the bigger job allowed.`);
  }
  if (next.scope.who === 'existing_customers_only' && facts.personKnown === false) {
   next.scope = { ...next.scope, who: 'any_customer' };
   diff.push('Scope widened from existing customers to any customer — you ruled a first-timer allowed.');
  }
  if (next.scope.who === 'named' && facts.personName && !(next.scope.whoNames ?? []).includes(facts.personName)) {
   next.scope = { ...next.scope, whoNames: [...(next.scope.whoNames ?? []), facts.personName] };
   diff.push(`${facts.personName} added to the names this rule covers — you ruled them allowed.`);
  }
  const dayIdx = next.conditions.findIndex(c => c.kind === 'day_not_in' && c.value === facts.dayOfWeek);
  if (dayIdx >= 0 && facts.dayOfWeek) {
   next.conditions.splice(dayIdx, 1);
   diff.push(`${facts.dayOfWeek} is no longer blocked — you ruled that day allowed.`);
  }
  if (!diff.length) diff.push('Noted — this case is allowed under your rule from now on.');
 } else {
  // The owner blocked an allowed case: add the tightest protection
  // that names this edge.
  if (facts.personName && facts.isOwnerTestBooking !== true) {
   next.neverLines.push(`never ${facts.personName}`);
   diff.push(`Added a never line: "never ${facts.personName}".`);
  } else if (facts.dayOfWeek && !next.conditions.some(c => c.kind === 'day_not_in' && c.value === facts.dayOfWeek)) {
   next.conditions.push({ kind: 'day_not_in', value: facts.dayOfWeek, label: `never on ${facts.dayOfWeek}` });
   diff.push(`Added: never on ${facts.dayOfWeek}.`);
  } else if (facts.amountCents !== undefined) {
   const limit = facts.amountCents - 1;
   const amountIdx = next.conditions.findIndex(c => c.kind === 'amount_lte_cents');
   if (amountIdx >= 0) next.conditions[amountIdx] = { ...next.conditions[amountIdx], value: limit, label: `under $${(limit / 100).toFixed(0)}` };
   else next.conditions.push({ kind: 'amount_lte_cents', value: limit, label: `under $${(limit / 100).toFixed(0)}` });
   diff.push(`Amount limit set to under $${(limit / 100).toFixed(0)} — you blocked the $${(facts.amountCents / 100).toFixed(0)} case.`);
  } else if (facts.hourLocal !== undefined) {
   next.conditions.push({ kind: 'hour_before', value: facts.hourLocal, label: `never at ${facts.hourLocal}:00 or later` });
   diff.push(`Added a time line at ${facts.hourLocal}:00.`);
  }
  if (!diff.length) diff.push('Noted — this case is blocked under your rule from now on.');
 }
 return next;
}
