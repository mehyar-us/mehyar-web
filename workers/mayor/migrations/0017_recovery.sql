CREATE TABLE mayor_recovery_attempts (
 kind TEXT NOT NULL CHECK(kind IN ('booking','change')),
 request_id TEXT NOT NULL,
 tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
 attempts INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL CHECK(state IN ('pending','complete','review')),
 next_attempt_at INTEGER NOT NULL,
 lease_until INTEGER NOT NULL,
 lease_token TEXT,
 last_result TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(kind,request_id)
);
CREATE INDEX mayor_recovery_due ON mayor_recovery_attempts(state,next_attempt_at,lease_until);
