CREATE TABLE agent_tenants (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);
CREATE TABLE agent_memberships (
  tenant_id TEXT NOT NULL REFERENCES agent_tenants(id), user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','manager','staff','viewer','billing')),
  status TEXT NOT NULL DEFAULT 'active', expires_at TEXT,
  PRIMARY KEY(tenant_id,user_id)
);
CREATE INDEX membership_user ON agent_memberships(user_id,status);
CREATE TABLE mayor_memory (
  tenant_id TEXT NOT NULL REFERENCES agent_tenants(id), field TEXT NOT NULL,
  value_json TEXT NOT NULL, source_kind TEXT NOT NULL,
  source_url TEXT, confirmed_by TEXT, confirmed_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,field)
);
CREATE TABLE mayor_audit (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
  actor_id TEXT NOT NULL, event TEXT NOT NULL, resource_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX audit_tenant_time ON mayor_audit(tenant_id,created_at);
CREATE TABLE mayor_rate_limits (
  subject TEXT NOT NULL, bucket INTEGER NOT NULL, count INTEGER NOT NULL,
  PRIMARY KEY(subject,bucket)
);
