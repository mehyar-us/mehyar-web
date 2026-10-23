-- CashText cadence (integration spec §3.4/§3.6, Phase 4): the Friday
-- cash summary is a stored, once-per-tenant-per-week record (its
-- UNIQUE(tenant_id, week_key) is the firing idempotency fence), and
-- the owner-email mirror rides the existing attention machinery, so
-- mayor_notifications gains the summary's kind — a rebuild in the
-- established 0044/0057/0058/0063/0065 pattern, reproducing the 0065
-- definition (production's last rebuild) plus the one new kind.
CREATE TABLE mayor_cashtext_summaries (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
 week_key TEXT NOT NULL,
 timezone TEXT NOT NULL,
 text TEXT NOT NULL,
 summary_json TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(tenant_id, week_key)
);
CREATE TABLE "mayor_notifications_with_cashtext_summary" (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL,
 dedupe_key TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('onboarding','calendar_connection','scheduled_check_failed','phone_call_review','missed_call_texted','missed_call_simulated','missed_call','proactive_suggestion','proactive_suggestion_sent','proactive_briefing','appointment_booked','phone_connect_reask','profile_hours_missing','cashtext_friday_summary')),
 state TEXT NOT NULL CHECK(state IN ('open','resolved')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, read_at TEXT,
 occurrence INTEGER NOT NULL DEFAULT 1,
 UNIQUE(tenant_id,user_id,dedupe_key),
 FOREIGN KEY(tenant_id,user_id) REFERENCES agent_memberships(tenant_id,user_id)
);
INSERT INTO mayor_notifications_with_cashtext_summary(id,tenant_id,user_id,dedupe_key,kind,state,created_at,updated_at,read_at,occurrence)
 SELECT id,tenant_id,user_id,dedupe_key,kind,state,created_at,updated_at,read_at,occurrence FROM mayor_notifications;
DROP TABLE mayor_notifications;
ALTER TABLE mayor_notifications_with_cashtext_summary RENAME TO mayor_notifications;
CREATE INDEX mayor_notifications_inbox ON mayor_notifications(tenant_id,user_id,state,created_at);
