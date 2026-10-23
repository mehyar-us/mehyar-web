/**
 * engine/grant-gate.ts — Stage 4 (blueprint §1.1/§1.3.3): the Rules
 * & Grant Gate. Deterministic, ZERO model calls. A rule that gives
 * the same answer every time is never a model call.
 *
 * Coverage outcomes: covers / excludes / ambiguous / dormant.
 * AMBIGUOUS = NOT COVERED — predicates that don't clearly include or
 * exclude, or that reference data we don't have, resolve to an ask
 * that names the ambiguity in one sentence.
 */
import type {ActionClass,Grant,ScenarioFacts} from './types';
import {isNeverLiveActionClass} from './types';
import {guardsFromFragment} from './grant-compiler';

export interface ActRequest {
 actionClass: ActionClass;
 facts: ScenarioFacts;
 channel: string; // sms | email | phone | any
}

export interface GrantVerdict {
 grant: Grant;
 verdict: 'covers' | 'excludes' | 'ambiguous' | 'dormant';
 predicate: string | null;
 reason: string | null;
 nearBoundary: boolean;
}

const nameMatches = (name: string, token: string): boolean => {
 const n = name.toLowerCase().replace(/^(mr|mrs|ms|dr)\.?\s+/, '').trim();
 const t = token.toLowerCase().replace(/s$/, '');
 return n === t || n.split(/\s+/).some(part => part.replace(/s$/, '') === t) || n.includes(t);
};

const specificity = (g: Grant): number =>
 g.scope.who === 'named' ? 3 : g.scope.who === 'not_named' ? 2 : g.scope.who === 'existing_customers_only' ? 1 : 0;

