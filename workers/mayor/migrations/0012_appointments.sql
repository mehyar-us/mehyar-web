CREATE TABLE mayor_appointment_jobs (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES agent_tenants(id), actor_id TEXT NOT NULL,
 provider TEXT NOT NULL, grant_id TEXT NOT NULL, calendar_id TEXT NOT NULL, authorization_stamp TEXT NOT NULL,
 policy_revision INTEGER NOT NULL, input_json TEXT NOT NULL,
 reserved_start TEXT NOT NULL, reserved_end TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('proposed','running','applied','rejected','uncertain')),
 expires_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 receipt_json TEXT
);
CREATE INDEX mayor_jobs_overlap ON mayor_appointment_jobs(tenant_id,calendar_id,state,reserved_start,reserved_end);
CREATE TABLE mayor_appointments (
 id TEXT PRIMARY KEY REFERENCES mayor_appointment_jobs(id),tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
 provider TEXT NOT NULL,calendar_id TEXT NOT NULL,event_id TEXT NOT NULL,etag TEXT,
 input_json TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
