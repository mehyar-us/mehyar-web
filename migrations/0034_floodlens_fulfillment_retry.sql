-- 0034_floodlens_fulfillment_retry.sql
-- Standing-habit safeguards for FloodLens PDF fulfillment (2026-10-05).
-- Incident: floodlens_orders row 5 (payment 231, $9 buyer) orphaned in
-- 'generating' for 3+ hours when its waitUntil() isolate was evicted mid-run
-- (no catch ran, so no 'failed' mark and no email). The 5-minute
-- fulfillment sweep (GitHub Actions -> POST /api/pay/fulfillment-sweep) only
-- covered hustlekit_orders, so nothing retried it.
--
-- These columns let the sweep retry stuck FloodLens rows with a poison-row
-- cap, and make the receipt email exactly-once.
ALTER TABLE floodlens_orders ADD COLUMN drive_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE floodlens_orders ADD COLUMN email_sent_at TEXT;
