-- Disabled by absence. Existing customer grants never imply self-registration.
CREATE TABLE mayor_phone_registration_policy (
 tenant_id TEXT PRIMARY KEY REFERENCES agent_tenants(id),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 revision INTEGER NOT NULL DEFAULT 1,
 granted_by TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
