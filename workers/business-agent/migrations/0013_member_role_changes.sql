ALTER TABLE agent_memberships ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
CREATE TABLE agent_member_role_changes (
  tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
  request_key TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  new_role TEXT NOT NULL CHECK(new_role IN ('manager','staff','billing','viewer')),
  operation_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,request_key)
);
