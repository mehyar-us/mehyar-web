CREATE TABLE mayor_custom_connections (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  input_sha TEXT NOT NULL,
  label TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('api','webhook','mcp')),
  endpoint_origin TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  has_secret INTEGER NOT NULL CHECK(has_secret IN (0,1)),
  status TEXT NOT NULL DEFAULT 'connected' CHECK(status IN ('connected','disconnected')),
  revision INTEGER NOT NULL DEFAULT 1,
  last_checked_at TEXT,
  last_check_status TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,user_id,request_id)
);
CREATE INDEX custom_connections_owner ON mayor_custom_connections(tenant_id,user_id,status);
CREATE TABLE mayor_custom_tool_proposals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES mayor_custom_connections(id),
  connection_revision INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  effect TEXT NOT NULL CHECK(effect IN ('read','write')),
  ciphertext TEXT NOT NULL,
  input_sha TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','running','completed','unknown')),
  result_json TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE(tenant_id,user_id,request_id)
);
CREATE INDEX custom_proposals_owner ON mayor_custom_tool_proposals(tenant_id,user_id,connection_id);
