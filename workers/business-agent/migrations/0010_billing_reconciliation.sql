CREATE TABLE agent_billing_reconciliation (
  tenant_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  findings_json TEXT NOT NULL DEFAULT '[]',
  checked_at TEXT,
  next_check_at TEXT NOT NULL,
  lease_token TEXT,
  lease_expires_at TEXT,
  last_error_code TEXT
);
