-- 0056: Money loop — missed-call text-back, SMS log, booking recovery.
-- Additive only. No changes to existing tables.

CREATE TABLE IF NOT EXISTS mayor_missed_calls (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  connection_id TEXT,
  caller_number TEXT NOT NULL,
  business_number TEXT NOT NULL,
  call_control_id TEXT,
  occurred_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'webhook',
  textback_sent_at TEXT,
  textback_message_id TEXT,
  reply_received_at TEXT,
  reply_body TEXT,
  booking_id TEXT,
  status TEXT NOT NULL DEFAULT 'missed',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_missed_calls_tenant ON mayor_missed_calls(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_missed_calls_status ON mayor_missed_calls(tenant_id, status, occurred_at DESC);

CREATE TABLE IF NOT EXISTS mayor_sms_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  to_number TEXT NOT NULL,
  from_number TEXT NOT NULL,
  body TEXT NOT NULL,
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  related_missed_call_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_sms_log_tenant ON mayor_sms_log(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mayor_appointment_reminders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  booking_id TEXT NOT NULL,
  appointment_at TEXT NOT NULL,
  customer_number TEXT,
  reminder_sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(tenant_id, booking_id)
);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON mayor_appointment_reminders(appointment_at, reminder_sent_at);
