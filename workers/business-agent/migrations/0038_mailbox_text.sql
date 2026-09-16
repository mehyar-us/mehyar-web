-- Derived untrusted text and extraction warnings share the snapshot receipt.
-- Existing snapshots remain NULL until re-observed; no fabricated backfill.
ALTER TABLE agent_mailbox_messages ADD COLUMN text_json TEXT;