export function evaluateGrant(grant: Grant, act: ActRequest): GrantVerdict {
 const done = (verdict: GrantVerdict['verdict'], predicate: string | null, reason: string | null, nearBoundary = false): GrantVerdict =>
  ({ grant, verdict, predicate, reason, nearBoundary });
 if (isNeverLiveActionClass(grant.actionClass) || isNeverLiveActionClass(act.actionClass)) return done('excludes', null, 'invoice sends are approval-first forever — no rule covers them');
 if (grant.actionClass !== act.actionClass) return done('excludes', null, 'different act');
 if (grant.capabilityState !== 'present') return done('dormant', null, 'its connector is not live, so the rule is dormant');
 const f = act.facts;

 // NEVER lines first — they are hard lines, checked before scope.
 for (const fragment of grant.neverLines) {
  for (const guard of guardsFromFragment(fragment)) {
   if (guard.kind === 'name' && f.personName && guard.tokens.some(tok => nameMatches(f.personName!, tok))) {
    return done('excludes', fragment, `you said: ${fragment}`);
   }
   if (guard.kind === 'channel' && act.channel === guard.channel) {
    return done('excludes', fragment, `you said: ${fragment}`);
   }
  }
 }
 for (const c of grant.conditions) {
  if (c.kind === 'day_not_in') {
   if (!f.dayOfWeek) return done('ambiguous', null, 'I don\'t know which day this lands on, so I can\'t check it against your rule.');
   if (f.dayOfWeek === c.value) return done('excludes', c.label, `your rule says ${c.label}`);
  }
  if (c.kind === 'hour_after') {
   if (f.hourLocal === undefined) return done('ambiguous', null, 'I don\'t know the time this would happen, so I can\'t check it against your rule.');
   if (f.hourLocal >= (c.value as number)) return done('excludes', c.label, `your rule says ${c.label}`);
  }
  if (c.kind === 'hour_before') {
   if (f.hourLocal === undefined) return done('ambiguous', null, 'I don\'t know the time this would happen, so I can\'t check it against your rule.');
   if (f.hourLocal < (c.value as number)) return done('excludes', c.label, `your rule says ${c.label}`);
  }
 }

 // Session-one scope: the owner's own test bookings only (§1.3.2).
 if (grant.sessionScope === 'owner_test' && f.isOwnerTestBooking !== true) {
  return done('excludes', null, 'this rule is still in its first-session scope — it covers only your own test bookings');
 }

 // Who.
 if (grant.scope.who === 'existing_customers_only') {
  if (f.personKnown === undefined) return done('ambiguous', null, `${f.personName ?? 'This person'} isn't in your customer list yet — cover them anyway?`);
  if (f.personKnown === false) return done('excludes', null, 'your rule covers existing customers only');
 }
 if (grant.scope.who === 'named') {
  if (!f.personName) return done('ambiguous', null, 'I don\'t know who this act is for, and your rule names specific people.');
  if (!(grant.scope.whoNames ?? []).some(n => nameMatches(f.personName!, n))) return done('excludes', null, `your rule names only ${(grant.scope.whoNames ?? []).join(' and ')}`);
 }
 if (grant.scope.who === 'not_named') {
  if (!f.personName) return done('ambiguous', null, 'I don\'t know who this act is for, and your rule excludes specific people.');
  if ((grant.scope.whoNames ?? []).some(n => nameMatches(f.personName!, n))) return done('excludes', null, `you said never ${f.personName}`);
 }

 // What.
 if (Array.isArray(grant.scope.what)) {
  if (!f.serviceId) return done('ambiguous', null, 'I don\'t know which service this is, and your rule covers specific services.');
  if (!grant.scope.what.includes(f.serviceId)) return done('excludes', null, 'your rule covers other services');
 }

 // When.
 if (grant.scope.when === 'business_hours') {
  if (f.hourLocal === undefined) return done('ambiguous', null, 'I don\'t know the time, and your rule runs in business hours.');
  if (f.hourLocal < 9 || f.hourLocal >= 18) return done('excludes', null, 'outside business hours');
 }

 // Channel scope.
 if (grant.scope.channel !== 'any' && act.channel !== 'any' && grant.scope.channel !== act.channel) {
  return done('excludes', null, `your rule is for ${grant.scope.channel}, not ${act.channel}`);
 }

 // Conditions — the positive predicates that must hold.
 const fired: string[] = [];
 let nearBoundary = false;
 for (const c of grant.conditions) {
  if (c.kind === 'amount_lte_cents') {
   if (f.amountCents === undefined) return done('ambiguous', null, 'I don\'t have the amount, and your rule has a limit I must check.');
   if (f.amountCents > (c.value as number)) return done('excludes', c.label, `the amount is over your rule's limit (${c.label})`);
   if (f.amountCents >= (c.value as number) * 0.9) nearBoundary = true;
   fired.push(`$${(f.amountCents / 100).toFixed(0)} < $${((c.value as number) / 100).toFixed(0)}`);
  }
  if (c.kind === 'amount_gt_cents') {
   if (f.amountCents === undefined) return done('ambiguous', null, 'I don\'t have the amount, and your rule has a threshold I must check.');
   if (f.amountCents <= (c.value as number)) return done('excludes', c.label, 'under your rule\'s threshold');
   fired.push(`$${(f.amountCents / 100).toFixed(0)} over $${((c.value as number) / 100).toFixed(0)}`);
  }
  if (c.kind === 'caller_visits_gte') {
   if (f.callerVisits === undefined) return done('ambiguous', null, 'I don\'t know this caller\'s visit count, and your rule depends on it.');
   if (f.callerVisits < (c.value as number)) return done('excludes', c.label, 'not enough visits for your rule');
   if (f.callerVisits === (c.value as number)) nearBoundary = true;
   fired.push(`caller has ${f.callerVisits} visits`);
  }
 }
 if (grant.scope.who === 'named' && f.personName) fired.push(`${f.personName} is on your list`);
 if (grant.scope.who === 'existing_customers_only' && f.personName) fired.push(`${f.personName} is an existing customer`);
 if (grant.scope.who === 'any_customer') fired.push(`${f.personName ?? 'this customer'} is in scope — the rule covers any customer`);
 if (grant.scope.who === 'not_named') fired.push(`${f.personName ?? 'this customer'} is in scope — not one of your never names`);
 return done('covers', fired.join(' · '), null, nearBoundary);
}

export interface CoverageResult {
 outcome: 'covered' | 'not_covered' | 'ambiguous';
 grant?: Grant;
 predicate?: string;
 nearBoundary?: boolean;
 /** The one-sentence ambiguity/conflict explanation for the ask. */
 ask?: string;
 /** A grant the resolution auto-narrowed (conflict law §1.3.3). */
 narrowedGrantId?: string;
 conflictNote?: string;
}

