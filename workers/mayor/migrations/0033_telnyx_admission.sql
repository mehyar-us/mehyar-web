CREATE TABLE mayor_telnyx_admissions (
 id TEXT PRIMARY KEY,
 event_id TEXT NOT NULL UNIQUE,
 tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
 connection_id TEXT NOT NULL REFERENCES mayor_phone_connections(id),
 connection_revision INTEGER NOT NULL,
 call_control_id TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(connection_id,call_control_id)
);
CREATE INDEX mayor_telnyx_admissions_tenant ON mayor_telnyx_admissions(tenant_id,created_at);
