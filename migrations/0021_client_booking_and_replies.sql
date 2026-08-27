CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  lead_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'pending',
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  company TEXT,
  service_interest TEXT,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'booking_page',
  zoho_event_id TEXT,
  zoho_calendar_uid TEXT,
  zoho_view_url TEXT,
  zoho_meeting_url TEXT,
  provider_status TEXT,
  provider_error TEXT,
  client_email_status TEXT NOT NULL DEFAULT 'pending',
  owner_email_status TEXT NOT NULL DEFAULT 'pending',
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_zoho_event_id
  ON appointments(zoho_event_id)
  WHERE zoho_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_starts_at
  ON appointments(starts_at DESC);

CREATE INDEX IF NOT EXISTS idx_appointments_status
  ON appointments(status, starts_at DESC);

CREATE TABLE IF NOT EXISTS client_replies (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  to_email TEXT NOT NULL,
  from_email TEXT NOT NULL DEFAULT 'info@mehyar.us',
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'cloudflare_email_service',
  provider_message_id TEXT,
  provider_error TEXT,
  actor TEXT NOT NULL DEFAULT 'owner',
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE INDEX IF NOT EXISTS idx_client_replies_lead_created
  ON client_replies(lead_id, created_at DESC);
