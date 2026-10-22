-- Crew 7b: content calendar + auto-posting (growth-calendar).
-- Additive only. Two new tables; no changes to existing tables.
--
-- Approval model: a post publishes ONLY when it is explicitly owner-approved.
-- Approval is per-post, or inherited from an owner-approved series (campaign).
-- runDuePosts() (src/growth-calendar.ts) is the only writer of terminal
-- statuses; every attempt records publish_mode honestly. The connector layer
-- is test-gated today, so no attempt may ever write status='sent'.

CREATE TABLE IF NOT EXISTS mayor_social_series (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 name TEXT NOT NULL,
 channels_json TEXT NOT NULL DEFAULT '[]',
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
 approved_by TEXT,
 approved_at TEXT,
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_social_series_tenant ON mayor_social_series(tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS mayor_social_posts (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 series_id TEXT REFERENCES mayor_social_series(id),
 channel TEXT NOT NULL CHECK(channel IN ('instagram','facebook','tiktok','x')),
 language TEXT NOT NULL DEFAULT 'en',
 copy_text TEXT NOT NULL DEFAULT '',
 post_copy_id TEXT,
 image_ids_json TEXT NOT NULL DEFAULT '[]',
 video_job_id TEXT,
 scheduled_for TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft'
   CHECK(status IN ('draft','scheduled','approved','sending','sent','failed','cancelled')),
 approved_by TEXT,
 approved_at TEXT,
 failure_reason TEXT,
 retry_count INTEGER NOT NULL DEFAULT 0,
 publish_mode TEXT NOT NULL DEFAULT 'test-gated' CHECK(publish_mode IN ('test-gated','live')),
 remote_id TEXT,
 last_attempt_at TEXT,
 dedupe_key TEXT NOT NULL,
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(tenant_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_social_posts_due ON mayor_social_posts(tenant_id, status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_social_posts_tenant ON mayor_social_posts(tenant_id, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_social_posts_series ON mayor_social_posts(tenant_id, series_id);
