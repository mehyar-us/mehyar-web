CREATE TABLE mayor_twilio_connect_attempts (
 state_hash TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
 user_id TEXT NOT NULL,
 session_hash TEXT NOT NULL,
 app_sid TEXT NOT NULL,
 connection_revision INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX mayor_twilio_connect_attempts_expiry ON mayor_twilio_connect_attempts(user_id,expires_at);
