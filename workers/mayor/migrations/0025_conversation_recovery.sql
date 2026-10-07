-- Bounded recovery copy; live conversation storage remains in its Durable Object.
CREATE TABLE mayor_conversation_recovery (
 tenant_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,
 messages_json TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,user_id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES agent_memberships(tenant_id,user_id) ON DELETE CASCADE
);
