CREATE TABLE mayor_telnyx_recovery (
 admission_id TEXT PRIMARY KEY REFERENCES mayor_telnyx_admissions(id),
 attempts INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL CHECK(state IN ('pending','complete','review')),
 lease_until INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT NOT NULL,
 next_attempt_at INTEGER NOT NULL,
 last_result TEXT NOT NULL
);
