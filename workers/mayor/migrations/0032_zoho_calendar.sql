-- Preserve grants and both dependent tables while widening the provider CHECK.
-- D1 applies this migration atomically. Never disable foreign-key enforcement.
CREATE TABLE mayor_grants_backup AS SELECT * FROM auth_provider_grants;
CREATE TABLE mayor_refresh_backup AS SELECT * FROM agent_credential_refreshes;
CREATE TABLE mayor_selection_backup AS SELECT * FROM mayor_calendar_selection;
DROP TABLE mayor_calendar_selection;
DROP TABLE agent_credential_refreshes;
DROP TABLE auth_provider_grants;
CREATE TABLE auth_provider_grants (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
 provider TEXT NOT NULL CHECK(provider IN ('google','microsoft','zoho')),
 account_id TEXT NOT NULL, tenant_scope TEXT NOT NULL DEFAULT '', ciphertext TEXT NOT NULL,
 key_version INTEGER NOT NULL DEFAULT 1, granted_scopes TEXT NOT NULL, selected_capabilities TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('authorized','reconnect_required','revoked')), updated_at TEXT NOT NULL,
 authorization_revision INTEGER NOT NULL DEFAULT 1,
 UNIQUE(user_id,provider,account_id,tenant_scope)
);
INSERT INTO auth_provider_grants SELECT * FROM mayor_grants_backup;
CREATE INDEX auth_provider_grants_tenant_idx ON auth_provider_grants(tenant_scope,user_id);
CREATE TABLE agent_credential_refreshes (
 grant_id TEXT PRIMARY KEY REFERENCES auth_provider_grants(id) ON DELETE CASCADE,
 credential_hash TEXT NOT NULL,lease_token TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('running','uncertain')),started_at TEXT NOT NULL,expires_at TEXT NOT NULL
);
INSERT INTO agent_credential_refreshes SELECT * FROM mayor_refresh_backup;
CREATE TABLE mayor_calendar_selection (
 tenant_id TEXT PRIMARY KEY REFERENCES agent_tenants(id),grant_id TEXT NOT NULL REFERENCES auth_provider_grants(id),
 provider TEXT NOT NULL CHECK(provider IN ('google','microsoft','zoho')),calendar_id TEXT NOT NULL,calendar_name TEXT NOT NULL,
 authorization_stamp TEXT NOT NULL,updated_by TEXT NOT NULL,updated_at TEXT NOT NULL
);
INSERT INTO mayor_calendar_selection SELECT * FROM mayor_selection_backup;
DROP TABLE mayor_grants_backup;
DROP TABLE mayor_refresh_backup;
DROP TABLE mayor_selection_backup;
CREATE TABLE mayor_zoho_oauth_states (
 state_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,session_id TEXT NOT NULL,tenant_id TEXT NOT NULL,
 verifier TEXT NOT NULL,nonce TEXT NOT NULL,selected TEXT NOT NULL,expires_at INTEGER NOT NULL
);
CREATE INDEX mayor_zoho_oauth_expiry ON mayor_zoho_oauth_states(expires_at);
