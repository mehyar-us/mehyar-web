-- New agent database only. Change references contain no message bodies or credentials.
CREATE TABLE agent_mailbox_sync (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
  grant_id TEXT NOT NULL REFERENCES auth_provider_grants(id),
  provider TEXT NOT NULL CHECK(provider IN ('google','microsoft')),
  resource TEXT NOT NULL,
  authorization TEXT NOT NULL,
  checkpoint TEXT,
  page_cursor TEXT,
  round_id TEXT NOT NULL,
  page_number INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','resync_required')),
  lease_token TEXT,
  lease_until TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX agent_mailbox_sync_tenant ON agent_mailbox_sync(tenant_id,grant_id);
CREATE TABLE agent_mailbox_sync_pages (
  stream_id TEXT NOT NULL REFERENCES agent_mailbox_sync(id),
  token TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  round_id TEXT NOT NULL,
  next_hash TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(stream_id,token),
  UNIQUE(stream_id,round_id,next_hash)
);
CREATE TABLE agent_mailbox_changes (
  stream_id TEXT NOT NULL REFERENCES agent_mailbox_sync(id),
  page_token TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  message_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('upsert','delete')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','applied','discarded')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(stream_id,page_token,ordinal),
  FOREIGN KEY(stream_id,page_token) REFERENCES agent_mailbox_sync_pages(stream_id,token)
);
CREATE INDEX agent_mailbox_changes_pending ON agent_mailbox_changes(stream_id,state,created_at);
