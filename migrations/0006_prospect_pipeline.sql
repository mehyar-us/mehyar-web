-- MehyarSoft prospect outbound pipeline (cold-B2B).
-- Phase 1 (this migration): local prospect store, leak signals, draft + send queue,
-- compliance audit + suppression sync. Apply with:
--   npx wrangler d1 migrations apply mehyar_leads_prod --remote

-- ── Prospects ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prospects (
  id TEXT PRIMARY KEY,                                -- uuid
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  source TEXT NOT NULL,                               -- 'ny_dos_csv' | 'google_places' | 'manual_csv' | 'manual' | 'seed'
  source_ref TEXT,                                    -- raw id from source (DOS process id, google place_id, etc.)

  business_name TEXT NOT NULL,
  website TEXT,                                       -- canonicalized to root domain
  root_domain TEXT NOT NULL,
  email TEXT,                                         -- best-effort discoverable email (enriched later)
  email_source TEXT,                                  -- 'page' | 'pattern' | 'manual' | null
  phone TEXT,

  vertical TEXT,                                      -- 'dental' | 'hvac' | 'real_estate' | 'therapy' | 'legal' | etc.
  city TEXT,
  region TEXT,
  country TEXT NOT NULL DEFAULT 'US',
  postal_code TEXT,

  status TEXT NOT NULL DEFAULT 'new',                 -- new|scanned|drafted|approved|queued|sent|replied|unsubscribed|bounced|skipped|invalid
  consent_state TEXT NOT NULL DEFAULT 'unknown',      -- TCPA / CAN-SPAM — we only ever send when 'business_interest_b2b'

  last_scanned_at TEXT,
  last_drafted_at TEXT,
  last_sent_at TEXT,
  last_contact_at TEXT,                               -- for dedupe: 90-day per business window

  meta_json TEXT NOT NULL DEFAULT '{}'                -- free-form: source-specific detail
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_prospects_domain   ON prospects(root_domain);
CREATE INDEX        IF NOT EXISTS idx_prospects_status   ON prospects(status);
CREATE INDEX        IF NOT EXISTS idx_prospects_vertical ON prospects(vertical, city);
CREATE INDEX        IF NOT EXISTS idx_prospects_last     ON prospects(last_contact_at);

-- ── Leak signals (the moat: what we actually detected on their site) ────────────
CREATE TABLE IF NOT EXISTS prospect_signals (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL,
  scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
  http_ok INTEGER NOT NULL DEFAULT 0,
  https_ok INTEGER NOT NULL DEFAULT 0,
  redirect_url TEXT,
  status_code INTEGER,

  title TEXT,
  has_viewport INTEGER,
  has_booking_cta INTEGER,                            -- "Book", "Schedule", "Request appointment", "Reserve", "Buy now"
  has_phone_click_to_call INTEGER,                    -- <a href="tel:…">
  has_form_action INTEGER,                            -- <form action=…> on homepage
  has_email_link INTEGER,                             -- mailto: link
  has_address INTEGER,                                -- physically present on page
  has_ssl INTEGER,                                    -- https + valid cert
  ssl_expires_at TEXT,
  page_weight_kb INTEGER,
  load_time_ms INTEGER,
  detected_platform TEXT,                             -- wordpress|wix|squarespace|webflow|shopify|hubspot|unknown
  detected_cms_hints TEXT,                            -- json array of signals used

  leak_signals_json TEXT NOT NULL DEFAULT '[]',       -- ["no_https","no_booking_cta",…] — drives the email copy
  leak_score INTEGER NOT NULL DEFAULT 0,              -- 0–100, higher = more leaks found (more receptive prospect)
  notes TEXT,

  FOREIGN KEY (prospect_id) REFERENCES prospects(id)
);

CREATE INDEX IF NOT EXISTS idx_prospect_signals_pid ON prospect_signals(prospect_id);
CREATE INDEX IF NOT EXISTS idx_prospect_signals_score ON prospect_signals(leak_score DESC);

-- ── Email drafts (LLM output) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prospect_drafts (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  generated_by TEXT NOT NULL DEFAULT 'manual',        -- 'model' | 'manual' | 'fallback_template'
  model TEXT,                                         -- e.g. 'gpt-4o-mini' | 'manual' | null
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT,                                     -- optional plain HTML (no images for cold)
  cited_signals_json TEXT NOT NULL DEFAULT '[]',      -- copy of leak_signals used, for audit
  status TEXT NOT NULL DEFAULT 'draft',               -- draft|approved|rejected|superseded
  reviewer_notes TEXT,

  FOREIGN KEY (prospect_id) REFERENCES prospects(id)
);

CREATE INDEX IF NOT EXISTS idx_prospect_drafts_pid_status ON prospect_drafts(prospect_id, status);

-- ── Send queue (state machine) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prospect_sends (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  scheduled_for TEXT,                                 -- null = send immediately on approval
  attempted_at TEXT,
  finished_at TEXT,
  provider TEXT NOT NULL DEFAULT 'resend',            -- 'resend' | 'manual'
  provider_id TEXT,                                   -- resend email id
  to_email TEXT NOT NULL,
  from_email TEXT NOT NULL,
  reply_to TEXT,
  subject TEXT NOT NULL,

  -- CAN-SPAM + RFC 8058
  list_unsub_header TEXT,                             -- mailto: + https:// in one header
  physical_address TEXT NOT NULL,                     -- required at send time

  status TEXT NOT NULL DEFAULT 'queued',              -- queued|sent|delivered|bounced|complained|unsubscribed|replied|failed|skipped_suppressed
  failure_reason TEXT,
  test_only INTEGER NOT NULL DEFAULT 0,               -- 1 = bcc to founder for visible proof

  FOREIGN KEY (prospect_id) REFERENCES prospects(id),
  FOREIGN KEY (draft_id)    REFERENCES prospect_drafts(id)
);

CREATE INDEX IF NOT EXISTS idx_prospect_sends_pid     ON prospect_sends(prospect_id);
CREATE INDEX IF NOT EXISTS idx_prospect_sends_status  ON prospect_sends(status);
CREATE INDEX IF NOT EXISTS idx_prospect_sends_sched   ON prospect_sends(scheduled_for);

-- ── Inbox reply events (parsed from inbound webhooks later; manual for now) ────
CREATE TABLE IF NOT EXISTS prospect_replies (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL,
  send_id TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  from_email TEXT NOT NULL,
  subject TEXT,
  body_excerpt TEXT,                                  -- truncate body to 4 KB
  classification TEXT NOT NULL DEFAULT 'unread',      -- interest|unsubscribe|stop|out_of_office|objection|not_interested|invalid|warm|unclassified
  manually_synced INTEGER NOT NULL DEFAULT 0,          -- 1 = founder pasted in
  created_action TEXT,                                -- suppression_added|note_appended|null

  FOREIGN KEY (prospect_id) REFERENCES prospects(id)
);

CREATE INDEX IF NOT EXISTS idx_prospect_replies_pid ON prospect_replies(prospect_id);
CREATE INDEX IF NOT EXISTS idx_prospect_replies_cls ON prospect_replies(classification);
