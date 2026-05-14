-- Government opportunity intelligence tables for daily USAspending/SAM.gov ingest.
-- Apply remotely:
--   npx wrangler d1 migrations apply mehyar_leads_prod --remote

CREATE TABLE IF NOT EXISTS gov_opportunities (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_url TEXT,
  title TEXT NOT NULL,
  agency TEXT,
  office TEXT,
  opportunity_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  posted_date TEXT,
  response_deadline TEXT,
  estimated_value REAL,
  set_aside TEXT,
  naics_codes_json TEXT NOT NULL DEFAULT '[]',
  summary TEXT,
  fit_score INTEGER NOT NULL DEFAULT 0,
  confidence TEXT NOT NULL DEFAULT 'low',
  why_fit TEXT,
  why_not_fit TEXT,
  next_action TEXT,
  owner_notes TEXT,
  raw_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gov_opportunities_source ON gov_opportunities(source, source_id);
CREATE INDEX IF NOT EXISTS idx_gov_opportunities_status_score ON gov_opportunities(status, fit_score DESC);
CREATE INDEX IF NOT EXISTS idx_gov_opportunities_deadline ON gov_opportunities(response_deadline);
CREATE INDEX IF NOT EXISTS idx_gov_opportunities_updated ON gov_opportunities(updated_at);

CREATE TABLE IF NOT EXISTS gov_opportunity_events (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system',
  metadata_json TEXT,
  FOREIGN KEY (opportunity_id) REFERENCES gov_opportunities(id)
);

CREATE INDEX IF NOT EXISTS idx_gov_opportunity_events_opp ON gov_opportunity_events(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_gov_opportunity_events_type ON gov_opportunity_events(event_type);
CREATE INDEX IF NOT EXISTS idx_gov_opportunity_events_created ON gov_opportunity_events(created_at);

CREATE TABLE IF NOT EXISTS gov_opportunity_ingest_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  sources_json TEXT,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  error_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_gov_opportunity_ingest_runs_started ON gov_opportunity_ingest_runs(started_at);

CREATE TABLE IF NOT EXISTS gov_opportunity_documents (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT,
  document_type TEXT,
  captured_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata_json TEXT,
  FOREIGN KEY (opportunity_id) REFERENCES gov_opportunities(id)
);

CREATE TABLE IF NOT EXISTS gov_application_workspaces (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL UNIQUE,
  checklist_json TEXT NOT NULL DEFAULT '[]',
  outline_markdown TEXT,
  questions_markdown TEXT,
  owner_review_status TEXT NOT NULL DEFAULT 'not_started',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (opportunity_id) REFERENCES gov_opportunities(id)
);

CREATE TABLE IF NOT EXISTS gov_capability_blocks (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  block_type TEXT NOT NULL,
  content_markdown TEXT NOT NULL,
  owner_only INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gov_agency_watchlist (
  id TEXT PRIMARY KEY,
  agency TEXT NOT NULL,
  office TEXT,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  recent_signal_count INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT,
  next_monitoring_action TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
