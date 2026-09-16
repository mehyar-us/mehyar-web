CREATE TABLE agent_mailbox_consumers (
  stream_id TEXT PRIMARY KEY REFERENCES agent_mailbox_sync(id),
  page_token TEXT,
  ordinal INTEGER,
  lease_token TEXT,
  lease_until TEXT,
  next_attempt_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
  attempts INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','review_required'))
);
CREATE TABLE agent_mailbox_messages (
  stream_id TEXT NOT NULL REFERENCES agent_mailbox_sync(id),
  message_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('present','missing')),
  content_json TEXT,
  content_bytes INTEGER NOT NULL,
  source_mode TEXT NOT NULL CHECK(source_mode IN ('unknown','bootstrap','incremental')),
  observed_at TEXT NOT NULL,
  receipt_token TEXT NOT NULL,
  PRIMARY KEY(stream_id,message_id)
);
