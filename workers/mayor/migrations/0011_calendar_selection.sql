CREATE TABLE mayor_calendar_selection (
 tenant_id TEXT PRIMARY KEY REFERENCES agent_tenants(id),
 grant_id TEXT NOT NULL REFERENCES auth_provider_grants(id),
 provider TEXT NOT NULL CHECK(provider IN ('google','microsoft')),
 calendar_id TEXT NOT NULL,
 calendar_name TEXT NOT NULL,
 authorization_stamp TEXT NOT NULL,
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
