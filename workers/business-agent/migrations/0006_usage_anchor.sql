-- New agent billing only. Never apply this to a legacy product database.
ALTER TABLE agent_billing_subscriptions ADD COLUMN usage_anchor TEXT;
