-- Harness slice 2 (the twin, 2026-10-17): the per-tenant style
-- corpus. Samples are the owner's OWN words, captured as a side
-- effect of actions they already take (editing a suggestion card,
-- the onboarding "Say it your way" step). Corpora never mix across
-- tenants — every read and write is tenant-scoped.
CREATE TABLE IF NOT EXISTS mayor_style_samples (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  source TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_style_samples_tenant
  ON mayor_style_samples (tenant_id, created_at DESC);
