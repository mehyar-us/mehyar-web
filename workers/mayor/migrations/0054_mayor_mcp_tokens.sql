-- Each capability belongs to one current business member. Only the token digest is stored.
CREATE TABLE mayor_mcp_tokens (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  token_digest TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL CHECK(json_valid(scopes_json)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY(tenant_id,user_id) REFERENCES agent_memberships(tenant_id,user_id) ON DELETE CASCADE
);
CREATE INDEX mayor_mcp_tokens_member ON mayor_mcp_tokens(tenant_id,user_id,expires_at);
