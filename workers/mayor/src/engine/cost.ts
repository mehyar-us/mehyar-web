/**
 * engine/cost.ts — §8.6 anonymous-tenant economics, implemented as
 * the WORKING DEFAULT pending the Mayor's ruling (flagged in the
 * Slice 2 report): unclaimed anonymous tenants are reaped at 30
 * days, and each tenant carries a monthly model-cost ceiling with
 * the §1.1 fence behavior — at 70% shed the largest tier, at 90%
 * proactive drafting drops to templates, at 100% only deterministic
 * acts + prepare-and-ask continue. A cost fence never becomes a
 * missed customer: the phone is still answered (Slice 4), and in
 * this slice deterministic turns + prepare-and-ask always continue.
 *
 * Unit: microcents — 1 cent = 1,000,000 microcents. The default
 * ceiling is 2,500,000,000 microcents ($25/mo of model spend per
 * tenant) — an internal spend fence on OUR costs; it never bills
 * the owner.
 */
import type {EngineState} from './store';
import {getEngineState,saveEngineState} from './store';

export const DEFAULT_COST_CEILING_MICROCENTS = 2_500_000_000;
export const ANONYMOUS_REAPER_DAYS = 30;

export function currentPeriod(now = new Date()): string { return now.toISOString().slice(0, 7); }

/** Meter a cost against the tenant's monthly envelope (rolls the
 * period over on first touch of a new month). */
export async function meterCost(db: D1Database, tenantId: string, microcents: number): Promise<EngineState> {
 const state = await getEngineState(db, tenantId, { costCeilingMicrocents: DEFAULT_COST_CEILING_MICROCENTS });
 const period = currentPeriod();
 if (state.costPeriod !== period) { state.costPeriod = period; state.costMicrocents = 0; }
 state.costMicrocents += Math.max(0, Math.round(microcents));
 await saveEngineState(db, state);
 return state;
}

export interface CostFence { level: 0 | 70 | 90 | 100; shedLargestTier: boolean; proactiveTemplatesOnly: boolean; deterministicOnly: boolean; }

export function fenceFor(state: EngineState): CostFence {
 const pct = state.costCeilingMicrocents > 0 ? (state.costMicrocents / state.costCeilingMicrocents) * 100 : 100;
 if (pct >= 100) return { level: 100, shedLargestTier: true, proactiveTemplatesOnly: true, deterministicOnly: true };
 if (pct >= 90) return { level: 90, shedLargestTier: true, proactiveTemplatesOnly: true, deterministicOnly: false };
 if (pct >= 70) return { level: 70, shedLargestTier: true, proactiveTemplatesOnly: false, deterministicOnly: false };
 return { level: 0, shedLargestTier: false, proactiveTemplatesOnly: false, deterministicOnly: false };
}

/** The 30-day reaper: anonymous, never-claimed engine tenants older
 * than the window lose their engine state — grants, memory, logs,
 * all of it. Claimed tenants and anything younger are untouched, and
 * no other tenant's rows can be selected: every delete binds the
 * reaped tenant's own id. */
export async function reapAnonymousTenants(db: D1Database, now = new Date()): Promise<string[]> {
 const cutoff = new Date(now.getTime() - ANONYMOUS_REAPER_DAYS * 86400_000).toISOString();
 const rows = await db.prepare('SELECT tenant_id FROM mayor_engine_state WHERE anonymous=1 AND claimed_at IS NULL AND created_at<?').bind(cutoff).all<{ tenant_id: string }>();
 const reaped: string[] = [];
 for (const { tenant_id } of rows.results) {
  await db.batch([
   db.prepare('DELETE FROM mayor_engine_envelopes WHERE tenant_id=?').bind(tenant_id),
   db.prepare('DELETE FROM mayor_probe_scenarios WHERE tenant_id=?').bind(tenant_id),
   db.prepare('DELETE FROM mayor_probe_sets WHERE tenant_id=?').bind(tenant_id),
   db.prepare('DELETE FROM mayor_grants WHERE tenant_id=?').bind(tenant_id),
   db.prepare('DELETE FROM mayor_prepared_actions WHERE tenant_id=?').bind(tenant_id),
   db.prepare('DELETE FROM mayor_action_log WHERE tenant_id=?').bind(tenant_id),
   db.prepare('DELETE FROM mayor_decision_log WHERE tenant_id=?').bind(tenant_id),
   db.prepare('DELETE FROM mayor_memory_edges WHERE tenant_id=?').bind(tenant_id),
   db.prepare('DELETE FROM mayor_memory_objects WHERE tenant_id=?').bind(tenant_id),
   db.prepare('DELETE FROM mayor_grant_suggestions WHERE tenant_id=?').bind(tenant_id),
   db.prepare('DELETE FROM mayor_engine_state WHERE tenant_id=?').bind(tenant_id),
  ]);
  reaped.push(tenant_id);
 }
 return reaped;
}
