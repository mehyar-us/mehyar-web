-- adgen: Crew 7f ad studio — tenant-scoped Meta ad copy drafts.
-- Drafts only: nothing here launches campaigns, sets budgets, or calls Meta.
-- Additive only; consolidated by the integrator.

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
