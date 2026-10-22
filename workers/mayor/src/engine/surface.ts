/**
 * engine/surface.ts — Stage 11's data: Desk intents for the engine's
 * cards. These shapes mirror web/desk/intents.ts (Slice 2 additions:
 * action-card, shadow-card, scenario-card, grant-card) — the server
 * emits data + composition; the client owns exactly one renderer per
 * primitive. No intent here can carry a numeric confidence (§1.2):
 * readiness is a treatment (Acted / Needs your eye / Holding),
 * never a figure.
 */
import type {Grant,PreparedAction,ProbeScenario} from './types';
import {listActionLog,listGrants,listPreparedActions,listScenarios} from './store';

type DB = D1Database;
type Intent = Record<string, unknown>;
const V = 1;

export function lineIntent(id: string, text: string, tone: 'plain' | 'muted' = 'plain'): Intent {
 return { type: 'line', id, version: V, summary: text, text, tone };
}

export function grantCardIntent(grant: Grant, actsCount: number): Intent {
 const scopeChips: string[] = [];
 scopeChips.push(grant.scope.who === 'any_customer' ? 'any customer' : grant.scope.who === 'existing_customers_only' ? 'existing customers' : grant.scope.who === 'named' ? `only ${(grant.scope.whoNames ?? []).join(', ')}` : `not ${(grant.scope.whoNames ?? []).join(', ')}`);
 if (grant.sessionScope === 'owner_test') scopeChips.push('your test bookings only — for now');
 for (const c of grant.conditions) scopeChips.push(c.label);
 return {
  type: 'grant-card', id: `grant-${grant.id}`, version: V,
  summary: `Your rule: ${grant.plainSummary}`,
  grantId: grant.id, state: grant.status, ownerWords: grant.sourceUtterance,
  summaryText: grant.plainSummary, neverLines: grant.neverLines, scopeChips, actsCount,
 };
}

export function scenarioCardIntent(s: ProbeScenario, grantId: string): Intent {
 return {
  type: 'scenario-card', id: `scenario-${s.id}`, version: V,
  summary: `Rule check: ${s.description}`,
  scenarioId: s.id, grantId, prompt: s.description, expected: s.expectedOutcome,
 };
}

export function actionCardIntent(a: PreparedAction, basisLine?: string): Intent {
 return {
  type: 'action-card', id: `action-${a.id}`, version: V,
  summary: a.payloadSummary,
  actionId: a.id, state: a.nearBoundary ? 'worth-a-look' : 'ready',
  headline: a.payloadSummary, ...(a.targetPerson ? { personName: a.targetPerson } : {}),
  ...(typeof a.payload.text === 'string' ? { draftText: a.payload.text } : {}),
  ...(basisLine ? { basisLine } : {}),
  ...(a.grantId ? { provenance: { grantId: a.grantId } } : {}),
  primaryLabel: "I'll send it",
 };
}

export function shadowCardIntent(a: PreparedAction, grant: Grant): Intent {
 return {
  type: 'shadow-card', id: `shadow-${a.id}`, version: V,
  summary: `Would have sent: ${a.payloadSummary}`,
  actionId: a.id, headline: 'Would have sent',
  ...(a.targetPerson ? { personName: a.targetPerson } : {}),
  ...(typeof a.payload.text === 'string' ? { draftText: a.payload.text } : {}),
  provenance: { ruleText: grant.sourceUtterance, predicate: a.predicateFired ?? grant.plainSummary },
  nearBoundary: a.nearBoundary,
 };
}

/** The engine's contribution to the Desk stream: the current probe
 * question (one at a time), every grant as its card, and every
 * pending prepared action — shadow cards with their provenance,
 * ask cards with their basis line. */
export async function buildEngineDeskIntents(db: DB, tenantId: string, currentScenarioId?: string | null): Promise<Intent[]> {
 const intents: Intent[] = [];
 const grants = await listGrants(db, tenantId);
 const log = await listActionLog(db, tenantId, { limit: 200 });
 const actsByGrant = new Map<string, number>();
 for (const row of log) if (row.grantId) actsByGrant.set(row.grantId, (actsByGrant.get(row.grantId) ?? 0) + 1);

 if (currentScenarioId) {
  for (const g of grants) {
   if (!g.probeSetId) continue;
   const scenarios = await listScenarios(db, tenantId, g.probeSetId);
   const current = scenarios.find(s => s.id === currentScenarioId);
   if (current && current.ownerRuling === null) intents.push(scenarioCardIntent(current, g.id));
  }
 }
 for (const g of grants) intents.push(grantCardIntent(g, actsByGrant.get(g.id) ?? 0));
 const pending = await listPreparedActions(db, tenantId, ['prepared']);
 for (const a of pending) {
  if (a.kind === 'shadow' && a.grantId) {
   const g = grants.find(x => x.id === a.grantId);
   if (g) { intents.push(shadowCardIntent(a, g)); continue; }
  }
  intents.push(actionCardIntent(a));
 }
 return intents;
}
