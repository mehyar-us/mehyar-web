ALTER TABLE auth_provider_grants ADD COLUMN mailbox_paused INTEGER NOT NULL DEFAULT 0 CHECK(mailbox_paused IN (0,1));
-- Stop in-flight commits atomically with the account control. Preserve queued
-- work and checkpoints; stopping monitoring does not revoke other connectors.
CREATE TRIGGER agent_mailbox_connection_pause AFTER UPDATE OF mailbox_paused ON auth_provider_grants
WHEN NEW.mailbox_paused=1 AND OLD.mailbox_paused=0
BEGIN
  UPDATE agent_mailbox_sync SET lease_token=NULL,lease_until=NULL WHERE grant_id=NEW.id;
  UPDATE agent_mailbox_consumers SET lease_token=NULL,lease_until=NULL
    WHERE stream_id IN (SELECT id FROM agent_mailbox_sync WHERE grant_id=NEW.id);
END;
