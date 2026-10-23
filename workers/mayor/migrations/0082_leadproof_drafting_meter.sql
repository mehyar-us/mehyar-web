-- 0082_leadproof_drafting_meter.sql
-- Phase 6 (integration spec §4.3): the per-pack drafting meter — the
-- §8.6-pattern internal cost meter carried on the pack row itself
-- (calls now; cost lands with the same convention when the drafting
-- model reports usage).
ALTER TABLE mayor_leadproof_packs ADD COLUMN drafting_calls INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mayor_leadproof_packs ADD COLUMN drafting_cost_microcents INTEGER NOT NULL DEFAULT 0;
