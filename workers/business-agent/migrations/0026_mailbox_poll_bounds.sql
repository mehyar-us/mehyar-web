ALTER TABLE agent_mailbox_sync ADD COLUMN next_poll_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';
ALTER TABLE agent_mailbox_sync ADD COLUMN consecutive_attempts INTEGER NOT NULL DEFAULT 0;
CREATE INDEX agent_mailbox_sync_due ON agent_mailbox_sync(state,next_poll_at,tenant_id);
