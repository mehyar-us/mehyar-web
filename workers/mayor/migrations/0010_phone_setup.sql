-- Setup intent is separate from verified connections and cannot authorize spend.
CREATE TABLE mayor_phone_setup (
  tenant_id TEXT PRIMARY KEY REFERENCES agent_tenants(id),
  mode TEXT NOT NULL CHECK(mode IN ('new','existing')),
  provider TEXT CHECK(provider IN ('twilio','telnyx')),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
