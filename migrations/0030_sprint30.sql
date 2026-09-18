-- 0030: Sprint30 30-day challenge enrollments + daily send log.
-- One enrollment row per paid checkout (UNIQUE on payment_id → webhook
-- replays are no-ops). sprint30_sends records each day's email per
-- enrollment (UNIQUE on enrollment_id+day_no → the daily scheduler is
-- idempotent and can catch up missed days).
CREATE TABLE IF NOT EXISTS sprint30_enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL,
  product_id TEXT NOT NULL DEFAULT 'sprint30-challenge',
  email TEXT NOT NULL,
  access_token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  started_at TEXT NOT NULL,
  current_day INTEGER NOT NULL DEFAULT 1,
  progress_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sprint30_enrollments_payment ON sprint30_enrollments(payment_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sprint30_enrollments_token ON sprint30_enrollments(access_token);
CREATE TABLE IF NOT EXISTS sprint30_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id INTEGER NOT NULL,
  day_no INTEGER NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  message_id TEXT,
  esp TEXT,
  UNIQUE(enrollment_id, day_no)
);
CREATE INDEX IF NOT EXISTS idx_sprint30_sends_enrollment ON sprint30_sends(enrollment_id);
