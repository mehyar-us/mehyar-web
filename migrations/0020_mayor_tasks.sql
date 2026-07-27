-- Durable CRM task queue for owner actions that directly move money.
-- First use case: every warm reply becomes a booking/meeting task.

CREATE TABLE IF NOT EXISTS mayor_tasks (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  prospect_id TEXT,
  reply_id TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  priority INTEGER NOT NULL DEFAULT 50,
  due_at TEXT,
  cta_text TEXT,
  value_usd REAL NOT NULL DEFAULT 0,
  source TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_mayor_tasks_status_kind ON mayor_tasks(status, kind, due_at);
CREATE INDEX IF NOT EXISTS idx_mayor_tasks_prospect ON mayor_tasks(prospect_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mayor_tasks_reply ON mayor_tasks(reply_id);
