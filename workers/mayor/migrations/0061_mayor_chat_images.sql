-- Crew 6j: tenant-scoped photo storage for chat image Q&A.
-- Images are the business's data: every row carries tenant_id and every
-- access filters on it. Retention is 90 days (see workers/mayor/docs/image-retention.md),
-- enforced opportunistically on upload; owners can delete a photo any time.
CREATE TABLE IF NOT EXISTS mayor_chat_images(
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 content_type TEXT NOT NULL,
 bytes BLOB NOT NULL,
 byte_size INTEGER NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mayor_chat_images_tenant ON mayor_chat_images(tenant_id, created_at);
