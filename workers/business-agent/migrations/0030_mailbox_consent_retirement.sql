-- Authorization and queued mailbox work change atomically. Keep receipts and
-- snapshots for retention/audit; never let unusable pending references block a
-- newly authorized mailbox. Ordinary token/ciphertext refresh does not fire this.
CREATE TRIGGER agent_mailbox_consent_retirement
AFTER UPDATE OF authorization_revision, granted_scopes, status ON auth_provider_grants
WHEN OLD.authorization_revision != NEW.authorization_revision
  OR OLD.granted_scopes != NEW.granted_scopes OR OLD.status != NEW.status
BEGIN
  UPDATE agent_mailbox_sync
    SET state='resync_required',lease_token=NULL,lease_until=NULL
    WHERE grant_id=NEW.id;
  UPDATE agent_mailbox_consumers
    SET state='review_required',lease_token=NULL,lease_until=NULL
    WHERE stream_id IN (SELECT id FROM agent_mailbox_sync WHERE grant_id=NEW.id);
  UPDATE agent_mailbox_changes SET state='discarded'
    WHERE state='pending' AND stream_id IN (SELECT id FROM agent_mailbox_sync WHERE grant_id=NEW.id);
END;

-- Known revoked/unusable grants can be retired without guessing prior stamps.
UPDATE agent_mailbox_sync SET state='resync_required',lease_token=NULL,lease_until=NULL
WHERE grant_id IN (SELECT id FROM auth_provider_grants WHERE status!='authorized');
UPDATE agent_mailbox_consumers SET state='review_required',lease_token=NULL,lease_until=NULL
WHERE stream_id IN (SELECT s.id FROM agent_mailbox_sync s JOIN auth_provider_grants g ON g.id=s.grant_id WHERE g.status!='authorized');
UPDATE agent_mailbox_changes SET state='discarded' WHERE state='pending'
AND stream_id IN (SELECT s.id FROM agent_mailbox_sync s JOIN auth_provider_grants g ON g.id=s.grant_id WHERE g.status!='authorized');
