-- Harness rebuild slice 1 (2026-10-17): per-tenant runtime flag lives
-- in mayor_memory (field 'harness_runtime'); this migration adds the
-- findings table the CoC cadence ruling requires — when a tenant's
-- daily ranking budget is exhausted, ranking queues and the breach
-- is logged here as product signal (never an account-wide outage).
-- One finding per tenant per day per kind, enforced by the unique
-- index + INSERT OR IGNORE at the write site.
CREATE TABLE IF NOT EXISTS mayor_harness_findings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_harness_findings_dedupe
  ON mayor_harness_findings (tenant_id, day, kind);
CREATE INDEX IF NOT EXISTS idx_harness_findings_tenant
  ON mayor_harness_findings (tenant_id, created_at);
