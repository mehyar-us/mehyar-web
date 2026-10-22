/**
 * engine-loop.test.ts — Slice 2 exit tests (§5), end to end against
 * the real Miniflare D1: the loop's first real run, the Grant Book's
 * full amended lifecycle, and onboarding as the loop's first run.
 *
 * The shadow law is asserted structurally: covered acts create
 * 'shadow' PreparedActions + ActionLog rows and NOTHING else — this
 * file (and the whole slice) contains no send path to assert
 * against, which is the point.
 */
import {createHash} from 'node:crypto';
import {beforeEach,describe,expect,it} from 'vitest';
import {env} from 'cloudflare:test';
import worker from '../../src/index';
import {createAuth} from '../../src/auth';
import type {Actor} from '../../src/env';
import {runOwnerTurn,applyScenarioRulingSurface,applyActionVerb,type EngineDeps} from '../../src/engine/loop';
import {unavailableDecideProvider,type DecideProvider} from '../../src/engine/decide';
import * as store from '../../src/engine/store';
import {addVoiceExemplar,getVoiceExemplars,getBusinessFact,recordObservation} from '../../src/engine/memory';
import {reapAnonymousTenants} from '../../src/engine/cost';
import {buildEngineDeskIntents} from '../../src/engine/surface';

const E = env as unknown as Record<string, unknown> & {AGENT_DB: D1Database; BETTER_AUTH_SECRET?: string};
let n = 0;
const tenantId = () => (n++).toString(16).padStart(4, 'a').padEnd(32, 'f').slice(0, 32);
const actorFor = (t: string): Actor => ({tenantId: t, userId: `user-${t.slice(0, 6)}`});

const autoProvider: DecideProvider = {consult: async () => ({answers: {intent_class: 'grant_statement'}, confidences: {intent_class: 0.93}, model: 'test-auto', costMicrocents: 0})};

function deps(over: Partial<EngineDeps> = {}): EngineDeps {
 let tick = 0;
 const base = new Date('2026-10-22T15:00:00.000Z').getTime();
 return {
  db: E.AGENT_DB,
  decideProvider: autoProvider,
  calendarProbe: async () => ({connected: true, detail: 'Google Calendar is connected and readable.'}),
  now: () => new Date(base + (tick++) * 61_000),
  ...over,
 };
}

