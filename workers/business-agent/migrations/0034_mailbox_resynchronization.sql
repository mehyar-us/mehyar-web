CREATE TABLE agent_mailbox_resync_receipts (
  stream_id TEXT NOT NULL REFERENCES agent_mailbox_sync(id),
  request_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  new_round TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(stream_id,request_key)
);
ALTER TABLE agent_mailbox_messages ADD COLUMN needs_reconciliation INTEGER NOT NULL DEFAULT 0 CHECK(needs_reconciliation IN (0,1));
