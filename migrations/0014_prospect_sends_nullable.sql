-- Migration 0014: rebuild prospect_sends with nullable prospect_id
--
-- The previous migration (0013) added sam_id to prospect_drafts but the
-- prospect_sends rebuild failed (transient wrangler/D1 error). Split into a
-- fresh migration so it can be applied independently.

CREATE TABLE IF NOT EXISTS prospect_sends_new (
  id TEXT PRIMARY KEY,
  prospect_id TEXT,
  draft_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  scheduled_for TEXT,
  attempted_at TEXT,
  finished_at TEXT,
  provider TEXT NOT NULL DEFAULT 'resend',
  provider_id TEXT,
  to_email TEXT NOT NULL,
  from_email TEXT NOT NULL,
  reply_to TEXT,
  status TEXT NOT NULL DEFAULT 'queued_for_review',
  channel TEXT NOT NULL DEFAULT 'email',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (draft_id) REFERENCES prospect_drafts(id)
);

INSERT OR IGNORE INTO prospect_sends_new
  (id, prospect_id, draft_id, created_at, scheduled_for, attempted_at, finished_at,
   provider, provider_id, to_email, from_email, reply_to, status, channel, updated_at)
SELECT id, prospect_id, draft_id, created_at, scheduled_for, attempted_at, finished_at,
       provider, provider_id, to_email, from_email, reply_to,
       CASE WHEN finished_at IS NOT NULL THEN 'sent' ELSE 'queued_for_review' END,
       'email', created_at
FROM prospect_sends;

DROP TABLE IF EXISTS prospect_sends;

ALTER TABLE prospect_sends_new RENAME TO prospect_sends;

CREATE INDEX IF NOT EXISTS idx_prospect_sends_status ON prospect_sends(status);
CREATE INDEX IF NOT EXISTS idx_prospect_sends_draft ON prospect_sends(draft_id);
CREATE INDEX IF NOT EXISTS idx_prospect_sends_scheduled ON prospect_sends(scheduled_for);
