-- Reinvention Slice 1 (blueprint §1.4/§1.8): Commitments — anything owed
-- either way, as first-class tenant records. The first writer is the
-- founding door: when a carried purchase intent is fulfilled (the
-- subscription is written from a founding checkout), the consumed intent
-- becomes the tenant's first Commitment, post-claim (blueprint §5,
-- Demand 8 tail). One row per fulfilled checkout, enforced by the
-- deterministic id the writer uses (purchase-intent:<checkout id>) with
-- INSERT OR IGNORE — webhook replays and renewals can never duplicate it.
CREATE TABLE IF NOT EXISTS mayor_commitments(
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 kind TEXT NOT NULL,
 plan_ref TEXT,
 amount_cents INTEGER,
 resource_id TEXT,
 status TEXT NOT NULL DEFAULT 'open',
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mayor_commitments_tenant_created ON mayor_commitments(tenant_id,created_at DESC);
