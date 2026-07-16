-- 2026-07-16: Track when each prospect was last deep-evaluated so the daily
-- cron pipeline doesn't re-fire the LLM on the same row every 24h.
-- Idempotent — ALTER TABLE … ADD COLUMN is not idempotent in SQLite, so we
-- use the standard "try ADD COLUMN, swallow duplicate-column error" pattern
-- by checking sqlite_master via the shell-side migrate script.

ALTER TABLE prospects ADD COLUMN last_deep_eval_at TEXT;
CREATE INDEX IF NOT EXISTS idx_prospects_last_deep_eval_at ON prospects(last_deep_eval_at);