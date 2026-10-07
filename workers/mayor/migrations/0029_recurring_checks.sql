CREATE TABLE mayor_recurring_checks (
 tenant_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 schedule_json TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,
 next_run_at TEXT,
 due_local_date TEXT,
 lease_token TEXT,
 lease_until TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,
 last_run_at TEXT,
 last_status TEXT CHECK(last_status IN ('ok','failed')),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,user_id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES agent_memberships(tenant_id,user_id)
);
CREATE INDEX mayor_recurring_due ON mayor_recurring_checks(enabled,next_run_at,lease_until);
CREATE TABLE mayor_check_runs (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 schedule_revision INTEGER NOT NULL,
 due_at TEXT NOT NULL,
 attempt INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('ok','failed')),
 checked_at TEXT NOT NULL,
 UNIQUE(tenant_id,user_id,schedule_revision,due_at,attempt),
 FOREIGN KEY(tenant_id,user_id) REFERENCES agent_memberships(tenant_id,user_id)
);
CREATE TABLE mayor_notifications_next (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL,
 dedupe_key TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('onboarding','calendar_connection','scheduled_check_failed')),
 state TEXT NOT NULL CHECK(state IN ('open','resolved')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, read_at TEXT,
 UNIQUE(tenant_id,user_id,dedupe_key),
 FOREIGN KEY(tenant_id,user_id) REFERENCES agent_memberships(tenant_id,user_id)
);
INSERT INTO mayor_notifications_next SELECT * FROM mayor_notifications;
DROP TABLE mayor_notifications;
ALTER TABLE mayor_notifications_next RENAME TO mayor_notifications;
CREATE INDEX mayor_notifications_inbox ON mayor_notifications(tenant_id,user_id,state,created_at);
