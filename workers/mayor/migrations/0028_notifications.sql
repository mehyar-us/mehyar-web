CREATE TABLE mayor_notifications (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 dedupe_key TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('onboarding','calendar_connection')),
 state TEXT NOT NULL CHECK(state IN ('open','resolved')),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 read_at TEXT,
 UNIQUE(tenant_id,user_id,dedupe_key),
 FOREIGN KEY(tenant_id,user_id) REFERENCES agent_memberships(tenant_id,user_id)
);
CREATE INDEX mayor_notifications_inbox ON mayor_notifications(tenant_id,user_id,state,created_at);
