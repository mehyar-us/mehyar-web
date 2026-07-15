-- Migration 0016 — ensure cron_runs table exists with proper schema
-- The cron handlers create this on the fly via CREATE TABLE IF NOT EXISTS,
-- but a real migration prevents drift and makes it visible in `wrangler d1 migrations list`.

CREATE TABLE IF NOT EXISTS cron_runs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_name_created ON cron_runs (name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_runs_created ON cron_runs (created_at DESC);