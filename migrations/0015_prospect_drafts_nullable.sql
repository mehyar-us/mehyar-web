-- Migration 0015: prospect_drafts.prospect_id becomes nullable
--
-- Allows SAM-only drafts (where there's no prospect row yet). The endpoint
-- also adds sam_id. SQLite cannot DROP NOT NULL via ALTER, so we rebuild.

CREATE TABLE IF NOT EXISTS prospect_drafts_new (
  id TEXT PRIMARY KEY,
  prospect_id TEXT,                                  -- now nullable
  sam_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  generated_by TEXT NOT NULL DEFAULT 'manual',
  model TEXT,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT,
  cited_signals_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  reviewer_notes TEXT,
  payload_json TEXT,
  FOREIGN KEY (prospect_id) REFERENCES prospects(id)
);

INSERT OR IGNORE INTO prospect_drafts_new
  (id, prospect_id, sam_id, created_at, updated_at, generated_by, model,
   subject, body_text, body_html, cited_signals_json, status, reviewer_notes, payload_json)
SELECT id, prospect_id, sam_id, created_at, COALESCE(updated_at, created_at),
       generated_by, model, subject, body_text, body_html, cited_signals_json,
       status, reviewer_notes, payload_json
FROM prospect_drafts;

DROP TABLE IF EXISTS prospect_drafts;
ALTER TABLE prospect_drafts_new RENAME TO prospect_drafts;

CREATE INDEX IF NOT EXISTS idx_prospect_drafts_prospect ON prospect_drafts(prospect_id);
CREATE INDEX IF NOT EXISTS idx_prospect_drafts_sam ON prospect_drafts(sam_id);
CREATE INDEX IF NOT EXISTS idx_prospect_drafts_status ON prospect_drafts(status);
