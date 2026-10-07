CREATE TABLE mayor_usage_allowances (
 tenant_id TEXT PRIMARY KEY REFERENCES agent_tenants(id),
 tier TEXT NOT NULL CHECK(tier IN ('standard','extended')),
 reviewed_at TEXT NOT NULL,
 reviewed_by TEXT NOT NULL
);
