CREATE TABLE mayor_phone_oauth_refresh (
 connection_id TEXT PRIMARY KEY REFERENCES mayor_phone_connections(id),
 account_id TEXT NOT NULL,
 claim_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','uncertain')),
 started_at INTEGER NOT NULL
);
