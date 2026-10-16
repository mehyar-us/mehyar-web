-- Founding-cohort bookkeeping (2026-10-16): the subscription writer records
-- which dedicated Price each subscription is on (the founding counter reads
-- it), and a checkout records its cohort so open founding checkouts can
-- reserve their seat at the checkout gate. Existing rows stay NULL — they
-- predate the cohort and are never founding rows.
ALTER TABLE mayor_billing_subscriptions ADD COLUMN price_id TEXT;
ALTER TABLE mayor_billing_checkouts ADD COLUMN cohort TEXT;
