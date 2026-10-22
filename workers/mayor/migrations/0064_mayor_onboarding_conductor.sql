-- RECOVERED-RECORD — documentation-grade reconstruction, Slice 0 (2026-10-21).
-- Applied to production (recorded in production's d1_migrations) but its
-- file existed in NO repo. The DDL below was recovered verbatim from
-- production's live schema (sqlite_master) on 2026-10-21.
-- Attribution: mayor_onboarding_state + idx_onboarding_state_phase are
-- this file's by name. mayor_gbp_snapshot is attributed here by theme and
-- elimination (the onboarding conductor imports the shop's Google
-- Business Profile snapshot; the remaining unrecovered file, 0066, is
-- payment connections) — flagged as inferred in the Slice 0 report.
CREATE TABLE mayor_onboarding_state (
 tenant_id TEXT PRIMARY KEY,
 phase TEXT NOT NULL DEFAULT 'identify' CHECK(phase IN ('identify','learn','connect','rules','handoff','done')),
 skipped_connections TEXT NOT NULL DEFAULT '[]',
 rules_decision TEXT CHECK(rules_decision IS NULL OR rules_decision IN ('defaults')),
 missing_vertical TEXT,
 handoff_at TEXT,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_onboarding_state_phase ON mayor_onboarding_state(phase);
CREATE TABLE mayor_gbp_snapshot (
 tenant_id TEXT PRIMARY KEY REFERENCES agent_tenants(id),
 grant_id TEXT NOT NULL,
 snapshot_json TEXT NOT NULL,
 fetched_at TEXT NOT NULL
);
