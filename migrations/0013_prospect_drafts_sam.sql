-- Migration 0013: extend prospect_drafts + prospect_sends for SAM-led drafts
--
-- Adds columns so /api/admin/leads/draft-from-eval can save outreach drafts
-- that originated from a SAM.gov opportunity (not just a prospect row).
-- Also adds payload_json audit column on prospect_drafts so we can capture
-- the tier/service context that seeded the draft.

ALTER TABLE prospect_drafts ADD COLUMN sam_id TEXT;
ALTER TABLE prospect_drafts ADD COLUMN payload_json TEXT;

-- prospect_sends: allow NULL prospect_id for SAM-only drafts (where we
-- generated a prospect stub from the SAM lead). The original schema has
-- NOT NULL — change to allow nullable.
-- SQLite cannot DROP NOT NULL via ALTER. We create a new table to migrate.
-- (No existing rows, so this is safe.)

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

DROP TABLE prospect_sends;
ALTER TABLE prospect_sends_new RENAME TO prospect_sends;

CREATE INDEX IF NOT EXISTS idx_prospect_sends_status ON prospect_sends(status);
CREATE INDEX IF NOT EXISTS idx_prospect_sends_draft ON prospect_sends(draft_id);
CREATE INDEX IF NOT EXISTS idx_prospect_sends_scheduled ON prospect_sends(scheduled_for);

-- opportunity_events: allow null prospect_id (some events are SAM-only)
-- Already nullable, but verify
-- (no-op)

-- Also: extend gov_opportunities with a column to track outreach draft linkage
ALTER TABLE gov_opportunities ADD COLUMN last_draft_id TEXT;
ALTER TABLE gov_opportunities ADD COLUMN last_drafted_at TEXT;
