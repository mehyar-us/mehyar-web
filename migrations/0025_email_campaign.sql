-- 0025_email_campaign.sql — warmup campaign tracking for mehyar.us audit product.
-- Campaign audience is copied from the screened legacy Gmail cohort.
-- Tracking secret lives in D1 (sender mints URLs, endpoints verify from D1).

CREATE TABLE IF NOT EXISTS email_campaign (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT 'mehyar.us',
  secret TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS email_audience (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES email_campaign(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  first_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(campaign_id, email)
);
CREATE INDEX IF NOT EXISTS idx_audience_status ON email_audience(campaign_id, status);

CREATE TABLE IF NOT EXISTS email_send_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES email_campaign(id) ON DELETE CASCADE,
  audience_id INTEGER NOT NULL REFERENCES email_audience(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'smtp2go',
  provider_msg_id TEXT,
  sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_sendlog_campaign ON email_send_log(campaign_id);

CREATE TABLE IF NOT EXISTS email_event_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  send_id INTEGER NOT NULL REFERENCES email_send_log(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_eventlog_send ON email_event_log(send_id);
CREATE INDEX IF NOT EXISTS idx_eventlog_kind ON email_event_log(kind);
