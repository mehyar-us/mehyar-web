-- Archived conversation threads. Starting a new chat archives the current
-- recovery snapshot here instead of deleting it, so past history is preserved
-- while the live thread starts fresh.
CREATE TABLE mayor_conversation_archive (
 tenant_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 thread_id TEXT NOT NULL,
 messages_json TEXT NOT NULL,
 archived_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,user_id,thread_id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES agent_memberships(tenant_id,user_id) ON DELETE CASCADE
);
