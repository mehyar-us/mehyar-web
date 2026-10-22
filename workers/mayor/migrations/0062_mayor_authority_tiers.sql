-- RECOVERED-RECORD — documentation-grade reconstruction, Slice 0 (2026-10-21).
-- This migration was applied to production (recorded in production's
-- d1_migrations table) but its file existed in NO repo. The DDL below was
-- recovered verbatim from production's live schema (sqlite_master) on
-- 2026-10-21 and is committed as the record of what production ran.
-- It is NOT a new migration: production already has this name recorded,
-- and a from-scratch build needs it to reach schema identity with
-- production at level 0075 (proof: reinvention-slice0 report).
CREATE TABLE mayor_authority_tiers (
 tenant_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('booking','textback','call','suggestion_send')),
 tier TEXT NOT NULL CHECK(tier IN ('readonly','draft','auto')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY (tenant_id, action)
);
CREATE INDEX idx_authority_tiers_tenant ON mayor_authority_tiers(tenant_id);
