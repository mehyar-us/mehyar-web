/**
 * engine/store.ts — the engine's data access (Slice 2). Discipline:
 * EVERY function takes tenantId and EVERY query binds it — there is
 * no code path here that can read another tenant's rows; a caller bug
 * produces empty results, never another business's data (the §5
 * cross-tenant bleed test pins this). Physical per-tenant D1
 * provisioning is the Slice 3 bridge (§1.9); this store's shape is
 * the isolation contract until topology changes.
 */
import type {Grant,MemoryObject,PreparedAction,ProbeScenario} from './types';
import {isNeverLiveActionClass} from './types';

type DB = D1Database;
const nowISO = () => new Date().toISOString();
const parse = <T,>(s: string, fallback: T): T => { try { return JSON.parse(s) as T; } catch { return fallback; } };

/** SHA-256 of a canonical state bundle — DecisionLog stores this
 * hash, never the state text (§1.2). */
export async function hashState(state: unknown): Promise<string> {
 const bytes = new TextEncoder().encode(JSON.stringify(state));
 const digest = await crypto.subtle.digest('SHA-256', bytes);
 return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ---------------- envelopes (Stage 1) ---------------- */

export async function admitEnvelope(db: DB, input: { tenantId: string; idempotencyKey: string; channel: string; actorKind: string }): Promise<{ envelopeId: string; replay: string | null }> {
 const existing = await db.prepare('SELECT id,result_json FROM mayor_engine_envelopes WHERE tenant_id=? AND idempotency_key=?')
  .bind(input.tenantId, input.idempotencyKey).first<{ id: string; result_json: string | null }>();
 if (existing) return { envelopeId: existing.id, replay: existing.result_json };
 const id = crypto.randomUUID();
 await db.prepare('INSERT INTO mayor_engine_envelopes(id,tenant_id,idempotency_key,channel,actor_kind,created_at) VALUES(?,?,?,?,?,?)')
  .bind(id, input.tenantId, input.idempotencyKey, input.channel, input.actorKind, nowISO()).run();
 return { envelopeId: id, replay: null };
}

export async function saveEnvelopeResult(db: DB, tenantId: string, envelopeId: string, resultJson: string): Promise<void> {
 await db.prepare('UPDATE mayor_engine_envelopes SET result_json=? WHERE tenant_id=? AND id=?').bind(resultJson, tenantId, envelopeId).run();
}

/* ---------------- grants (the Grant Book) ---------------- */

function rowToGrant(r: Record<string, unknown>): Grant {
 return {
  id: r.id as string, tenantId: r.tenant_id as string, version: r.version as number,
  status: r.status as Grant['status'], actionClass: r.action_class as Grant['actionClass'],
  scope: parse(r.scope_json as string, null as never), conditions: parse(r.conditions_json as string, []),
  neverLines: parse(r.never_lines_json as string, []), sourceUtterance: r.source_utterance as string,
  plainSummary: r.plain_summary as string, origin: r.origin as Grant['origin'],
  capabilityState: r.capability_state as Grant['capabilityState'], probeSetId: (r.probe_set_id as string) ?? null,
  sessionScope: r.session_scope as Grant['sessionScope'], asks: parse(r.asks_json as string, []),
  createdAt: r.created_at as string, confirmedAt: (r.confirmed_at as string) ?? null,
  expiresAt: (r.expires_at as string) ?? null, supersedesId: (r.supersedes_id as string) ?? null,
 };
}

export async function insertGrant(db: DB, g: Omit<Grant, 'id' | 'createdAt' | 'version'> & { version?: number }): Promise<Grant> {
 const grant: Grant = { ...g, id: crypto.randomUUID(), version: g.version ?? 1, createdAt: nowISO() };
 await db.prepare(`INSERT INTO mayor_grants(id,tenant_id,version,status,action_class,scope_json,conditions_json,never_lines_json,source_utterance,plain_summary,origin,capability_state,probe_set_id,session_scope,asks_json,created_at,confirmed_at,expires_at,supersedes_id)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .bind(grant.id, grant.tenantId, grant.version, grant.status, grant.actionClass, JSON.stringify(grant.scope), JSON.stringify(grant.conditions), JSON.stringify(grant.neverLines), grant.sourceUtterance, grant.plainSummary, grant.origin, grant.capabilityState, grant.probeSetId, grant.sessionScope, JSON.stringify(grant.asks), grant.createdAt, grant.confirmedAt, grant.expiresAt, grant.supersedesId).run();
 return grant;
}

export async function getGrant(db: DB, tenantId: string, grantId: string): Promise<Grant | null> {
 const row = await db.prepare('SELECT * FROM mayor_grants WHERE tenant_id=? AND id=?').bind(tenantId, grantId).first<Record<string, unknown>>();
 return row ? rowToGrant(row) : null;
}

export async function listGrants(db: DB, tenantId: string, statuses?: Grant['status'][]): Promise<Grant[]> {
 const rows = statuses?.length
  ? await db.prepare(`SELECT * FROM mayor_grants WHERE tenant_id=? AND status IN (${statuses.map(() => '?').join(',')}) ORDER BY created_at ASC`).bind(tenantId, ...statuses).all<Record<string, unknown>>()
  : await db.prepare('SELECT * FROM mayor_grants WHERE tenant_id=? ORDER BY created_at ASC').bind(tenantId).all<Record<string, unknown>>();
 return rows.results.map(rowToGrant);
}

/** Persist a grant mutation as a NEW VERSION of the same row: the
 * version counter is the revocation/optimistic-lock token every
 * Workflow step re-checks (§1.3.3). */
export async function saveGrantVersion(db: DB, g: Grant): Promise<Grant> {
 const next: Grant = { ...g, version: g.version + 1 };
 await db.prepare(`UPDATE mayor_grants SET version=?,status=?,scope_json=?,conditions_json=?,never_lines_json=?,plain_summary=?,capability_state=?,probe_set_id=?,asks_json=?,confirmed_at=?,expires_at=? WHERE tenant_id=? AND id=?`)
  .bind(next.version, next.status, JSON.stringify(next.scope), JSON.stringify(next.conditions), JSON.stringify(next.neverLines), next.plainSummary, next.capabilityState, next.probeSetId, JSON.stringify(next.asks), next.confirmedAt, next.expiresAt, next.tenantId, next.id).run();
 return next;
}

/* ---------------- probes ---------------- */

export async function insertProbeSet(db: DB, tenantId: string, grantId: string, scenarios: Array<{ description: string; detail: Record<string, unknown>; expectedOutcome: 'allowed' | 'blocked' }>): Promise<{ probeSetId: string; scenarios: ProbeScenario[] }> {
 const probeSetId = crypto.randomUUID();
 await db.prepare('INSERT INTO mayor_probe_sets(id,tenant_id,grant_id,created_at) VALUES(?,?,?,?)').bind(probeSetId, tenantId, grantId, nowISO()).run();
 const out: ProbeScenario[] = [];
 for (const [i, s] of scenarios.entries()) {
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO mayor_probe_scenarios(id,probe_set_id,tenant_id,ordinal,description,detail_json,expected_outcome,created_at) VALUES(?,?,?,?,?,?,?,?)')
   .bind(id, probeSetId, tenantId, i + 1, s.description, JSON.stringify(s.detail), s.expectedOutcome, nowISO()).run();
  out.push({ id, probeSetId, ordinal: i + 1, description: s.description, detail: s.detail as ProbeScenario['detail'], expectedOutcome: s.expectedOutcome, ownerRuling: null, flipped: false });
 }
 return { probeSetId, scenarios: out };
}

export async function getProbeSetGrantId(db: DB, tenantId: string, probeSetId: string): Promise<string | null> {
 const row = await db.prepare('SELECT grant_id FROM mayor_probe_sets WHERE tenant_id=? AND id=?').bind(tenantId, probeSetId).first<{ grant_id: string }>();
 return row?.grant_id ?? null;
}

export async function listScenarios(db: DB, tenantId: string, probeSetId: string): Promise<ProbeScenario[]> {
 const rows = await db.prepare('SELECT * FROM mayor_probe_scenarios WHERE tenant_id=? AND probe_set_id=? ORDER BY ordinal ASC').bind(tenantId, probeSetId).all<Record<string, unknown>>();
 return rows.results.map(r => ({
  id: r.id as string, probeSetId: r.probe_set_id as string, ordinal: r.ordinal as number,
  description: r.description as string, detail: parse(r.detail_json as string, {}),
  expectedOutcome: r.expected_outcome as 'allowed' | 'blocked',
  ownerRuling: (r.owner_ruling as 'allowed' | 'blocked' | null) ?? null, flipped: (r.flipped as number) === 1,
 }));
}

export async function ruleScenario(db: DB, tenantId: string, scenarioId: string, ruling: 'allowed' | 'blocked', flipped: boolean): Promise<void> {
 await db.prepare('UPDATE mayor_probe_scenarios SET owner_ruling=?,flipped=? WHERE tenant_id=? AND id=?').bind(ruling, flipped ? 1 : 0, tenantId, scenarioId).run();
}

/** After a flip re-compiles the rule, unruled scenarios are re-scored
 * against the new predicates — their expectations are the compiled
 * rule's, not history's. */
export async function updateScenarioExpectation(db: DB, tenantId: string, scenarioId: string, expected: 'allowed' | 'blocked'): Promise<void> {
 await db.prepare('UPDATE mayor_probe_scenarios SET expected_outcome=? WHERE tenant_id=? AND id=?').bind(expected, tenantId, scenarioId).run();
}

/* ---------------- prepared actions + action log ---------------- */

export async function insertPreparedAction(db: DB, a: Omit<PreparedAction, 'id' | 'createdAt' | 'status'>): Promise<PreparedAction> {
 const action: PreparedAction = { ...a, id: crypto.randomUUID(), status: 'prepared', createdAt: nowISO() };
 await db.prepare(`INSERT INTO mayor_prepared_actions(id,tenant_id,kind,action_class,target_person,channel,payload_json,payload_summary,grant_id,grant_version,predicate_fired,decision_id,near_boundary,reversibility_json,expires_at,status,created_at,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .bind(action.id, action.tenantId, action.kind, action.actionClass, action.targetPerson, action.channel, JSON.stringify(action.payload), action.payloadSummary, action.grantId, action.grantVersion, action.predicateFired, action.decisionId, action.nearBoundary ? 1 : 0, action.reversibility ? JSON.stringify(action.reversibility) : null, action.expiresAt, action.status, action.createdAt, action.createdAt).run();
 return action;
}

export async function listPreparedActions(db: DB, tenantId: string, statuses: PreparedAction['status'][] = ['prepared']): Promise<PreparedAction[]> {
 const rows = await db.prepare(`SELECT * FROM mayor_prepared_actions WHERE tenant_id=? AND status IN (${statuses.map(() => '?').join(',')}) ORDER BY created_at DESC`).bind(tenantId, ...statuses).all<Record<string, unknown>>();
 return rows.results.map(r => ({
  id: r.id as string, tenantId: r.tenant_id as string, kind: r.kind as 'ask' | 'shadow', actionClass: r.action_class as PreparedAction['actionClass'],
  targetPerson: (r.target_person as string) ?? null, channel: r.channel as string, payload: parse(r.payload_json as string, {}),
  payloadSummary: r.payload_summary as string, grantId: (r.grant_id as string) ?? null, grantVersion: (r.grant_version as number) ?? null,
  predicateFired: (r.predicate_fired as string) ?? null, decisionId: (r.decision_id as string) ?? null,
  nearBoundary: (r.near_boundary as number) === 1, reversibility: r.reversibility_json ? parse(r.reversibility_json as string, null) : null,
  expiresAt: r.expires_at as string, status: r.status as PreparedAction['status'], createdAt: r.created_at as string,
 }));
}

export async function getPreparedAction(db: DB, tenantId: string, id: string): Promise<PreparedAction | null> {
 const rows = await listPreparedActions(db, tenantId, ['prepared', 'approved', 'dismissed', 'expired', 'cancelled']);
 return rows.find(a => a.id === id) ?? null;
}

export async function updatePreparedActionPayload(db: DB, tenantId: string, id: string, payload: Record<string, unknown>): Promise<void> {
 await db.prepare('UPDATE mayor_prepared_actions SET payload_json=?,updated_at=? WHERE tenant_id=? AND id=?').bind(JSON.stringify(payload), nowISO(), tenantId, id).run();
}

export async function setPreparedStatus(db: DB, tenantId: string, id: string, status: PreparedAction['status']): Promise<void> {
 await db.prepare('UPDATE mayor_prepared_actions SET status=?,updated_at=? WHERE tenant_id=? AND id=?').bind(status, nowISO(), tenantId, id).run();
}

/** Revocation cancels every unexecuted action under the grant's
 * scope (§1.3.3) — queued shadow/ask cards under that grant die with
 * the version bump, in the same breath. */
export async function cancelPreparedByGrant(db: DB, tenantId: string, grantId: string): Promise<number> {
 const res = await db.prepare(`UPDATE mayor_prepared_actions SET status='cancelled',updated_at=? WHERE tenant_id=? AND grant_id=? AND status='prepared'`).bind(nowISO(), tenantId, grantId).run();
 return res.meta.changes ?? 0;
}

export async function writeActionLog(db: DB, input: {
 tenantId: string; actionKey: string; kind: 'shadow' | 'prepared' | 'note'; actionClass?: string; targetPerson?: string;
 channel?: string; payloadSummary: string; grantId?: string; grantVersion?: number; sourceUtterance?: string;
 decisionId?: string; preparedActionId?: string;
}): Promise<void> {
 await db.prepare(`INSERT OR IGNORE INTO mayor_action_log(id,tenant_id,action_key,at,kind,action_class,target_person,channel,payload_summary,grant_id,grant_version,source_utterance,decision_id,prepared_action_id)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .bind(crypto.randomUUID(), input.tenantId, input.actionKey, nowISO(), input.kind, input.actionClass ?? null, input.targetPerson ?? null, input.channel ?? null, input.payloadSummary, input.grantId ?? null, input.grantVersion ?? null, input.sourceUtterance ?? null, input.decisionId ?? null, input.preparedActionId ?? null).run();
}

/* The executor's exactly-once claim (spec §3.3 step 1): insert the
 * action-log row FIRST, under the deterministic action_key. Returns
 * true only for the caller that actually inserted the row — the
 * table's UNIQUE(tenant_id, action_key) makes a double-approval, a
 * replayed verb, or a retried execution a no-op, not a double-send.
 * kind is a free TEXT column on the table; CashText executions log
 * kind 'executed' (a send that really left) — distinct from Slice 2's
 * 'shadow'/'prepared'/'note' bookkeeping kinds. */
export async function claimActionLog(db: DB, input: {
 tenantId: string; actionKey: string; kind: string; actionClass?: string; targetPerson?: string;
 channel?: string; payloadSummary: string; preparedActionId?: string;
}): Promise<boolean> {
 const res = await db.prepare(`INSERT OR IGNORE INTO mayor_action_log(id,tenant_id,action_key,at,kind,action_class,target_person,channel,payload_summary,prepared_action_id)
  VALUES(?,?,?,?,?,?,?,?,?,?)`)
  .bind(crypto.randomUUID(), input.tenantId, input.actionKey, nowISO(), input.kind, input.actionClass ?? null, input.targetPerson ?? null, input.channel ?? null, input.payloadSummary, input.preparedActionId ?? null).run();
 return (res.meta.changes ?? 0) > 0;
}

/** Record the verification outcome on a claimed action-log row (the
 * executor's step 3): 'sent', or 'failed' when Stripe refused — the
 * row stays either way, so the attempt is auditable exactly once. */
export async function updateActionLogVerification(db: DB, tenantId: string, actionKey: string, verificationResult: string): Promise<void> {
 await db.prepare('UPDATE mayor_action_log SET verification_result=? WHERE tenant_id=? AND action_key=?').bind(verificationResult, tenantId, actionKey).run();
}

export interface ActionLogRow { id: string; at: string; kind: string; actionClass: string | null; targetPerson: string | null; channel: string | null; payloadSummary: string; grantId: string | null; grantVersion: number | null; sourceUtterance: string | null; }

export async function listActionLog(db: DB, tenantId: string, opts: { since?: string; person?: string; limit?: number } = {}): Promise<ActionLogRow[]> {
 const clauses = ['tenant_id=?']; const binds: unknown[] = [tenantId];
 if (opts.since) { clauses.push('at>=?'); binds.push(opts.since); }
 if (opts.person) { clauses.push('target_person=?'); binds.push(opts.person); }
 const rows = await db.prepare(`SELECT * FROM mayor_action_log WHERE ${clauses.join(' AND ')} ORDER BY at DESC LIMIT ?`).bind(...binds, opts.limit ?? 50).all<Record<string, unknown>>();
 return rows.results.map(r => ({
  id: r.id as string, at: r.at as string, kind: r.kind as string, actionClass: (r.action_class as string) ?? null,
  targetPerson: (r.target_person as string) ?? null, channel: (r.channel as string) ?? null,
  payloadSummary: r.payload_summary as string, grantId: (r.grant_id as string) ?? null,
  grantVersion: (r.grant_version as number) ?? null, sourceUtterance: (r.source_utterance as string) ?? null,
 }));
}

/* ---------------- decision log (Stage 5) ---------------- */

export async function writeDecisionLog(db: DB, input: {
 tenantId: string; runId: string; questionIds: string[]; answers: Record<string, unknown>; confidences: Record<string, number>;
 bandOutcome: 'auto' | 'review' | 'hold' | 'unavailable'; thresholdProfile: string; model: string | null;
 latencyMs: number | null; costMicrocents: number | null; stateHash: string;
}): Promise<string> {
 const id = crypto.randomUUID();
 await db.prepare(`INSERT INTO mayor_decision_log(decision_id,tenant_id,run_id,question_ids_json,answers_json,confidences_json,band_outcome,threshold_profile,model,latency_ms,cost_microcents,state_hash,created_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .bind(id, input.tenantId, input.runId, JSON.stringify(input.questionIds), JSON.stringify(input.answers), JSON.stringify(input.confidences), input.bandOutcome, input.thresholdProfile, input.model, input.latencyMs, input.costMicrocents, input.stateHash, nowISO()).run();
 return id;
}

/* ---------------- memory objects (§1.4) ---------------- */

export async function insertMemoryObject(db: DB, o: Omit<MemoryObject, 'id' | 'createdAt' | 'version'> & { version?: number; supersedesId?: string }): Promise<MemoryObject> {
 const obj: MemoryObject = { ...o, id: crypto.randomUUID(), version: o.version ?? 1, createdAt: nowISO() };
 await db.prepare(`INSERT INTO mayor_memory_objects(id,tenant_id,type,version,status,payload_json,confidence_tier,provenance_json,created_at,last_confirmed_at,decay_class,supersedes_id)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
  .bind(obj.id, obj.tenantId, obj.type, obj.version, obj.status, JSON.stringify(obj.payload), obj.confidenceTier, JSON.stringify(obj.provenance), obj.createdAt, obj.confidenceTier === 'owner_confirmed' ? obj.createdAt : null, obj.decayClass, o.supersedesId ?? null).run();
 return obj;
}

function rowToMemory(r: Record<string, unknown>): MemoryObject {
 return {
  id: r.id as string, tenantId: r.tenant_id as string, type: r.type as MemoryObject['type'], version: r.version as number,
  status: r.status as MemoryObject['status'], payload: parse(r.payload_json as string, {}),
  confidenceTier: r.confidence_tier as MemoryObject['confidenceTier'], provenance: parse(r.provenance_json as string, { sourceKind: 'conversation_observed' }),
  createdAt: r.created_at as string, decayClass: r.decay_class as string,
 };
}

export async function listMemoryObjects(db: DB, tenantId: string, type?: MemoryObject['type'], status: MemoryObject['status'] = 'active'): Promise<MemoryObject[]> {
 const rows = type
  ? await db.prepare('SELECT * FROM mayor_memory_objects WHERE tenant_id=? AND type=? AND status=? ORDER BY created_at ASC').bind(tenantId, type, status).all<Record<string, unknown>>()
  : await db.prepare('SELECT * FROM mayor_memory_objects WHERE tenant_id=? AND status=? ORDER BY created_at ASC').bind(tenantId, status).all<Record<string, unknown>>();
 return rows.results.map(rowToMemory);
}

/** A correction versions the object: the old row is superseded, the
 * new fact is live in the same turn (§1.4 learning rule 1). */
export async function supersedeMemoryObject(db: DB, tenantId: string, oldId: string): Promise<void> {
 await db.prepare(`UPDATE mayor_memory_objects SET status='superseded' WHERE tenant_id=? AND id=?`).bind(tenantId, oldId).run();
}

/** Owner-directed forgetting: tombstone + payload purge in the same
 * statement (§1.4.2) — the object can never be read back. */
export async function forgetMemoryObject(db: DB, tenantId: string, id: string): Promise<void> {
 await db.prepare(`UPDATE mayor_memory_objects SET status='forgotten',payload_json='{}' WHERE tenant_id=? AND id=?`).bind(tenantId, id).run();
 await db.prepare('DELETE FROM mayor_memory_edges WHERE tenant_id=? AND (from_id=? OR to_id=?)').bind(tenantId, id, id).run();
}

/* ---------------- engine state + suggestions ---------------- */

export interface EngineState {
 tenantId: string; mode: 'onboarding' | 'supervised' | 'talk';
 onboarding: Record<string, unknown>; costPeriod: string; costMicrocents: number;
 costCeilingMicrocents: number; anonymous: boolean; claimedAt: string | null; createdAt: string;
}

export async function getEngineState(db: DB, tenantId: string, defaults: { costCeilingMicrocents: number; anonymous?: boolean }): Promise<EngineState> {
 const row = await db.prepare('SELECT * FROM mayor_engine_state WHERE tenant_id=?').bind(tenantId).first<Record<string, unknown>>();
 if (row) return {
  tenantId, mode: row.mode as EngineState['mode'], onboarding: parse(row.onboarding_json as string, {}),
  costPeriod: row.cost_period as string, costMicrocents: row.cost_microcents as number,
  costCeilingMicrocents: row.cost_ceiling_microcents as number, anonymous: (row.anonymous as number) === 1,
  claimedAt: (row.claimed_at as string) ?? null, createdAt: row.created_at as string,
 };
 const period = new Date().toISOString().slice(0, 7);
 await db.prepare('INSERT INTO mayor_engine_state(tenant_id,mode,onboarding_json,cost_period,cost_microcents,cost_ceiling_microcents,anonymous,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
  .bind(tenantId, 'onboarding', '{}', period, 0, defaults.costCeilingMicrocents, defaults.anonymous ? 1 : 0, nowISO(), nowISO()).run();
 return { tenantId, mode: 'onboarding', onboarding: {}, costPeriod: period, costMicrocents: 0, costCeilingMicrocents: defaults.costCeilingMicrocents, anonymous: !!defaults.anonymous, claimedAt: null, createdAt: nowISO() };
}

export async function saveEngineState(db: DB, s: EngineState): Promise<void> {
 await db.prepare('UPDATE mayor_engine_state SET mode=?,onboarding_json=?,cost_period=?,cost_microcents=?,cost_ceiling_microcents=?,anonymous=?,claimed_at=?,updated_at=? WHERE tenant_id=?')
  .bind(s.mode, JSON.stringify(s.onboarding), s.costPeriod, s.costMicrocents, s.costCeilingMicrocents, s.anonymous ? 1 : 0, s.claimedAt, nowISO(), s.tenantId).run();
}

export async function recordSuggestionApproval(db: DB, tenantId: string, actionClass: string): Promise<void> {
 /* NEVER_LIVE fence (§3.3): approvals of the CashText send classes are
  * NEVER counted — no number of approved invoices can ever make the
  * suggestion machinery propose standing send authority. */
 if (isNeverLiveActionClass(actionClass)) return;
 await db.prepare(`INSERT INTO mayor_grant_suggestions(tenant_id,action_class,approvals,proposed_count,updated_at) VALUES(?,?,1,0,?)
  ON CONFLICT(tenant_id,action_class) DO UPDATE SET approvals=approvals+1,updated_at=excluded.updated_at`).bind(tenantId, actionClass, nowISO()).run();
}

export async function getSuggestion(db: DB, tenantId: string, actionClass: string): Promise<{ approvals: number; proposedCount: number; suppressedUntil: string | null } | null> {
 const row = await db.prepare('SELECT * FROM mayor_grant_suggestions WHERE tenant_id=? AND action_class=?').bind(tenantId, actionClass).first<Record<string, unknown>>();
 if (!row) return null;
 return { approvals: row.approvals as number, proposedCount: row.proposed_count as number, suppressedUntil: (row.suppressed_until as string) ?? null };
}

export async function markSuggestionProposed(db: DB, tenantId: string, actionClass: string): Promise<void> {
 await db.prepare(`INSERT INTO mayor_grant_suggestions(tenant_id,action_class,approvals,proposed_count,updated_at) VALUES(?,?,0,1,?)
  ON CONFLICT(tenant_id,action_class) DO UPDATE SET proposed_count=proposed_count+1,updated_at=excluded.updated_at`).bind(tenantId, actionClass, nowISO()).run();
}

export async function recordSuggestionProposal(db: DB, tenantId: string, actionClass: string, declined: boolean): Promise<void> {
 /* Records the owner's answer to a proposal. A decline stamps the
  * 30-day suppression ONLY — proposed_count counts proposals made
  * (markSuggestionProposed), never answers. */
 await db.prepare(`UPDATE mayor_grant_suggestions SET suppressed_until=?,updated_at=? WHERE tenant_id=? AND action_class=?`)
  .bind(declined ? new Date(Date.now() + 30 * 86400_000).toISOString() : null, nowISO(), tenantId, actionClass).run();
}
