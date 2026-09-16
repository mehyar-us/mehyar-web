-- Public pagination identifiers must not reveal Stripe event/object IDs.
ALTER TABLE agent_billing_notices ADD COLUMN public_key TEXT;
UPDATE agent_billing_notices SET public_key=lower(hex(randomblob(16))) WHERE public_key IS NULL;
CREATE UNIQUE INDEX agent_billing_notice_public_key ON agent_billing_notices(public_key);
CREATE INDEX agent_billing_notice_feed ON agent_billing_notices(tenant_id,created_at DESC,public_key DESC);
