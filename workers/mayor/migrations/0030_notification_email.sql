ALTER TABLE mayor_notifications ADD COLUMN occurrence INTEGER NOT NULL DEFAULT 1;
CREATE TABLE mayor_email_preferences (
 tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 email TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,user_id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES agent_memberships(tenant_id,user_id)
);
CREATE TABLE mayor_email_outbox (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL,
 preference_revision INTEGER NOT NULL, recipient TEXT NOT NULL,
 fingerprint TEXT NOT NULL, notifications_json TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','sending','accepted','uncertain','failed','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL,
 lease_token TEXT, lease_until TEXT, provider_id TEXT, failure_code TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(tenant_id,user_id,fingerprint),
 FOREIGN KEY(tenant_id,user_id) REFERENCES agent_memberships(tenant_id,user_id)
);
CREATE UNIQUE INDEX mayor_email_one_pending ON mayor_email_outbox(tenant_id,user_id) WHERE state IN ('pending','sending');
CREATE INDEX mayor_email_due ON mayor_email_outbox(state,next_attempt_at);
