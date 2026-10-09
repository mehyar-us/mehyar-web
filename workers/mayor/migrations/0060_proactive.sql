-- 0060: Crew 3 proactive engine — detections, suggestion cards, ROI events, nudge log.
-- Additive only. No changes to existing tables' data; mayor_notifications is
-- rebuilt to widen the kind CHECK (same pattern as 0044/0057/0058).

CREATE TABLE IF NOT EXISTS mayor_proactive_detections (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 detector TEXT NOT NULL CHECK(detector IN ('slow_day','lapsed_regular','unanswered_lead','no_show_risk','missed_call_followup')),
 detected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 payload_json TEXT NOT NULL DEFAULT '{}',
 state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','surfaced','resolved','dismissed')),
 dedupe_key TEXT NOT NULL,
 UNIQUE(tenant_id, detector, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_proactive_detections_tenant ON mayor_proactive_detections(tenant_id, state, detected_at DESC);

CREATE TABLE IF NOT EXISTS mayor_suggestion_cards (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 detection_id TEXT NOT NULL REFERENCES mayor_proactive_detections(id),
 kind TEXT NOT NULL CHECK(kind IN ('fill_gap','winback','followup','lead_reply','reminder_nudge')),
 title TEXT NOT NULL,
 body TEXT NOT NULL,
 draft_json TEXT NOT NULL DEFAULT '{}',
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','edited','sent','dismissed')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 decided_at TEXT,
 result_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_suggestion_cards_tenant ON mayor_suggestion_cards(tenant_id, state, created_at DESC);

CREATE TABLE IF NOT EXISTS mayor_roi_events (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('recovery','booking_made','textback_sent','response_logged','no_show','appointment_held')),
 occurred_at TEXT NOT NULL,
 amount_cents INTEGER,
 meta_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_roi_events_tenant ON mayor_roi_events(tenant_id, kind, occurred_at DESC);

CREATE TABLE IF NOT EXISTS mayor_nudge_log (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('suggestion','briefing')),
 day_key TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_nudge_log_tenant_day ON mayor_nudge_log(tenant_id, day_key);

-- Widen mayor_notifications kinds for the proactive surface cards.
-- Rebuild follows the 0044/0057/0058 pattern. Additive only.
CREATE TABLE mayor_notifications_with_proactive (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL,
 dedupe_key TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('onboarding','calendar_connection','scheduled_check_failed','phone_call_review','missed_call_texted','missed_call','missed_call_simulated','proactive_suggestion','proactive_briefing')),
 state TEXT NOT NULL CHECK(state IN ('open','resolved')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, read_at TEXT,
 occurrence INTEGER NOT NULL DEFAULT 1,
 UNIQUE(tenant_id,user_id,dedupe_key),
 FOREIGN KEY(tenant_id,user_id) REFERENCES agent_memberships(tenant_id,user_id)
);
INSERT INTO mayor_notifications_with_proactive(id,tenant_id,user_id,dedupe_key,kind,state,created_at,updated_at,read_at,occurrence)
 SELECT id,tenant_id,user_id,dedupe_key,kind,state,created_at,updated_at,read_at,occurrence FROM mayor_notifications;
DROP TABLE mayor_notifications;
ALTER TABLE mayor_notifications_with_proactive RENAME TO mayor_notifications;
CREATE INDEX mayor_notifications_inbox ON mayor_notifications(tenant_id,user_id,state,created_at);
