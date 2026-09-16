-- New AGENT_DB only. A lost refresh response must not cause blind token rotation retries.
CREATE TABLE agent_credential_refreshes (
  grant_id TEXT PRIMARY KEY REFERENCES auth_provider_grants(id) ON DELETE CASCADE,
  credential_hash TEXT NOT NULL,
  lease_token TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','uncertain')),
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
