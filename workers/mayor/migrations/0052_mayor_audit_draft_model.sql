-- The model that actually produced the current private draft. NULL identifies
-- historical drafts produced by the original fixed Kimi profile; never backfill
-- a new default into existing report or review history.
ALTER TABLE mayor_audit_orders ADD COLUMN analysis_draft_model TEXT
 CHECK (analysis_draft_model IS NULL OR analysis_draft_model IN
 ('@cf/moonshotai/kimi-k2.6','@cf/deepseek-ai/deepseek-v4-pro-0813'));
