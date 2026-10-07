CREATE TABLE mayor_phone_oauth_states (
 state_hash TEXT PRIMARY KEY,
 provider TEXT NOT NULL CHECK(provider IN ('telnyx')),
 tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
 user_id TEXT NOT NULL,
 session_hash TEXT NOT NULL,
 config_hash TEXT NOT NULL,
 connection_revision INTEGER NOT NULL,
 ciphertext TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX mayor_phone_oauth_states_user_expiry ON mayor_phone_oauth_states(user_id,expires_at);
