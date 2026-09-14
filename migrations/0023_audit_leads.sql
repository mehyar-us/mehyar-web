-- 0023_audit_leads.sql — AI Website Audit funnel (mehyar.us)
-- Free teaser scan -> lead capture -> drip -> $199 deep audit / $330 tech audit.

CREATE TABLE IF NOT EXISTS audit_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  name TEXT,
  business TEXT,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  teaser_score INTEGER,
  teaser_json TEXT,
  deep_status TEXT NOT NULL DEFAULT 'none', -- none | requested | invoiced | paid | delivered
  deep_requested_at TEXT,
  ip_hash TEXT,
  unsubscribed INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'site' -- site | launch_blast | manual
);

CREATE INDEX IF NOT EXISTS idx_audit_leads_email ON audit_leads(email);
CREATE INDEX IF NOT EXISTS idx_audit_leads_created ON audit_leads(created_at);

CREATE TABLE IF NOT EXISTS audit_drip_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES audit_leads(id) ON DELETE CASCADE,
  day INTEGER NOT NULL, -- 0,1,2,4,7
  sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  status TEXT NOT NULL DEFAULT 'sent', -- sent | failed
  error TEXT,
  UNIQUE(lead_id, day)
);

CREATE INDEX IF NOT EXISTS idx_audit_drip_lead ON audit_drip_sends(lead_id);