async function seedTenant(t: string) {
 const now = new Date().toISOString();
 await E.AGENT_DB.prepare('INSERT OR IGNORE INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(t, 'Engine Test Shop', now).run();
 await E.AGENT_DB.prepare("INSERT OR IGNORE INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(t, `user-${t.slice(0, 6)}`).run();
}
async function talkTenant(t: string) {
 await seedTenant(t);
 const s = await store.getEngineState(E.AGENT_DB, t, {costCeilingMicrocents: 2_500_000_000});
 s.mode = 'talk';
 await store.saveEngineState(E.AGENT_DB, s);
}
const turn = (d: EngineDeps, a: Actor, text: string) => runOwnerTurn(d, a, {text});

/** Rule every queued scenario with its compiled expectation,
 * except `flipDescriptionPart`, which gets the opposite ruling. */
async function ruleAll(d: EngineDeps, a: Actor, flipDescriptionPart?: string) {
 let flipped = false;
 let flipDiff = '';
 for (let i = 0; i < 12; i++) {
  const s = await store.getEngineState(E.AGENT_DB, a.tenantId, {costCeilingMicrocents: 2_500_000_000});
  const o = s.onboarding as {currentScenarioId?: string; currentProbeSetId?: string};
  if (!o.currentScenarioId || !o.currentProbeSetId) break;
  const scenarios = await store.listScenarios(E.AGENT_DB, a.tenantId, o.currentProbeSetId);
  const sc = scenarios.find(x => x.id === o.currentScenarioId)!;
  const isFlip = flipDescriptionPart ? sc.description.includes(flipDescriptionPart) : false;
  const ruling = isFlip ? (sc.expectedOutcome === 'allowed' ? 'blocked' : 'allowed') : sc.expectedOutcome;
  const surf = await turn(d, a, ruling === 'allowed' ? 'Allowed' : 'Blocked');
  if (isFlip) { flipped = true; flipDiff = surf.lines.join(' '); }
 }
 return {flipped, flipDiff};
}

beforeEach(async () => {
 await E.AGENT_DB.prepare('DELETE FROM mayor_engine_state').run();
 await E.AGENT_DB.prepare('DELETE FROM mayor_grants').run();
 await E.AGENT_DB.prepare('DELETE FROM mayor_probe_sets').run();
 await E.AGENT_DB.prepare('DELETE FROM mayor_probe_scenarios').run();
 await E.AGENT_DB.prepare('DELETE FROM mayor_prepared_actions').run();
 await E.AGENT_DB.prepare('DELETE FROM mayor_action_log').run();
 await E.AGENT_DB.prepare('DELETE FROM mayor_decision_log').run();
 await E.AGENT_DB.prepare('DELETE FROM mayor_memory_objects').run();
 await E.AGENT_DB.prepare('DELETE FROM mayor_memory_edges').run();
 await E.AGENT_DB.prepare('DELETE FROM mayor_engine_envelopes').run();
 await E.AGENT_DB.prepare('DELETE FROM mayor_grant_suggestions').run();
 await E.AGENT_DB.prepare('DELETE FROM mayor_audit').run();
});

describe('§5 — the Grant Book lifecycle', () => {
 it('a grant in the owner\'s words compiles, probes, flips with a measurable predicate diff, and shadows', async () => {
  const t = tenantId(); const a = actorFor(t); const d = deps();
  await talkTenant(t);
  const s1 = await turn(d, a, 'You can reschedule anyone who asks, but never Mr. Ortiz');
  expect(s1.intents.some(i => i.type === 'grant-card')).toBe(true);
  expect(s1.intents.some(i => i.type === 'scenario-card')).toBe(true);
  let grants = await store.listGrants(E.AGENT_DB, t);
  expect(grants).toHaveLength(1);
  expect(grants[0].status).toBe('probed');
  expect(grants[0].neverLines.join(' ')).toContain('Ortiz');
  const scenarios = await store.listScenarios(E.AGENT_DB, t, grants[0].probeSetId!);
  expect(scenarios.length).toBeGreaterThanOrEqual(5);
  expect(scenarios.length).toBeLessThanOrEqual(7);
  const counter = scenarios.find(s => s.description.includes('Ortiz'));
  expect(counter).toBeTruthy();
  expect(counter!.expectedOutcome).toBe('blocked');
  const versionBefore = grants[0].version;

  const {flipped, flipDiff} = await ruleAll(d, a, 'Ortiz');
  expect(flipped).toBe(true);
  expect(flipDiff).toContain('the rule changed');
  expect(flipDiff).toContain('Removed your never line');

  grants = await store.listGrants(E.AGENT_DB, t);
  expect(grants[0].status).toBe('shadow');
  expect(grants[0].version).toBeGreaterThan(versionBefore);
  expect(grants[0].neverLines.join(' ')).not.toContain('Ortiz');
  expect(grants[0].confirmedAt).toBeTruthy();
  // grant_created fired exactly once, ledger-only (no consent asserted).
  const events = await E.AGENT_DB.prepare("SELECT * FROM mayor_audit WHERE tenant_id=? AND event='engine.grant_created'").bind(t).all();
  expect(events.results).toHaveLength(1);
  // The Rule memory object — the grant's hearable twin.
  const rules = await E.AGENT_DB.prepare("SELECT * FROM mayor_memory_objects WHERE tenant_id=? AND type='Rule'").bind(t).all();
  expect(rules.results).toHaveLength(1);
 });

 it('a covered act renders "Would have sent" with the firing predicate and executes NOTHING externally', async () => {
  const t = tenantId(); const a = actorFor(t); const d = deps();
  await talkTenant(t);
  await turn(d, a, 'You can reschedule anyone who asks');
  await ruleAll(d, a);
  const grants = await store.listGrants(E.AGENT_DB, t);
  expect(grants[0].status).toBe('shadow');

  const s = await turn(d, a, 'Dana asked to move her appointment to Thursday');
  const shadow = s.intents.find(i => i.type === 'shadow-card') as {provenance?: {ruleText: string; predicate: string}} | undefined;
  expect(shadow).toBeTruthy();
  expect(shadow!.provenance?.ruleText).toContain('reschedule anyone');
  expect(shadow!.provenance?.predicate).toContain('in scope');
  const actions = await E.AGENT_DB.prepare("SELECT * FROM mayor_prepared_actions WHERE tenant_id=? AND kind='shadow'").bind(t).all();
  expect(actions.results).toHaveLength(1);
  const log = await store.listActionLog(E.AGENT_DB, t, {limit: 10});
  const shadowRow = log.find(r => r.kind === 'shadow');
  expect(shadowRow?.grantId).toBe(grants[0].id);
  expect(shadowRow?.grantVersion).toBe(grants[0].version);
  expect(shadowRow?.sourceUtterance).toContain('reschedule anyone');
  // The audit question answers from the log, quoting the owner's words.
  const audit = await turn(d, a, 'Why did you text Dana?');
  expect(audit.lines.join(' ')).toContain('reschedule anyone');
 });

 it('revocation mid-conversation cancels queued shadow acts; the version bump is committed when the reply lands', async () => {
  const t = tenantId(); const a = actorFor(t); const d = deps();
  await talkTenant(t);
  await turn(d, a, 'You can reschedule anyone who asks');
  await ruleAll(d, a);
  await turn(d, a, 'Dana asked to move her appointment to Thursday');
  const before = await store.listGrants(E.AGENT_DB, t);
  const s = await turn(d, a, 'Stop rescheduling people on your own');
  expect(s.lines.join(' ')).toContain('Stopped');
  const after = await store.listGrants(E.AGENT_DB, t);
  expect(after[0].status).toBe('revoked');
  expect(after[0].version).toBeGreaterThan(before[0].version);
  const queued = await E.AGENT_DB.prepare("SELECT * FROM mayor_prepared_actions WHERE tenant_id=? AND grant_id=? AND status='prepared'").bind(t, before[0].id).all();
  expect(queued.results).toHaveLength(0);
  const cancelled = await E.AGENT_DB.prepare("SELECT * FROM mayor_prepared_actions WHERE tenant_id=? AND grant_id=? AND status='cancelled'").bind(t, before[0].id).all();
  expect(cancelled.results.length).toBeGreaterThanOrEqual(1);
 });

 it('a never-grantable attempt is declined in one sentence and creates NO grant row', async () => {
  const t = tenantId(); const a = actorFor(t); const d = deps();
  await talkTenant(t);
  const s = await turn(d, a, "Refund anyone who's unhappy, no questions asked");
  expect(s.lines).toHaveLength(1);
  expect(s.lines[0]).toContain("can't take standing authority for refunds");
  expect(await store.listGrants(E.AGENT_DB, t)).toHaveLength(0);
 });

 it('ambiguous coverage resolves to prepare-and-ask, never to a shadow act', async () => {
  const t = tenantId(); const a = actorFor(t); const d = deps();
  await talkTenant(t);
  await turn(d, a, 'Reschedule my regulars when they ask');
  await ruleAll(d, a);
  const grants = await store.listGrants(E.AGENT_DB, t);
  expect(grants[0].scope.who).toBe('existing_customers_only');
  // Marcus has never been seen: whether he counts is NOT settled.
  const s = await turn(d, a, 'Marcus asked to move his appointment to Friday');
  expect(s.intents.some(i => i.type === 'action-card')).toBe(true);
  expect(s.intents.some(i => i.type === 'shadow-card')).toBe(false);
  const shadows = await E.AGENT_DB.prepare("SELECT * FROM mayor_prepared_actions WHERE tenant_id=? AND kind='shadow'").bind(t).all();
  expect(shadows.results).toHaveLength(0);
  const asks = await E.AGENT_DB.prepare("SELECT * FROM mayor_prepared_actions WHERE tenant_id=? AND kind='ask'").bind(t).all();
  expect(asks.results).toHaveLength(1);
 });
});

describe('§5 — Stage 5 decide() placement', () => {
 it('an outage degrades to prepare-and-ask with zero shadow acts, and the consultation is logged with its profile', async () => {
  const t = tenantId(); const a = actorFor(t); const d = deps({decideProvider: unavailableDecideProvider});
  await talkTenant(t);
  const s = await turn(d, a, 'Handle the thing with Dana like we discussed');
  expect(s.lines.join(' ')).toContain('careful with that one');
  const logs = await E.AGENT_DB.prepare('SELECT * FROM mayor_decision_log WHERE tenant_id=?').bind(t).all<Record<string, unknown>>();
  expect(logs.results).toHaveLength(1);
  expect(logs.results[0].threshold_profile).toBe('mayor_intent');
  expect(logs.results[0].band_outcome).toBe('unavailable');
  expect(String(logs.results[0].question_ids_json)).toContain('intent_class');
  expect(String(logs.results[0].state_hash)).toMatch(/^[a-f0-9]{64}$/);
  expect(await store.listGrants(E.AGENT_DB, t)).toHaveLength(0);
  const actions = await E.AGENT_DB.prepare('SELECT * FROM mayor_prepared_actions WHERE tenant_id=?').bind(t).all();
  expect(actions.results).toHaveLength(0);
 });

 it('a confident consultation carries the turn into compilation; the log row names the profile and band', async () => {
  const t = tenantId(); const a = actorFor(t); const d = deps();
  await talkTenant(t);
  await turn(d, a, 'Handle the rescheduling thing with Dana');
  const logs = await E.AGENT_DB.prepare('SELECT * FROM mayor_decision_log WHERE tenant_id=?').bind(t).all<Record<string, unknown>>();
  expect(logs.results).toHaveLength(1);
  expect(logs.results[0].threshold_profile).toBe('mayor_intent');
  expect(logs.results[0].band_outcome).toBe('auto');
  const grants = await store.listGrants(E.AGENT_DB, t);
  expect(grants).toHaveLength(1);
  expect(grants[0].actionClass).toBe('reschedule');
 });
});

describe('§5 — onboarding is the loop\'s first run (§2)', () => {
 it('reaches supervised mode with exactly one shadowed grant scoped to the owner\'s own test bookings', async () => {
  const t = tenantId(); const a = actorFor(t); const d = deps();
  await seedTenant(t);
  const s1 = await turn(d, a, 'Fresh Fade, barbershop, Bay Ridge');
  expect(s1.intents.some(i => i.type === 'fact')).toBe(true);
  await turn(d, a, "That's us");
  await turn(d, a, "Hey, running 10 behind today — your chair is saved, come on in when you're close");
  const voice = await getVoiceExemplars(E.AGENT_DB, t, 'customers');
  expect(voice).toHaveLength(1);
  const s4 = await turn(d, a, 'Connect my calendar');
  expect(s4.lines.join(' ')).toContain('Connected');
  await turn(d, a, 'Reschedule anyone who asks');
  const grants = await store.listGrants(E.AGENT_DB, t);
  expect(grants).toHaveLength(1);
  expect(grants[0].sessionScope).toBe('owner_test');
  // Rule the probe via the card endpoint path (same engine function).
  for (let i = 0; i < 10; i++) {
   const st = await store.getEngineState(E.AGENT_DB, t, {costCeilingMicrocents: 2_500_000_000});
   const o = st.onboarding as {currentScenarioId?: string; currentProbeSetId?: string};
   if (!o.currentScenarioId || !o.currentProbeSetId) break;
   const scenarios = await store.listScenarios(E.AGENT_DB, t, o.currentProbeSetId);
   const sc = scenarios.find(x => x.id === o.currentScenarioId)!;
   await applyScenarioRulingSurface(d, a, sc.id, sc.expectedOutcome);
  }
  const shadowed = await store.listGrants(E.AGENT_DB, t, ['shadow']);
  expect(shadowed).toHaveLength(1);
  await turn(d, a, 'Read first');
  const st = await store.getEngineState(E.AGENT_DB, t, {costCeilingMicrocents: 2_500_000_000});
  expect(st.mode).toBe('supervised');
  // Session-one law: a REAL customer booking is NOT shadow-covered…
  const realAct = await turn(d, a, 'Dana asked to move her appointment to Thursday');
  expect(realAct.intents.some(i => i.type === 'shadow-card')).toBe(false);
  // …but the owner's own test booking is.
  const testAct = await turn(d, a, 'Dana asked to move my test booking to Thursday');
  expect(testAct.intents.some(i => i.type === 'shadow-card')).toBe(true);
 });

 it('voice exemplars come only from the owner — customer text never enters the store', async () => {
  const t = tenantId();
  await seedTenant(t);
  const bad = await addVoiceExemplar(E.AGENT_DB, {tenantId: t, audience: 'customers', text: 'Customer words that must never teach the voice.', source: 'customer'});
  expect(bad.accepted).toBe(false);
  const bad2 = await addVoiceExemplar(E.AGENT_DB, {tenantId: t, audience: 'customers', text: 'Observed words that must never teach the voice.', source: 'observed'});
  expect(bad2.accepted).toBe(false);
  const good = await addVoiceExemplar(E.AGENT_DB, {tenantId: t, audience: 'customers', text: 'The owner\'s own words teach the voice.', source: 'owner_approved'});
  expect(good.accepted).toBe(true);
  expect(await getVoiceExemplars(E.AGENT_DB, t, 'customers')).toHaveLength(1);
 });

 it('an owner correction applies in-conversation, the same turn', async () => {
  const t = tenantId(); const a = actorFor(t); const d = deps();
  await talkTenant(t);
  const s = await turn(d, a, 'Actually, we close at 6, not 7');
  expect(s.lines.join(' ')).toContain('closing time is now 6');
  const fact = await getBusinessFact(E.AGENT_DB, t, 'hours.close');
  expect(fact?.payload.value).toBe('6');
  expect(fact?.confidenceTier).toBe('owner_confirmed');
 });
});

describe('§5 — memory rules + tenant isolation + §8.6 default', () => {
 it('observations strengthen only by repetition; a conflict disputes BOTH versions', async () => {
  const t = tenantId();
  await seedTenant(t);
  await recordObservation(E.AGENT_DB, {tenantId: t, key: 'fact:x', value: 'one', source: 'first sighting'});
  let fact = await getBusinessFact(E.AGENT_DB, t, 'fact:x');
  expect(fact?.confidenceTier).toBe('observed_weak');
  await recordObservation(E.AGENT_DB, {tenantId: t, key: 'fact:x', value: 'one', source: 'second sighting'});
  await recordObservation(E.AGENT_DB, {tenantId: t, key: 'fact:x', value: 'one', source: 'third sighting'});
  fact = await getBusinessFact(E.AGENT_DB, t, 'fact:x');
  expect(fact?.confidenceTier).toBe('observed_strong');
  await recordObservation(E.AGENT_DB, {tenantId: t, key: 'fact:x', value: 'two', source: 'a different sighting'});
  const rows = await E.AGENT_DB.prepare("SELECT * FROM mayor_memory_objects WHERE tenant_id=? AND status='disputed'").bind(t).all();
  expect(rows.results.length).toBeGreaterThanOrEqual(2);
 });

 it('cross-tenant bleed: tenant A never sees, uses, or audits tenant B\'s book', async () => {
  const ta = tenantId(); const tb = tenantId();
  const aa = actorFor(ta); const ab = actorFor(tb); const d = deps();
  await talkTenant(ta); await talkTenant(tb);
  await turn(d, ab, 'You can reschedule anyone who asks');
  await ruleAll(d, ab);
  await turn(d, ab, 'Dana asked to move her appointment to Thursday');
  // A's book is empty; B's grant does not cover A's acts.
  expect(await store.listGrants(E.AGENT_DB, ta)).toHaveLength(0);
  const deskA = await buildEngineDeskIntents(E.AGENT_DB, ta);
  expect(deskA.some(i => i.type === 'grant-card')).toBe(false);
  const auditA = await turn(d, aa, 'What did you do today?');
  expect(auditA.lines.join(' ')).toContain('Nothing yet today');
  const actA = await turn(d, aa, 'Dana asked to move her appointment to Thursday');
  expect(actA.intents.some(i => i.type === 'action-card')).toBe(true);
  expect(actA.intents.some(i => i.type === 'shadow-card')).toBe(false);
 });

 it('the §8.6 default reaps unclaimed anonymous tenants at 30 days — claimed and young tenants untouched', async () => {
  const old = tenantId(); const young = tenantId(); const claimed = tenantId();
  for (const t of [old, young, claimed]) await seedTenant(t);
  const oldDate = new Date(Date.now() - 40 * 86400_000).toISOString();
  await E.AGENT_DB.prepare('INSERT INTO mayor_engine_state(tenant_id,mode,onboarding_json,cost_period,cost_microcents,cost_ceiling_microcents,anonymous,claimed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .bind(old, 'onboarding', '{}', '2026-09', 0, 2_500_000_000, 1, null, oldDate, oldDate).run();
  await E.AGENT_DB.prepare('INSERT INTO mayor_engine_state(tenant_id,mode,onboarding_json,cost_period,cost_microcents,cost_ceiling_microcents,anonymous,claimed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .bind(young, 'onboarding', '{}', '2026-10', 0, 2_500_000_000, 1, null, new Date().toISOString(), new Date().toISOString()).run();
  await E.AGENT_DB.prepare('INSERT INTO mayor_engine_state(tenant_id,mode,onboarding_json,cost_period,cost_microcents,cost_ceiling_microcents,anonymous,claimed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .bind(claimed, 'talk', '{}', '2026-09', 0, 2_500_000_000, 1, oldDate, oldDate, oldDate).run();
  for (const t of [old, young]) {
   await store.insertGrant(E.AGENT_DB, {tenantId: t, status: 'proposed', actionClass: 'reschedule', scope: {who: 'any_customer', what: 'any_service', when: 'any_time', channel: 'any', limits: {maxMessagesPerPersonPerDay: 1}}, conditions: [], neverLines: [], sourceUtterance: 'rule', plainSummary: 'rule', origin: 'owner_stated', capabilityState: 'present', probeSetId: null, sessionScope: 'standard', asks: [], confirmedAt: null, expiresAt: null, supersedesId: null});
  }
  const reaped = await reapAnonymousTenants(E.AGENT_DB, new Date());
  expect(reaped).toContain(old);
  expect(reaped).not.toContain(young);
  expect(reaped).not.toContain(claimed);
  const oldState = await E.AGENT_DB.prepare('SELECT COUNT(*) AS c FROM mayor_engine_state WHERE tenant_id=?').bind(old).first<{c: number}>();
  expect(oldState?.c).toBe(0);
  expect(await store.listGrants(E.AGENT_DB, old)).toHaveLength(0);
  expect(await store.listGrants(E.AGENT_DB, young)).toHaveLength(1);
 });

 it('assistant-proposed grants (§1.3.2 step 1): proposed once after 3 approvals; a "no" suppresses for 30 days', async () => {
  const t = tenantId(); const a = actorFor(t); const d = deps();
  await talkTenant(t);
  const approveOne = async (text: string) => {
   const s = await turn(d, a, text);
   const card = s.intents.find(i => i.type === 'action-card') as {actionId: string} | undefined;
   expect(card).toBeTruthy();
   return applyActionVerb(d, a, card!.actionId, 'approve');
  };
  await approveOne('Dana asked to move her appointment to Thursday');
  await approveOne('Marcus asked to move his appointment to Friday');
  const third = await approveOne('Priya asked to move her appointment to Monday');
  expect(third.lines.join(' ')).toContain('three times now');
  const no = await turn(d, a, 'No');
  expect(no.lines.join(' ')).toContain("won't suggest that one again");
  const suggestion = await store.getSuggestion(E.AGENT_DB, t, 'reschedule');
  expect(suggestion?.proposedCount).toBe(1);
  expect(suggestion?.suppressedUntil).toBeTruthy();
  expect(new Date(suggestion!.suppressedUntil!).getTime() - Date.now()).toBeGreaterThan(25 * 86400_000);
  // Three more approvals do NOT re-propose.
  await approveOne('Dana asked to move her appointment to Tuesday');
  await approveOne('Marcus asked to move his appointment to Wednesday');
  const sixth = await approveOne('Priya asked to move her appointment to Thursday');
  expect(sixth.lines.join(' ')).not.toContain('three times now');
 });

 it('envelope idempotency: a replayed turn returns the original surface and writes nothing twice', async () => {
  const t = tenantId(); const a = actorFor(t); const d = deps();
  await talkTenant(t);
  const first = await runOwnerTurn(d, a, {text: 'You can reschedule anyone who asks', idempotencyKey: 'turn-abc'});
  const second = await runOwnerTurn(d, a, {text: 'You can reschedule anyone who asks', idempotencyKey: 'turn-abc'});
  expect(second.lines).toEqual(first.lines);
  expect(await store.listGrants(E.AGENT_DB, t)).toHaveLength(1);
 });

 it('the HTTP surface enforces membership and serves the Desk snapshot', async () => {
  const t = tenantId(); const a = actorFor(t);
  await talkTenant(t);
  const d = deps();
  await turn(d, a, 'You can reschedule anyone who asks');
  // A real session for the tenant's owner (founding-door pattern).
  const ctx = await createAuth(E as never).$context;
  const user = await ctx.internalAdapter.createUser({email: `engine-${t.slice(0, 6)}@example.test`, name: 'Engine Owner', emailVerified: true});
  await E.AGENT_DB.prepare("INSERT OR REPLACE INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(t, user.id).run();
  const session = await ctx.internalAdapter.createSession(user.id);
  const row = await E.AGENT_DB.prepare('SELECT token FROM auth_session WHERE id=?').bind(session.id).first<{token: string}>();
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(E.BETTER_AUTH_SECRET!), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(row!.token));
  const cookie = '__Secure-mehyar-agent.session_token=' + encodeURIComponent(row!.token + '.' + btoa(String.fromCharCode(...new Uint8Array(signature))));
  const headers = {cookie, origin: 'https://mayor.example.test', 'content-type': 'application/json'};
  const desk = await worker.fetch(new Request(`https://mayor.example.test/api/businesses/${t}/engine/desk`, {headers}), E as never, {} as ExecutionContext);
  expect(desk.status).toBe(200);
  const deskBody = await desk.json() as {intents: Array<{type: string}>};
  expect(deskBody.intents.some(i => i.type === 'grant-card')).toBe(true);
  const turnRes = await worker.fetch(new Request(`https://mayor.example.test/api/businesses/${t}/engine/turn`, {method: 'POST', headers, body: JSON.stringify({text: 'What did you do today?'})}), E as never, {} as ExecutionContext);
  expect(turnRes.status).toBe(200);
  const stranger = await worker.fetch(new Request(`https://mayor.example.test/api/businesses/${t}/engine/desk`, {headers: {origin: 'https://mayor.example.test'}}), E as never, {} as ExecutionContext);
  expect([401, 403]).toContain(stranger.status);
 });
});
