-- Checklist email leg (2026-10-17): Email 1 delivery tracking on
-- the captured lead, plus the unsubscribe marker every follow-up
-- send must honor (compliance item 18).
ALTER TABLE mayor_sales_leads ADD COLUMN email1_sent_at INTEGER;
ALTER TABLE mayor_sales_leads ADD COLUMN email1_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mayor_sales_leads ADD COLUMN unsubscribed_at INTEGER;
