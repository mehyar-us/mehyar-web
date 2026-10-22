-- Crew 7 video studio: owner-approved AI video job lifecycle.
-- The worker NEVER generates video itself and never calls a third-party video API.
-- An agent-side runner (outside the worker) claims `queued` jobs, generates via
-- Muse's media pipeline, burns captions, and completes them.
-- See the header comment of src/videogen.ts for the handoff contract.
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
