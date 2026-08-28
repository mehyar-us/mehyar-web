-- Complete client metadata plus durable, revisioned AI sales proposals.

ALTER TABLE leads ADD COLUMN metadata_json TEXT;
ALTER TABLE appointments ADD COLUMN request_metadata_json TEXT;
ALTER TABLE appointments ADD COLUMN provider_metadata_json TEXT;

CREATE TABLE IF NOT EXISTS sales_proposals (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  workflow_instance_id TEXT,
  source_url TEXT NOT NULL,
  business_name TEXT,
  industry TEXT,
  location TEXT,
  title TEXT,
  subtitle TEXT,
  visibility TEXT NOT NULL DEFAULT 'unlisted',
  current_revision_id TEXT,
  hero_asset_key TEXT,
  source_snapshot_json TEXT,
  generation_metadata_json TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_sales_proposals_updated
  ON sales_proposals(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_proposals_status
  ON sales_proposals(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS sales_proposal_revisions (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  parent_revision_id TEXT,
  revision_number INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  instruction TEXT,
  content_json TEXT NOT NULL,
  source_context_json TEXT,
  model TEXT,
  image_model TEXT,
  gateway_id TEXT,
  gateway_log_id TEXT,
  generation_metadata_json TEXT,
  FOREIGN KEY (proposal_id) REFERENCES sales_proposals(id),
  FOREIGN KEY (parent_revision_id) REFERENCES sales_proposal_revisions(id),
  UNIQUE (proposal_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_sales_proposal_revisions_proposal
  ON sales_proposal_revisions(proposal_id, revision_number DESC);

CREATE TABLE IF NOT EXISTS sales_proposal_jobs (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  workflow_instance_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  current_step TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'create',
  instruction TEXT,
  error TEXT,
  metadata_json TEXT,
  FOREIGN KEY (proposal_id) REFERENCES sales_proposals(id)
);

CREATE INDEX IF NOT EXISTS idx_sales_proposal_jobs_proposal
  ON sales_proposal_jobs(proposal_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sales_proposal_assets (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  revision_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  alt_text TEXT,
  prompt TEXT,
  model TEXT,
  width INTEGER,
  height INTEGER,
  FOREIGN KEY (proposal_id) REFERENCES sales_proposals(id),
  FOREIGN KEY (revision_id) REFERENCES sales_proposal_revisions(id)
);

CREATE INDEX IF NOT EXISTS idx_sales_proposal_assets_proposal
  ON sales_proposal_assets(proposal_id, created_at DESC);
