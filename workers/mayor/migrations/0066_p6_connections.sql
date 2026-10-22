-- 0066: P6 connections — GBP reviews snapshot cache + payments OAuth.
-- Additive only. A GBP snapshot row exists ONLY after a real, successful
-- Business Profile read (src/gbp-reviews.ts); absence of a row means no
-- read has ever succeeded for the tenant, never a zero-review business.
-- Payment OAuth states are single-use, digest-only, tenant+user+session
-- bound (src/payments-oauth.ts). Payment connection tokens live only in
-- the AES-GCM ciphertext column, AAD-bound to tenant/user/provider/account.
CREATE TABLE IF NOT EXISTS mayor_gbp_snapshot (
 tenant_id TEXT PRIMARY KEY REFERENCES agent_tenants(id),
 grant_id TEXT NOT NULL,
 snapshot_json TEXT NOT NULL,
 fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mayor_payment_oauth_states (
 state_hash TEXT PRIMARY KEY,
 provider TEXT NOT NULL CHECK(provider IN ('stripe','square')),
 tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
 user_id TEXT NOT NULL,
 session_hash TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_oauth_states_user ON mayor_payment_oauth_states(user_id,expires_at);
CREATE TABLE IF NOT EXISTS mayor_payment_connections (
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
CREATE INDEX IF NOT EXISTS idx_payment_connections_tenant ON mayor_payment_connections(tenant_id,user_id,status);
