-- Operator-owned, new-platform sender accounts only. Do not point at a shared
-- legacy account without separately accounting for all of its external usage.
CREATE TABLE agent_email_supplier_budgets (
  account_ref TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  limit_microusd INTEGER NOT NULL CHECK(limit_microusd BETWEEN 0 AND 1000000000000),
  job_microusd INTEGER NOT NULL CHECK(job_microusd BETWEEN 1 AND 1000000000000),
  status TEXT NOT NULL CHECK(status IN ('verified','revoked')),
  evidence_ref TEXT NOT NULL,
  verified_by TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  valid_until TEXT NOT NULL
);
CREATE TABLE agent_email_supplier_routes (
  configuration_hash TEXT PRIMARY KEY,
  account_ref TEXT NOT NULL REFERENCES agent_email_supplier_budgets(account_ref)
);
CREATE TABLE agent_email_supplier_commitments (
  job_id TEXT PRIMARY KEY REFERENCES agent_platform_email_outbox(id),
  tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
  account_ref TEXT NOT NULL REFERENCES agent_email_supplier_budgets(account_ref),
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  amount_microusd INTEGER NOT NULL CHECK(amount_microusd>0),
  status TEXT NOT NULL CHECK(status IN ('held','released')),
  created_at TEXT NOT NULL
);
CREATE INDEX agent_email_supplier_usage ON agent_email_supplier_commitments(account_ref,window_start,status);
