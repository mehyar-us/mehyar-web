-- Migration 0018: repair admin runtime schema drift.
--
-- Fixes production drift observed on 2026-07-26:
-- - reply_classifications was created from 0011 with a missing comma after
--   reviewed_at, so action_taken did not exist as a column.
-- - prospect_sends missed the channel column expected by /api/admin/mayor/sent.
-- - prospect_replies missed owner triage columns used by mark-handled.

ALTER TABLE prospect_sends ADD COLUMN channel TEXT NOT NULL DEFAULT 'email';
ALTER TABLE prospect_sends ADD COLUMN updated_at TEXT;

ALTER TABLE prospect_replies ADD COLUMN needs_action INTEGER NOT NULL DEFAULT 1;
ALTER TABLE prospect_replies ADD COLUMN handled_at TEXT;

CREATE TABLE IF NOT EXISTS reply_classifications_repaired (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  reply_id TEXT NOT NULL,
  prospect_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'unclassified',
  confidence REAL NOT NULL DEFAULT 0,
  classified_by TEXT NOT NULL DEFAULT 'system',
  classifier_version TEXT NOT NULL DEFAULT '',
  review_notes TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  action_taken TEXT NOT NULL DEFAULT 'none',
  UNIQUE(reply_id)
);

INSERT OR IGNORE INTO reply_classifications_repaired
  (id, created_at, updated_at, reply_id, prospect_id, label, confidence,
   classified_by, classifier_version, review_notes, reviewed_at, action_taken)
SELECT
  id, created_at, updated_at, reply_id, prospect_id, label, confidence,
  classified_by, classifier_version, review_notes,
  CASE WHEN reviewed_at = 'none' THEN NULL ELSE reviewed_at END,
  'none'
FROM reply_classifications;

DROP TABLE reply_classifications;
ALTER TABLE reply_classifications_repaired RENAME TO reply_classifications;

CREATE INDEX IF NOT EXISTS idx_reply_classifications_reply ON reply_classifications(reply_id);
CREATE INDEX IF NOT EXISTS idx_reply_classifications_prospect ON reply_classifications(prospect_id);
CREATE INDEX IF NOT EXISTS idx_reply_classifications_label ON reply_classifications(label);
CREATE INDEX IF NOT EXISTS idx_prospect_replies_needs_action ON prospect_replies(needs_action, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_prospect_replies_send_id ON prospect_replies(send_id);
CREATE INDEX IF NOT EXISTS idx_prospect_sends_created_at_desc ON prospect_sends(created_at DESC);
