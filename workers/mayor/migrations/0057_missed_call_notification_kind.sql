-- 0057: Allow the missed-call text-back notification kind.
-- notifyMissedCallTexted (used by the live text-back and the test simulator)
-- writes kind='missed_call_texted', which the 0044 CHECK constraint rejected.
-- Rebuild follows the 0044 pattern. Additive only.
CREATE TABLE mayor_notifications_with_missed_call (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL,
 dedupe_key TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('onboarding','calendar_connection','scheduled_check_failed','phone_call_review','missed_call_texted')),
 state TEXT NOT NULL CHECK(state IN ('open','resolved')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, read_at TEXT,
 occurrence INTEGER NOT NULL DEFAULT 1,
 UNIQUE(tenant_id,user_id,dedupe_key),
 FOREIGN KEY(tenant_id,user_id) REFERENCES agent_memberships(tenant_id,user_id)
);
INSERT INTO mayor_notifications_with_missed_call(id,tenant_id,user_id,dedupe_key,kind,state,created_at,updated_at,read_at,occurrence)
 SELECT id,tenant_id,user_id,dedupe_key,kind,state,created_at,updated_at,read_at,occurrence FROM mayor_notifications;
DROP TABLE mayor_notifications;
ALTER TABLE mayor_notifications_with_missed_call RENAME TO mayor_notifications;
CREATE INDEX mayor_notifications_inbox ON mayor_notifications(tenant_id,user_id,state,created_at);
