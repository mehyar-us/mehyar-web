-- 2026-07-22: Send history: capture the actual subject, body, physical address,
-- and unsubscribe header on prospect_sends so the founder can see what was
-- sent to whom and replay / audit anything later. Previously these were only
-- computed at send-time and discarded.

ALTER TABLE prospect_sends ADD COLUMN subject              TEXT;
ALTER TABLE prospect_sends ADD COLUMN body_text            TEXT;        -- up to 32KB
ALTER TABLE prospect_sends ADD COLUMN from_name            TEXT;
ALTER TABLE prospect_sends ADD COLUMN list_unsub_header    TEXT;
ALTER TABLE prospect_sends ADD COLUMN physical_address     TEXT;

-- "Reply received" tracker: prospect_replies.send_id already exists.
-- Add an index over it so the new /api/admin/mayor/sent endpoint can
-- detect which sends got a reply cheaply.
CREATE INDEX IF NOT EXISTS idx_prospect_replies_send_id
  ON prospect_replies(send_id);

-- Helpful index: filter / sort sent emails by date for the founder inbox.
CREATE INDEX IF NOT EXISTS idx_prospect_sends_created_at_desc
  ON prospect_sends(created_at DESC);
