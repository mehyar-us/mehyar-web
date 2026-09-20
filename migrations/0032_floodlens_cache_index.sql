-- 0032_floodlens_cache_index.sql
-- Index for the freshness-correct cache lookup (filters on queried_at,
-- the original FEMA query time, not the copy's created_at).
CREATE INDEX IF NOT EXISTS idx_floodlens_lookups_geohash_queried
  ON floodlens_lookups(geohash, queried_at);
