CREATE TABLE mayor_phone_connections (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),provider TEXT NOT NULL,
 account_id TEXT NOT NULL,owner_user_id TEXT NOT NULL,ciphertext TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('authorized','revoked')),
 selected_number_id TEXT,selected_number TEXT,revision INTEGER NOT NULL DEFAULT 1,
 verified_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(tenant_id,provider)
);
