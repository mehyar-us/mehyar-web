-- 0028: async free-audit scans. The client POSTs once (fast), the scan runs in
-- the background via waitUntil, and the client polls for completion. This
-- survives iOS Safari backgrounding, reloads, and network blips: the server
-- keeps working and the client resumes polling with the scan_id.
CREATE TABLE IF NOT EXISTS audit_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id TEXT NOT NULL UNIQUE,          -- 32-hex token, returned to the client
  url TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  business TEXT,
  phone TEXT,
  zip TEXT,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | working | ready | failed
  progress TEXT,                         -- fetching | analyzing | finalizing
  report_json TEXT,
  lead_id INTEGER REFERENCES audit_leads(id) ON DELETE SET NULL,
  emailed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_scans_scan_id ON audit_scans(scan_id);
CREATE INDEX IF NOT EXISTS idx_audit_scans_status ON audit_scans(status);
CREATE INDEX IF NOT EXISTS idx_audit_scans_created ON audit_scans(created_at);
