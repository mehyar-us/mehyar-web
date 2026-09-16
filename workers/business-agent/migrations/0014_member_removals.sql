CREATE TABLE agent_member_removals (
  tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
  request_key TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,request_key)
);
