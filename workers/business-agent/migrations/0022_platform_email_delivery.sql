CREATE TABLE agent_platform_email_delivery (
  job_id TEXT PRIMARY KEY REFERENCES agent_platform_email_outbox(id),
  tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
  last_event TEXT,
  checked_at TEXT,
  delivered_seen INTEGER NOT NULL DEFAULT 0 CHECK(delivered_seen IN (0,1)),
  bounced_seen INTEGER NOT NULL DEFAULT 0 CHECK(bounced_seen IN (0,1)),
  complained_seen INTEGER NOT NULL DEFAULT 0 CHECK(complained_seen IN (0,1)),
  negative_token TEXT,
  next_check_at TEXT NOT NULL,
  checks INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_expires_at TEXT,
  last_error_code TEXT
);
CREATE INDEX agent_platform_email_delivery_due ON agent_platform_email_delivery(next_check_at,lease_expires_at);
