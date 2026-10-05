-- 0035_fulfillment_selfheal.sql
-- Self-heal columns for the all-products fulfillment sweep (2026-10-05).
-- Every AI-generation order table gets:
--   email_sent_at  TEXT  — exactly-once buyer deliverable email claim
--   drive_attempts INTEGER — sweep redrive counter (poison-row guard)
--   failure_reason TEXT  — last failure, for the dashboard/debugging
-- Additive only. Applied 2026-10-05 via the D1 API; journal row inserted
-- manually so future `wrangler d1 migrations apply` runs skip this file.

ALTER TABLE designful_orders ADD COLUMN email_sent_at TEXT;
ALTER TABLE designful_orders ADD COLUMN drive_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE designful_orders ADD COLUMN failure_reason TEXT;

ALTER TABLE prepguide_orders ADD COLUMN email_sent_at TEXT;
ALTER TABLE prepguide_orders ADD COLUMN drive_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE prepguide_orders ADD COLUMN failure_reason TEXT;

ALTER TABLE promptpack_orders ADD COLUMN drive_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE promptpack_orders ADD COLUMN failure_reason TEXT;

ALTER TABLE tiktokgrowth_orders ADD COLUMN drive_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE sproutscore_orders ADD COLUMN drive_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE puretap_orders ADD COLUMN email_sent_at TEXT;
ALTER TABLE puretap_orders ADD COLUMN drive_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE puretap_orders ADD COLUMN failure_reason TEXT;

ALTER TABLE ticketbeat_orders ADD COLUMN email_sent_at TEXT;
ALTER TABLE ticketbeat_orders ADD COLUMN drive_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ticketbeat_orders ADD COLUMN failure_reason TEXT;

ALTER TABLE truesketch_orders ADD COLUMN email_sent_at TEXT;
ALTER TABLE truesketch_orders ADD COLUMN drive_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE truesketch_orders ADD COLUMN failure_reason TEXT;

ALTER TABLE bizbuilder_orders ADD COLUMN email_sent_at TEXT;
ALTER TABLE bizbuilder_orders ADD COLUMN drive_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bizbuilder_orders ADD COLUMN failure_reason TEXT;

ALTER TABLE creditfixkit_orders ADD COLUMN email_sent_at TEXT;
ALTER TABLE creditfixkit_orders ADD COLUMN drive_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE creditfixkit_orders ADD COLUMN failure_reason TEXT;

ALTER TABLE hustlekit_orders ADD COLUMN failure_reason TEXT;
