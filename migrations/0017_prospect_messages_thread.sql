-- Migration 0017: prospect_messages — single source-of-truth email thread table
-- ------------------------------------------------------------------------------
-- Goal: full observability of every email sent or received for every prospect,
-- in a form the admin UI can render as a real Gmail-style thread.
--
-- Replaces the implicit ambiguity between:
--   prospect_sends  (intended to record sends, but FK-on-draft_id blocks inserts)
--   prospect_replies(intended to record inbound, but is empty)
--   reply_classifications (LLM labels, kind-of-filled in some paths)
--   mayor_events    (immutable audit log of mayor loop outcomes)
--
-- One row per email. direction tells you if we sent it or they sent it.
-- The mayor engine keeps writing prospect_sends (for back-compat) and ALSO
-- inserts into prospect_messages. The admin UI reads prospect_messages only.

CREATE TABLE IF NOT EXISTS prospect_messages (
  id TEXT PRIMARY KEY,
  prospect_id TEXT,           -- nullable: SAM-led drafts have NULL prospect_id (cf. migration 0014)
  lead_kind TEXT,             -- 'prospect' | 'sam' | NULL
  thread_id TEXT,             -- groups multiple messages into one conversation; same as parent.id or first-message.id
  parent_id TEXT,             -- the immediate message being replied to, NULL for root
  direction TEXT NOT NULL,    -- 'outbound' | 'inbound'
  -- Identity
  message_id_header TEXT,     -- RFC 5322 Message-ID header, used for dedupe + thread linking
  from_email TEXT NOT NULL,
  to_email TEXT NOT NULL,
  cc_emails TEXT,             -- newline-separated
  reply_to TEXT,
  subject TEXT NOT NULL,
  -- Body
  body_text TEXT,
  body_html TEXT,
  body_excerpt TEXT,          -- first ~280 chars for previews
  -- Provider
  provider TEXT,              -- 'cf-email' | 'resend' | 'manual' | 'inbound'
  provider_id TEXT,           -- CF message_id or Resend id
  status TEXT NOT NULL DEFAULT 'queued',
                            -- 'queued' | 'sent' | 'delivered' | 'bounced' | 'failed'
                            --      | 'received' | 'auto-replied' | 'classified'
  failure_reason TEXT,
  -- Soft edges
  sequence_id TEXT,           -- which prospect_sequences.id this is part of
  draft_id TEXT,
  step_no INTEGER,            -- 1, 2, 3
  classification TEXT,        -- 'interested' | 'objection' | 'unsubscribe' | ...
  confidence REAL,
  recommended_action TEXT,
  -- Timestamps
  queued_at TEXT DEFAULT (datetime('now')),
  sent_at TEXT,
  delivered_at TEXT,
  received_at TEXT,
  bounce_at TEXT,
  classified_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pm_prospect ON prospect_messages(prospect_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pm_thread   ON prospect_messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pm_message_id ON prospect_messages(message_id_header);
CREATE INDEX IF NOT EXISTS idx_pm_seq      ON prospect_messages(sequence_id);
CREATE INDEX IF NOT EXISTS idx_pm_status   ON prospect_messages(status);
CREATE INDEX IF NOT EXISTS idx_pm_direction ON prospect_messages(direction, created_at DESC);
