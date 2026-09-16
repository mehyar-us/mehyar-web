-- Older receipts remain valid for exact primitive replay, but cannot establish
-- a service-level expected-round match without their original request data.
ALTER TABLE agent_mailbox_resync_receipts ADD COLUMN expected_round TEXT;
