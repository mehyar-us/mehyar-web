-- Migration 0019: revenue cockpit value fields.
--
-- The decision endpoint records value_usd/outcome for won/lost/no-bid
-- outcomes, but the original 0012 decision table did not include those
-- columns. Add them so the Money dashboard can use real won value instead of
-- placeholder counts.

ALTER TABLE opportunity_decisions ADD COLUMN outcome TEXT;
ALTER TABLE opportunity_decisions ADD COLUMN value_usd REAL NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_opp_decisions_value ON opportunity_decisions(decision, value_usd);
