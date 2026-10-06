-- 0036_billing_trial_days.sql
-- Trusted trial length (days) for subscription SKUs. The centralized checkout
-- passes subscription_data[trial_period_days] when trial_days > 0.
-- Used by the AI Mechanic SKUs (7-day trial, matches the historic offer).
-- Additive only.

ALTER TABLE billing_products ADD COLUMN trial_days INTEGER NOT NULL DEFAULT 0;
