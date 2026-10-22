-- 0065: widen mayor_notifications kinds for P7 proactive day-one re-asks:
-- 'phone_connect_reask' (a missed call was handled by hand while the phone
-- is not connected) and 'profile_hours_missing' (no usable opening hours on
-- the business profile / scheduling policy). Rebuild follows the
-- 0044/0057/0058/0060/0063 pattern. Additive only.
CREATE TABLE mayor_notifications_with_reasks (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL,
 dedupe_key TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('onboarding','calendar_connection','scheduled_check_failed','phone_call_review','missed_call_texted','missed_call_simulated','missed_call','proactive_suggestion','proactive_suggestion_sent','proactive_briefing','appointment_booked','phone_connect_reask','profile_hours_missing')),
 state TEXT NOT NULL CHECK(state IN ('open','resolved')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, read_at TEXT,
 occurrence INTEGER NOT NULL DEFAULT 1,
 UNIQUE(tenant_id,user_id,dedupe_key),
 FOREIGN KEY(tenant_id,user_id) REFERENCES agent_memberships(tenant_id,user_id)
);
INSERT INTO mayor_notifications_with_reasks(id,tenant_id,user_id,dedupe_key,kind,state,created_at,updated_at,read_at,occurrence)
 SELECT id,tenant_id,user_id,dedupe_key,kind,state,created_at,updated_at,read_at,occurrence FROM mayor_notifications;
DROP TABLE mayor_notifications;
ALTER TABLE mayor_notifications_with_reasks RENAME TO mayor_notifications;
CREATE INDEX mayor_notifications_inbox ON mayor_notifications(tenant_id,user_id,state,created_at);
