-- 0064: P4 Chief of Staff onboarding conductor — per-tenant phase state.
-- Additive only. Phase COMPLETION is derived from ground truth (profile
-- facts, real connection grants, explicit authority tiers); this row stores
-- only what cannot be derived: the owner's skip decisions, the "use the
-- defaults" rules decision, the missing-vertical signal, and when the
-- hand-off summary was delivered. A skipped connection is never stored as
-- connected — connection status is always read from the real grants.
CREATE TABLE IF NOT EXISTS mayor_onboarding_state (
 tenant_id TEXT PRIMARY KEY,
 phase TEXT NOT NULL DEFAULT 'identify' CHECK(phase IN ('identify','learn','connect','rules','handoff','done')),
 skipped_connections TEXT NOT NULL DEFAULT '[]',
 rules_decision TEXT CHECK(rules_decision IS NULL OR rules_decision IN ('defaults')),
 missing_vertical TEXT,
 handoff_at TEXT,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_onboarding_state_phase ON mayor_onboarding_state(phase);
