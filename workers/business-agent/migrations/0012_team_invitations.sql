CREATE TABLE agent_team_invitations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
  invited_email TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('manager','staff','billing','viewer')),
  invited_by TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','accepted','revoked')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_by TEXT,
  accepted_at TEXT,
  acceptance_token TEXT,
  revoked_by TEXT,
  revoked_at TEXT,
  UNIQUE(tenant_id,invited_by,request_key)
);
CREATE INDEX agent_team_invitation_email ON agent_team_invitations(invited_email,status,expires_at);
CREATE INDEX agent_team_invitation_tenant ON agent_team_invitations(tenant_id,status,created_at);
ALTER TABLE agent_memberships ADD COLUMN revoked_by TEXT;
ALTER TABLE agent_memberships ADD COLUMN revoked_at TEXT;
