-- Workstream 7c: AI post-generation drafts (mayor_post_drafts).
-- Drafts only — nothing here publishes. Publishing belongs to the
-- calendar/connector layers, which reference drafts by id.
-- The integrator consolidates this into the numbered migration series.
CREATE TABLE IF NOT EXISTS mayor_post_drafts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  post_type TEXT NOT NULL,
  topic TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  body_text TEXT NOT NULL DEFAULT '',
  review_text TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  -- Owner-supplied facts at generation time (offerDetails, scarcity) so an
  -- edit re-scans compliance against the original facts.
  facts_json TEXT NOT NULL DEFAULT '{}',
  compliance_flags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mayor_post_drafts_tenant
  ON mayor_post_drafts(tenant_id, updated_at DESC, id DESC);
