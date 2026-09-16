-- Unknown historical receipts must not be assumed to represent new inquiries.
ALTER TABLE agent_mailbox_sync_pages ADD COLUMN source_mode TEXT NOT NULL DEFAULT 'unknown' CHECK(source_mode IN ('unknown','bootstrap','incremental'));
