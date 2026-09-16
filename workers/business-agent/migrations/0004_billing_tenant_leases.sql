-- Apply ONLY to the new AGENT_DB. Serialize distinct billing events per business.
CREATE TABLE agent_billing_tenant_leases (
  tenant_id TEXT PRIMARY KEY REFERENCES agent_tenants(id),
  processing_token TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
