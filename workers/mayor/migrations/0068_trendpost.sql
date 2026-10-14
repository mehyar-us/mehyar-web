-- 0068_trendpost.sql — Trendpost (Mayor, 2026-10-14): weekly posting plans
-- with review-gated drafts. One active plan per tenant; posts are decided
-- one by one (pending -> approved | edited -> approved | skipped). Nothing
-- here publishes — approval marks a post ready; channel dispatch stays
-- behind the existing connector state (Meta posting is dark fleet-wide).
CREATE TABLE IF NOT EXISTS mayor_trendpost_plans(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  week_start TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active',
  source TEXT NOT NULL DEFAULT 'generated',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trendpost_plans_tenant ON mayor_trendpost_plans(tenant_id, created_at DESC);
CREATE TABLE IF NOT EXISTS mayor_trendpost_posts(
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  day_index INTEGER NOT NULL,
  slot TEXT NOT NULL,
  kind TEXT NOT NULL,
  angle TEXT NOT NULL,
  draft TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  decided_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trendpost_posts_plan ON mayor_trendpost_posts(plan_id, day_index);
CREATE INDEX IF NOT EXISTS idx_trendpost_posts_tenant ON mayor_trendpost_posts(tenant_id, state);
