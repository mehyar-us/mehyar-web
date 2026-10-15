-- 0070_connector_learning.sql — One Connector Phase 2 (2026-10-15): the
-- learning loop. Recipes gain a lifecycle state (learned recipes land as
-- 'draft' and are promoted by the first verified live connection);
-- telemetry events record which method produced the outcome (the input
-- to automatic method demotion); research requests queue platforms the
-- catalog cannot yet connect, for the crew's docs-research pass.
ALTER TABLE connector_recipes ADD COLUMN state TEXT NOT NULL DEFAULT 'promoted';
ALTER TABLE connector_recipe_events ADD COLUMN method_kind TEXT;
CREATE TABLE IF NOT EXISTS connector_research_requests(
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  tenant_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_service ON connector_research_requests(service, status);
