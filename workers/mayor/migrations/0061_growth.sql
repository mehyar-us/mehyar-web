-- Crew 7 Growth Engine: consolidated migration (social connectors, content calendar, post/image/video/ad generation).
-- All tables additive; nothing publishes, spends, or posts without explicit owner approval.

-- ---------- from pending/social.sql ----------
CREATE TABLE IF NOT EXISTS mayor_social_connections (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('instagram','facebook','tiktok','x')),
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK(status IN ('pending','connected','error','disconnected')),
  ciphertext TEXT NOT NULL DEFAULT '',
  has_secret INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT,
  last_check_status TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(tenant_id, user_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_social_connections_tenant
  ON mayor_social_connections(tenant_id, user_id, status);
CREATE TABLE IF NOT EXISTS mayor_social_publish_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES mayor_social_connections(id),
  provider TEXT NOT NULL CHECK(provider IN ('instagram','facebook','tiktok','x')),
  caption TEXT NOT NULL DEFAULT '',
  media_url TEXT,
  status TEXT NOT NULL
    CHECK(status IN ('draft','scheduled','sent','failed','test_simulated')),
  provider_post_id TEXT,
  error_code TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_social_publish_records_connection
  ON mayor_social_publish_records(connection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_publish_records_tenant
  ON mayor_social_publish_records(tenant_id, user_id, created_at DESC);

-- ---------- from pending/growth-calendar.sql ----------
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

-- ---------- from pending/postgen.sql ----------
CREATE TABLE IF NOT EXISTS mayor_post_drafts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  post_type TEXT NOT NULL,
  topic TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  body_text TEXT NOT NULL DEFAULT '',
  review_text TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  -- Owner-supplied facts at generation time (offerDetails, scarcity) so an
  -- edit re-scans compliance against the original facts.
  facts_json TEXT NOT NULL DEFAULT '{}',
  compliance_flags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mayor_post_drafts_tenant
  ON mayor_post_drafts(tenant_id, updated_at DESC, id DESC);

-- ---------- from pending/imagegen.sql ----------
CREATE TABLE IF NOT EXISTS mayor_imagegen_assets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  use_case TEXT NOT NULL,            -- service_promo | seasonal_offer | social_creative | before_after_frame
  prompt TEXT NOT NULL,              -- owner's own brief (screened by honesty guardrails)
  final_prompt TEXT NOT NULL,        -- full prompt sent to the model (includes honesty footer)
  model TEXT NOT NULL DEFAULT '@cf/black-forest-labs/flux-1-schnell',
  ai_generated INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'generated',  -- generated | deleted
  r2_key TEXT,                       -- NULL until the R2 bucket is provisioned
  used_in TEXT,                      -- JSON array of post ids this asset was attached to
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_imagegen_tenant_created
  ON mayor_imagegen_assets (tenant_id, created_at DESC);

-- ---------- from pending/videogen.sql ----------
CREATE TABLE IF NOT EXISTS video_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('service_promo_15s','offer_announcement_30s')),
  vertical TEXT NOT NULL DEFAULT 'other',
  offer TEXT,
  services TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','script_pending','script_approved',
    'storyboard_pending','storyboard_approved',
    'queued','generating','ready','failed'
  )),
  script TEXT,
  script_approved_by TEXT,
  script_approved_at TEXT,
  storyboard_json TEXT,
  storyboard_approved_by TEXT,
  storyboard_approved_at TEXT,
  voiceover_text TEXT,
  caption_text TEXT,
  brand_json TEXT,
  result_asset_url TEXT,
  failure_reason TEXT,
  claimed_by TEXT,
  claimed_at TEXT,
  lease_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_video_jobs_tenant ON video_jobs(tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_video_jobs_claim ON video_jobs(status, created_at);

-- ---------- from pending/adgen.sql ----------
CREATE TABLE IF NOT EXISTS ad_drafts (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 offer TEXT NOT NULL,
 goal TEXT NOT NULL CHECK(goal IN ('bookings','sales','leads','awareness')),
 language TEXT NOT NULL DEFAULT 'en',
 copy_json TEXT NOT NULL DEFAULT '{}',
 creative_refs_json TEXT NOT NULL DEFAULT '[]',
 validation_json TEXT NOT NULL DEFAULT '[]',
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ad_drafts_tenant ON ad_drafts(tenant_id, user_id, updated_at DESC);

