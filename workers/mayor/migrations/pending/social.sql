-- pending/social: Workstream 7a — social connectors (Instagram, Facebook, TikTok, X).
-- Additive only. Integrator consolidates into the next numbered migration.
-- One connection per provider per (tenant_id, user_id); OAuth tokens are sealed
-- with the mayor-social-connection custody domain, never stored in plaintext.
-- Publish records carry HONEST statuses only: draft/scheduled/sent/failed/test_simulated.
-- A record is 'sent' only when a real provider accepted the post.

CREATE TABLE IF NOT EXISTS mayor_social_connections (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('instagram','facebook','tiktok','x')),
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK(status IN ('pending','connected','error','disconnected')),
  ciphertext TEXT NOT NULL DEFAULT '',
  has_secret INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT,
  last_check_status TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(tenant_id, user_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_social_connections_tenant
  ON mayor_social_connections(tenant_id, user_id, status);

CREATE TABLE IF NOT EXISTS mayor_social_publish_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES mayor_social_connections(id),
  provider TEXT NOT NULL CHECK(provider IN ('instagram','facebook','tiktok','x')),
  caption TEXT NOT NULL DEFAULT '',
  media_url TEXT,
  status TEXT NOT NULL
    CHECK(status IN ('draft','scheduled','sent','failed','test_simulated')),
  provider_post_id TEXT,
  error_code TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_social_publish_records_connection
  ON mayor_social_publish_records(connection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_publish_records_tenant
  ON mayor_social_publish_records(tenant_id, user_id, created_at DESC);
