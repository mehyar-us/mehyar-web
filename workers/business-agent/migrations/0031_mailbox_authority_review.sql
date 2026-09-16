ALTER TABLE agent_mailbox_sync ADD COLUMN authority_checked_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';
CREATE INDEX agent_mailbox_authority_review ON agent_mailbox_sync(authority_checked_at,id);
