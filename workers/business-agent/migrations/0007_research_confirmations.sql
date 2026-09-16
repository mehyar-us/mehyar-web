CREATE TABLE agent_research_confirmations (
  tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
  id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  claim_index INTEGER NOT NULL,
  memory_key TEXT NOT NULL,
  memory_value TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  confirmed_by TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,id)
);
