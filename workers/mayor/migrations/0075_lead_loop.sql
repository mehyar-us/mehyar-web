-- §4 monthly loop (2026-10-17): last loop send + failure cap on the
-- lead row. A lead is due monthly from its Email 1 date; the loop
-- never sends to unsubscribed leads or before Email 1 lands.
ALTER TABLE mayor_sales_leads ADD COLUMN loop_last_sent_at INTEGER;
ALTER TABLE mayor_sales_leads ADD COLUMN loop_attempts INTEGER NOT NULL DEFAULT 0;
