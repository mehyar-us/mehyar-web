CREATE TABLE mayor_telnyx_stream_grants (
 admission_id TEXT PRIMARY KEY REFERENCES mayor_telnyx_admissions(id),
 token_hash TEXT NOT NULL UNIQUE,
 expires_at INTEGER NOT NULL,
 consumed_at INTEGER
);
