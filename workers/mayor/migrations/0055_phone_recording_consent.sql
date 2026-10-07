-- Recording-consent acknowledgement for phone calls. The business owner must
-- acknowledge their duty under applicable call-recording consent laws before
-- any phone call can be admitted. Versioned so the text can be revised.
CREATE TABLE mayor_phone_recording_consent (
  tenant_id TEXT PRIMARY KEY,
  consent_version INTEGER NOT NULL,
  acknowledged_at TEXT NOT NULL,
  acknowledged_by TEXT NOT NULL,
  FOREIGN KEY(tenant_id) REFERENCES agent_tenants(id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,acknowledged_by) REFERENCES agent_memberships(tenant_id,user_id) ON DELETE CASCADE
);
