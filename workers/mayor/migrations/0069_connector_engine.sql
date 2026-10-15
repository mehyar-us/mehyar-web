-- 0069_connector_engine.sql — One Connector (2026-10-15): the recipe
-- catalog (learned recipes land here in Phase 2), connect sessions (the
-- single state machine every UI renders), and recipe telemetry that the
-- learning loop revises from. Credentials are NEVER stored here — they
-- stay in the existing OAuth grant store and the custom-connector vault.
CREATE TABLE IF NOT EXISTS connector_recipes(
  service TEXT PRIMARY KEY,
  recipe_json TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'learned',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mayor_connector_sessions(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  service TEXT NOT NULL,
  method_index INTEGER NOT NULL DEFAULT 0,
  method_kind TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'offered',
  failure_kind TEXT,
  connection_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_connector_sessions_tenant ON mayor_connector_sessions(tenant_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS connector_recipe_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT,
  service TEXT NOT NULL,
  version INTEGER,
  outcome TEXT NOT NULL,
  failure_kind TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recipe_events_service ON connector_recipe_events(service, created_at DESC);
