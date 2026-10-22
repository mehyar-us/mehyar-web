-- Workstream 7d: AI promo image generation assets (The Mayor).
-- Consolidated by the integrator into the numbered migration series.
-- Every row is AI-generated content: ai_generated=1 always (compliance item 12).
-- Binaries are NOT stored in D1 today (no R2 binding provisioned yet — see the
-- TODO in src/imagegen.ts). r2_key stays NULL until the bucket lands; the
-- generate response returns the image bytes (base64) to the client directly.

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
