-- Platform transaction mail only; never imported by legacy product senders.
-- Trusted operator/provider-event ingestion owns writes. There is no public writer.
-- '*' blocks this recipient across platform workspaces; a tenant id limits the block.
CREATE TABLE agent_platform_email_suppressions (
  recipient TEXT NOT NULL CHECK(recipient=lower(trim(recipient)) AND length(recipient)>0),
  scope_key TEXT NOT NULL CHECK(length(scope_key)>0),
  reason TEXT NOT NULL CHECK(reason IN ('hard_bounce','complaint','recipient_request','operator')),
  status TEXT NOT NULL CHECK(status IN ('active','released')),
  evidence_ref TEXT NOT NULL CHECK(length(trim(evidence_ref))>0),
  recorded_by TEXT NOT NULL CHECK(length(trim(recorded_by))>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(recipient,scope_key)
);
