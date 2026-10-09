-- 0040_assessment_call_leads.sql — "Audit My Business" assessment-call CRM leads.
--
-- Privacy contract (standing, matches audit_business_reports 0039):
--   - email_hash is SHA-256 of the lowercased caller email. The raw email is
--     NEVER stored in these tables — the end-call route holds it in memory for
--     the single transactional send, then drops it.
--   - ip_hash is SHA-256 of the caller IP (rate-limit + abuse joins only).
--   - transcripts: state_json keeps the turn log (needed to build the audit
--     prefill + findings). No audio is stored by this crew (infra crew owns
--     the media pipeline and its own retention policy).
--   - assessment_findings rows are measured facts (see assessmentDiagnose.js),
--     each with severity + evidence so the audit engine can reuse them.
--
-- Lifecycle: started -> consented -> diagnosed -> pitched -> closed
--   closed outcomes: booked | followup | declined

CREATE TABLE assessment_sessions (
  id TEXT PRIMARY KEY,
  consent_at TEXT,                                  -- NULL until explicit yes
  ip_hash TEXT,
  business_name TEXT,
  business_url TEXT,
  category TEXT,
  contact_name TEXT,
  email_hash TEXT,                                  -- SHA-256 only, never raw
  acquisition TEXT,
  state_json TEXT,                                  -- full brain session (turns, stage, outcome)
  findings_json TEXT,                               -- severity-scored findings snapshot
  outcome TEXT,                                     -- booked | followup | declined | NULL
  followup_consent INTEGER NOT NULL DEFAULT 0,      -- single nudge email consent
  marketing_opt_out INTEGER NOT NULL DEFAULT 0,     -- one-click unsubscribe honored
  prefill_token_hash TEXT,                          -- latest prefill token (hash)
  email_sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  closed_at TEXT
);

CREATE INDEX idx_assessment_sessions_outcome ON assessment_sessions(outcome);
CREATE INDEX idx_assessment_sessions_email_hash ON assessment_sessions(email_hash);
CREATE INDEX idx_assessment_sessions_created ON assessment_sessions(created_at);

-- Severity-scored findings per session (mirrors into findings_json).
CREATE TABLE assessment_findings (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES assessment_sessions(id),
  finding_id TEXT NOT NULL,                         -- e.g. "no_https"
  severity TEXT NOT NULL,                           -- low | medium | high
  severity_source TEXT NOT NULL DEFAULT 'deterministic', -- deterministic | decide
  needs_review INTEGER NOT NULL DEFAULT 0,          -- decide() low-confidence flag
  title TEXT NOT NULL,
  observation TEXT NOT NULL,                        -- speakable, measured
  evidence TEXT NOT NULL,                           -- the raw measurement
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_assessment_findings_session ON assessment_findings(session_id);

-- Tokenized, expiring prefill links. Opaque token; only the SHA-256 is stored.
-- One active token per session; 7-day TTL enforced server-side on redeem.
CREATE TABLE assessment_prefill_tokens (
  token_hash TEXT PRIMARY KEY,                      -- SHA-256 of the opaque token
  session_id TEXT NOT NULL REFERENCES assessment_sessions(id),
  email_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_assessment_prefill_session ON assessment_prefill_tokens(session_id);
CREATE INDEX idx_assessment_prefill_expires ON assessment_prefill_tokens(expires_at);
