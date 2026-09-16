ALTER TABLE agent_mailbox_sync ADD COLUMN sync_mode TEXT NOT NULL DEFAULT 'incremental' CHECK(sync_mode IN ('bootstrap','incremental'));
