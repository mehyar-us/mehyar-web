-- 0039_audit_business_reports.sql — "Audit My Business" $330 one-time AI audit.
--
-- Privacy contract (standing):
--   - email_hash is SHA-256 of the lowercased buyer email. The raw email is
--     NEVER stored on this table (billing_payments holds it for receipts).
--   - video_r2_key points at the buyer's walkthrough MP4 in R2. Never log
--     video content; log only key + duration + size.
--   - transcript holds the Whisper transcript of the walkthrough audio.
--
-- Lifecycle: intake -> paid -> generating -> ready | failed
--   intake     free signals preview created (/api/audit/business/intake)
--   paid       Stripe webhook marked paid, generation triggered
--   generating build claimed the row (status lease; stuck > 15 min)
--   ready      report_json + report_html stored, buyer can view via token
--   failed     generation failed; failure_reason is buyer-safe

CREATE TABLE audit_business_reports (
  id TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL,
  url TEXT NOT NULL,
  business_name TEXT,
  status TEXT NOT NULL DEFAULT 'intake',
  video_r2_key TEXT,
  audio_r2_key TEXT,
  transcript TEXT,
  transcript_coverage TEXT,
  signals_json TEXT,
  findings_json TEXT,
  report_json TEXT,
  report_html TEXT,
  access_token TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  status_changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  failure_reason TEXT,
  stripe_payment_intent TEXT,
  stripe_session_id TEXT
);

CREATE INDEX idx_audit_business_email_hash ON audit_business_reports(email_hash);
CREATE INDEX idx_audit_business_status ON audit_business_reports(status);
CREATE INDEX idx_audit_business_access_token ON audit_business_reports(access_token);
