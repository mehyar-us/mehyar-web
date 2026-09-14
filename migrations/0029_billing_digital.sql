-- 0029: digital product delivery (Stripe shared checkout).
-- Adds the file path for token-gated digital downloads.
ALTER TABLE billing_products ADD COLUMN digital_file TEXT;
