-- Operator-owned evidence. No customer-facing write API may populate this table.
CREATE TABLE agent_platform_email_readiness (
  route_ref TEXT NOT NULL,
  gate TEXT NOT NULL,
  configuration_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','verified','revoked')),
  evidence_ref TEXT NOT NULL,
  verified_by TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  PRIMARY KEY(route_ref,gate,configuration_hash)
);
