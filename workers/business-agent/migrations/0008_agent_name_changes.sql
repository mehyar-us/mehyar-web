CREATE TABLE agent_name_changes (
  tenant_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  expected_name TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, request_key)
);
