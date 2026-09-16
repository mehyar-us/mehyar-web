ALTER TABLE agent_platform_email_outbox ADD COLUMN cancel_requested_at TEXT;
ALTER TABLE agent_platform_email_outbox ADD COLUMN cancel_requested_by TEXT;
