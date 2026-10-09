-- 0042_assessment_bookings.sql — post-payment follow-up call booking (R1).
--
-- Funnel continuity: AI mayor (free assessment) -> human Mayor (paid deep-dive).
-- The follow-up call is WITH MAYOR HIMSELF personally — a human-in-the-loop
-- step. Booking is a REQUEST/CONFIRMATION flow, not an auto-call:
--   requested -> confirmed | declined | expired | cancelled
-- Mayor approves via one-click email link (manual approve — his personal time).
-- The manage_token is opaque; only its SHA-256 is stored (same convention as
-- prefill tokens). Raw buyer emails are NEVER stored here (email_hash only);
-- buyer notifications go through the audit crew's emailer via webhook callback
-- (see docs/assessment-call-handoff.md) or the status endpoint.

CREATE TABLE assessment_bookings (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  business_name TEXT,
  slot_start TEXT NOT NULL,                 -- ISO 8601
  slot_end TEXT NOT NULL,                   -- ISO 8601
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  status TEXT NOT NULL DEFAULT 'requested', -- requested|confirmed|declined|expired|cancelled
  manage_token_hash TEXT NOT NULL,          -- SHA-256 of the opaque manage token
  calendar_event_id TEXT,                   -- filled when a Calendar API path exists
  buyer_notified_at TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_assessment_bookings_audit ON assessment_bookings(audit_id);
CREATE INDEX idx_assessment_bookings_status ON assessment_bookings(status);
CREATE INDEX idx_assessment_bookings_slot ON assessment_bookings(slot_start);
CREATE INDEX idx_assessment_bookings_token ON assessment_bookings(manage_token_hash);
