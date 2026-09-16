-- Display metadata from verified provider inventories, never resource authority.
ALTER TABLE agent_mailbox_sync ADD COLUMN display_name TEXT;
