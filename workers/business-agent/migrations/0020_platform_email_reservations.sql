CREATE TABLE agent_platform_email_reservations (
  job_id TEXT PRIMARY KEY REFERENCES agent_platform_email_outbox(id),
  tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
  period TEXT NOT NULL,
  resets_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('held','consumed','released')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX agent_platform_email_reservation_usage
  ON agent_platform_email_reservations(tenant_id,period,state);
