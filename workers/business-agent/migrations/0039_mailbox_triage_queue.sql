CREATE TABLE agent_mailbox_triage_queue (
  stream_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  receipt_token TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','complete','review_required','obsolete')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  lease_token TEXT,
  lease_until TEXT,
  PRIMARY KEY(stream_id,message_id),
  FOREIGN KEY(stream_id,message_id) REFERENCES agent_mailbox_messages(stream_id,message_id) ON DELETE CASCADE
);
CREATE INDEX agent_mailbox_triage_due ON agent_mailbox_triage_queue(state,next_attempt_at);
