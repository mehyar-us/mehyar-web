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
import {audienceSeries,type AudienceSeries} from './audience';

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
  ...(typeof a.payload.edit_hint === 'string' ? { editHint: a.payload.edit_hint } : {}),
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

/* ---------------- audience (Phase B — OPERATOR path only) ----------------
 * The audience read is the owner's portfolio intel, not tenant
 * data (plan §2 M3 scoping). Its intent constructor therefore has
 * exactly one caller family: the OPERATORS-gated /engine/audience
 * route. It is deliberately NOT called from buildEngineDeskIntents
 * below — the tenant Desk flow can never emit it, and a unit pin
 * holds that line. */

export function audienceStatIntent(series: AudienceSeries): Intent {
 const productLabel = series.product === '*' ? 'all products' : series.product;
 const typeLabel = series.type === '*' ? 'events' : `${series.type} events`;
 const label = `${productLabel} · ${typeLabel}`;
 return {
  type: 'stat', id: `audience-${series.product}-${series.type}`, version: V,
  summary: `${label}: ${series.total} in the last ${series.weeks.length} weeks`,
  label, value: String(series.total),
  context: `last ${series.weeks.length} weeks`,
 };
}

/** Read + construct for the operator path: the series' stat intent,
 * built from AUDIENCE_DB. Kept beside the constructor so the route
 * stays a gate + a call. */
export async function buildAudienceDeskIntents(audienceDb: DB, input: { product?: string; type?: string; weeks: number }): Promise<Intent[]> {
 const series = await audienceSeries(audienceDb, input);
 return [audienceStatIntent(series)];
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
 /* CashText (§3.3): a draft (or approved-but-unsent) invoice whose
  * card has expired stays LISTED here as an invoice-card and is
  * re-approvable — expiry never strands a draft. Invoices with a
  * live card already render as action-cards above, so they are
  * excluded here. The read is guarded: a database without the 0078
  * tables simply renders no invoice cards. */
 try {
  const covered = new Set(pending.filter(a => a.actionClass === 'send_invoice').map(a => a.payload.invoice_id as string));
  const rows = await db.prepare("SELECT id,customer_id,description,amount_cents,status,due_date FROM mayor_cashtext_invoices WHERE tenant_id=? AND status IN ('draft','approved') ORDER BY created_at ASC").bind(tenantId).all<Record<string, unknown>>();
  for (const r of rows.results) {
   if (covered.has(r.id as string)) continue;
   const amount = r.amount_cents as number;
   intents.push({
    type: 'invoice-card', id: `invoice-${r.id as string}`, version: V,
    summary: `Invoice draft — $${(amount / 100).toFixed(2)}${r.description ? ` for ${r.description as string}` : ''}. Nothing sent yet.`,
    invoiceId: r.id as string, state: r.status as string, reapprovable: true,
    amountCents: amount, ...(r.description ? { description: r.description as string } : {}), ...(r.due_date ? { dueDate: r.due_date as string } : {}),
   });
  }
 } catch { /* 0078 not applied on this database — no invoice cards */ }
 /* CashText Friday summary (§3.6, Phase 4): the stored weekly
  * summary renders as a Desk stat while it is current (written
  * within the last 8 days). The cron leg in cashtext/cadence.ts is
  * the only writer; this is a read of its record, guarded like the
  * invoice cards above. */
 try {
  const row = await db.prepare('SELECT week_key,text,summary_json,created_at FROM mayor_cashtext_summaries WHERE tenant_id=? ORDER BY week_key DESC LIMIT 1').bind(tenantId).first<Record<string, unknown>>();
  if (row && Date.now() - Date.parse(row.created_at as string) < 8 * 86_400_000) {
   const data = JSON.parse(row.summary_json as string) as { collectedThisWeekCents?: number };
   intents.push({
    type: 'stat', id: `cashtext-summary-${row.week_key as string}`, version: V,
    summary: row.text as string,
    label: 'CashText · Friday cash summary',
    value: `$${(((data.collectedThisWeekCents ?? 0) as number) / 100).toFixed(2)} collected`,
    context: `week of ${row.week_key as string}`,
   });
  }
 } catch { /* 0081 not applied on this database — no summary stat */ }
 return intents;
}
