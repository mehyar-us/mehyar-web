CREATE TABLE mayor_voice_application_operations (
 tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
 provider TEXT NOT NULL CHECK(provider IN ('telnyx','twilio')),
 account_id TEXT NOT NULL,
 operation_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('dispatching','ready','uncertain')),
 application_id TEXT,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,provider,account_id)
);