/** Aggregate coverage across the book. Conflict law: most specific
 * wins → most restrictive wins → newest confirmed wins, and the older
 * grant is auto-narrowed with a note. Unresolvable ⇒ ambiguous. */
export function evaluateCoverage(grants: Grant[], act: ActRequest): CoverageResult {
 /* NEVER_LIVE fence (spec §3.3): the gate NEVER finds coverage for a
  * CashText send class — even if a grant row for one somehow existed,
  * it is ineligible here, so every send falls to prepare-and-ask. */
 if (isNeverLiveActionClass(act.actionClass)) return { outcome: 'not_covered' };
 const eligible = grants.filter(g => (g.status === 'shadow' || g.status === 'live' || g.status === 'narrowed') && g.actionClass === act.actionClass && !isNeverLiveActionClass(g.actionClass));
 const verdicts = eligible.map(g => evaluateGrant(g, act)).filter(v => v.verdict !== 'dormant');
 const covers = verdicts.filter(v => v.verdict === 'covers');
 const excludes = verdicts.filter(v => v.verdict === 'excludes');
 const ambiguous = verdicts.filter(v => v.verdict === 'ambiguous');

 if (covers.length && !excludes.length) {
  const best = covers.sort((a, b) => specificity(b.grant) - specificity(a.grant) || (b.grant.confirmedAt ?? '').localeCompare(a.grant.confirmedAt ?? ''))[0];
  return { outcome: 'covered', grant: best.grant, predicate: best.predicate ?? undefined, nearBoundary: best.nearBoundary };
 }
 if (covers.length && excludes.length) {
  const topCover = Math.max(...covers.map(v => specificity(v.grant)));
  const topExclude = Math.max(...excludes.map(v => specificity(v.grant)));
  if (topCover > topExclude) {
   const best = covers.filter(v => specificity(v.grant) === topCover)[0];
   return { outcome: 'covered', grant: best.grant, predicate: best.predicate ?? undefined, nearBoundary: best.nearBoundary };
  }
  if (topExclude > topCover) return { outcome: 'not_covered', ask: excludes[0].reason ?? 'One of your rules blocks this.' };
  // Tied specificity: most restrictive wins — unless the covering
  // grant is the newest confirmed, in which case it wins and the
  // older excluder is auto-narrowed (§1.3.3).
  const newestCover = covers.sort((a, b) => (b.grant.confirmedAt ?? b.grant.createdAt).localeCompare(a.grant.confirmedAt ?? a.grant.createdAt))[0];
  const newestExclude = excludes.sort((a, b) => (b.grant.confirmedAt ?? b.grant.createdAt).localeCompare(a.grant.confirmedAt ?? a.grant.createdAt))[0];
  if ((newestCover.grant.confirmedAt ?? newestCover.grant.createdAt) > (newestExclude.grant.confirmedAt ?? newestExclude.grant.createdAt)) {
   return { outcome: 'covered', grant: newestCover.grant, predicate: newestCover.predicate ?? undefined, nearBoundary: newestCover.nearBoundary, narrowedGrantId: newestExclude.grant.id, conflictNote: `Two of your rules disagreed about this; your newer rule ("${newestCover.grant.sourceUtterance}") won, so the older one was narrowed to exclude this case.` };
  }
  return { outcome: 'not_covered', ask: newestExclude.reason ?? 'One of your rules blocks this.' };
 }
 if (ambiguous.length) {
  return { outcome: 'ambiguous', ask: ambiguous[0].reason ?? 'Your rule doesn\'t clearly cover this.' };
 }
 return { outcome: 'not_covered' };
}

/** Stage 4's proactive law: quiet hours 21:00–08:00 owner-local and
 * ≤3 nudges/day. Owner turns are never blocked by this — it gates
 * proactive surfacing only (§1.1 Stage 4 rule 2). */
export function proactiveAllowed(input: { hourLocal: number; nudgesToday: number }): { allowed: boolean; reason?: string } {
 if (input.hourLocal >= 21 || input.hourLocal < 8) return { allowed: false, reason: 'quiet hours' };
 if (input.nudgesToday >= 3) return { allowed: false, reason: 'daily nudge ration reached' };
 return { allowed: true };
}
