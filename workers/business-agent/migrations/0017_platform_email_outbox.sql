CREATE TABLE agent_platform_email_outbox (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
  invitation_id TEXT NOT NULL REFERENCES agent_team_invitations(id),
  prepared_by TEXT NOT NULL,
  route_ref TEXT NOT NULL,
  recipient TEXT NOT NULL,
  invited_role TEXT NOT NULL,
  invitation_expires_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('prepared','sending','retry','accepted','rejected','review_required','cancelled')),
  created_at TEXT NOT NULL,
  first_attempt_at TEXT,
  next_attempt_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_expires_at TEXT,
  provider_id TEXT,
  last_code TEXT,
  UNIQUE(tenant_id,invitation_id)
);
CREATE INDEX agent_platform_email_due ON agent_platform_email_outbox(state,next_attempt_at,lease_expires_at);
