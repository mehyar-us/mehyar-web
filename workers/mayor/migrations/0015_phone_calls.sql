CREATE TABLE mayor_phone_calls (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
 account_id TEXT NOT NULL,call_sid TEXT NOT NULL,connection_revision INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','streaming','ended')),
 stream_expires_at TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL,
 turns INTEGER NOT NULL DEFAULT 0,UNIQUE(account_id,call_sid)
);
