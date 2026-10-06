-- 0037_billing_subscription_lifecycle.sql
-- Mirror Stripe subscription lifecycle fields onto billing_payments so
-- satellite products (AI Mechanic, …) can render trial countdowns and
-- cancel-at-period-end notices without their own Stripe keys.
-- Populated by the shared webhook's customer.subscription.created/updated
-- branch. Additive only.

ALTER TABLE billing_payments ADD COLUMN cancel_at_period_end INTEGER NOT NULL DEFAULT 0;
ALTER TABLE billing_payments ADD COLUMN current_period_end TEXT;
ALTER TABLE billing_payments ADD COLUMN trial_start TEXT;
