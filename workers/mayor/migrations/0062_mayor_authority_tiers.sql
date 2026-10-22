-- 0062: P1 authority tiers — owner-settable per-action-type authority
-- (readonly → draft → auto). Additive only. One row per (tenant, action);
-- no row means the default tier ('draft'). Auto is never the default.
CREATE TABLE IF NOT EXISTS mayor_authority_tiers (
 tenant_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('booking','textback','call','suggestion_send')),
 tier TEXT NOT NULL CHECK(tier IN ('readonly','draft','auto')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY (tenant_id, action)
);
CREATE INDEX IF NOT EXISTS idx_authority_tiers_tenant ON mayor_authority_tiers(tenant_id);
