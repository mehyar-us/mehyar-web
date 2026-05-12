-- $330 micro-offer intake fields for Cloudflare D1 lead capture.
-- Apply remotely:
--   npx wrangler d1 migrations apply mehyar_leads_prod --remote

ALTER TABLE leads ADD COLUMN request_type TEXT;
ALTER TABLE leads ADD COLUMN selected_offer TEXT;
ALTER TABLE leads ADD COLUMN offer_code TEXT;
ALTER TABLE leads ADD COLUMN value_estimate INTEGER;
ALTER TABLE leads ADD COLUMN calendar_intent TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_request_type ON leads(request_type);
CREATE INDEX IF NOT EXISTS idx_leads_offer_code ON leads(offer_code);
