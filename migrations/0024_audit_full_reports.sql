-- 0024_audit_full_reports.sql — $5 full 25-page AI evaluation product.
// The tripwire digital product: free teaser -> $5 full report (Stripe) -> $330 founder audit.

CREATE TABLE IF NOT EXISTS audit_full_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER REFERENCES audit_leads(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  url TEXT NOT NULL,
  business TEXT,
  -- Stripe
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent TEXT,
  amount_cents INTEGER NOT NULL DEFAULT 500,
  currency TEXT NOT NULL DEFAULT 'usd',
  paid_at TEXT,
  -- Report
  status TEXT NOT NULL DEFAULT 'pending', -- pending | generating | ready | failed
  report_json TEXT,                        -- FULL_REPORT_SYSTEM output
  report_html TEXT,                        -- rendered deliverable
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  delivered_at TEXT,
  ip_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_full_reports_email ON audit_full_reports(email);
CREATE INDEX IF NOT EXISTS idx_full_reports_session ON audit_full_reports(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_full_reports_status ON audit_full_reports(status);
