-- RECOVERED-RECORD — documentation-grade reconstruction, Slice 0 (2026-10-21).
-- Applied to production (recorded in production's d1_migrations) but its
-- file existed in NO repo. The DDL below was recovered verbatim from
-- production's live schema (sqlite_master) on 2026-10-21 and is committed
-- as the record of what production ran.
CREATE TABLE mayor_payment_connections (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
 user_id TEXT NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('stripe','square')),
 account_id TEXT NOT NULL,
 ciphertext TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'connected' CHECK(status IN ('connected','disconnected')),
 scopes TEXT NOT NULL DEFAULT '[]',
 revision INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(tenant_id,user_id,provider)
);
CREATE INDEX idx_payment_connections_tenant ON mayor_payment_connections(tenant_id,user_id,status);
CREATE TABLE mayor_payment_oauth_states (
 state_hash TEXT PRIMARY KEY,
 provider TEXT NOT NULL CHECK(provider IN ('stripe','square')),
 tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
 user_id TEXT NOT NULL,
 session_hash TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX idx_payment_oauth_states_user ON mayor_payment_oauth_states(user_id,expires_at);
