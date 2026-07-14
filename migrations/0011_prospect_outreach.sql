-- 2026-07-14: Prospect outreach engine + reply auto-classification.
-- Tables: prospect_sources, outreach_steps, reply_classifications.
-- Idempotent — all CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.

-- ── prospect_sources ─────────────────────────────────────────────────────────
-- Authoritative registry of where prospects come from and how they map
-- into the outreach pipeline. One row per source kind; the pipeline uses
-- these to route new prospects and attribute sends.
CREATE TABLE IF NOT EXISTS prospect_sources (
  id              TEXT PRIMARY KEY,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),

  name            TEXT NOT NULL UNIQUE,       -- 'NY DOS CSV', 'Google Places', 'Manual CSV', 'Cold Seed List', 'Inbound Web'
  kind            TEXT NOT NULL DEFAULT 'import',  -- 'import' | 'seed' | 'inbound' | 'manual'
  active          INTEGER NOT NULL DEFAULT 1,       -- 1 = in use, 0 = paused

  -- Intake / dedup
  dedup_days      INTEGER NOT NULL DEFAULT 90,       -- last_contact_at dedup window for this source
  enforce_30day    INTEGER NOT NULL DEFAULT 1,       -- 1 = NEVER auto-email within 30 days of created_at

  -- Attribution
  tag             TEXT NOT NULL DEFAULT '',          -- lightweight label appended to subject line
  description     TEXT NOT NULL DEFAULT '',
  contact_url     TEXT NOT NULL DEFAULT ''            -- where to POST new prospects from this source
);

CREATE INDEX IF NOT EXISTS idx_prospect_sources_kind   ON prospect_sources(kind);
CREATE INDEX IF NOT EXISTS idx_prospect_sources_active  ON prospect_sources(active);

-- Seed the canonical sources (idempotent — ON CONFLICT DO NOTHING via INSERT OR IGNORE)
INSERT OR IGNORE INTO prospect_sources (id, name, kind, active, dedup_days, enforce_30day, tag, description) VALUES
  ('src_ny_dos',      'NY DOS CSV',       'import',  1, 90, 1, '[NY DOS]',    'Scraped from New York Department of State entity search'),
  ('src_google',      'Google Places',    'import',  1, 90, 1, '[Google]',    'Discovered via Google Places API — local service businesses'),
  ('src_manual_csv',  'Manual CSV',       'import',  1, 90, 1, '',             'Bulk-imported from a manually-uploaded CSV'),
  ('src_seed',        'Cold Seed List',   'seed',    1, 90, 1, '[Cold]',      'Curated B2B seed list — no prior relationship'),
  ('src_inbound',     'Inbound Web',      'inbound', 1, 30, 0, '[Inbound]',    'Opt-in form submissions from mehyar.us visitors');

-- ── outreach_steps ───────────────────────────────────────────────────────────
-- Multi-step outreach sequence definition. Each prospect in a campaign
-- follows the steps in order. Steps can be: email, follow-up, or manual.
CREATE TABLE IF NOT EXISTS outreach_steps (
  id              TEXT PRIMARY KEY,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),

  name            TEXT NOT NULL,         -- 'Day 1 — Cold Email', 'Day 4 — Follow-Up', 'Day 11 — Break-Up'
  source_id       TEXT NOT NULL,         -- FK → prospect_sources.id
  step_order      INTEGER NOT NULL DEFAULT 1,   -- 1-based sequence position

  type            TEXT NOT NULL DEFAULT 'email',  -- 'email' | 'followup' | 'manual' | 'linkedin' | 'phone'

  -- Sending rules
  delay_days      INTEGER NOT NULL DEFAULT 0,    -- days AFTER the previous step was sent/completed
  require_manual_approval INTEGER NOT NULL DEFAULT 1,  -- 1 = owner must click "Approve & Send" before dispatch
  auto_skippable  INTEGER NOT NULL DEFAULT 0,    -- 1 = skip automatically if reply received from a later step

  -- Email fields
  subject_template TEXT NOT NULL DEFAULT '',
  body_template    TEXT NOT NULL DEFAULT '',
  from_name        TEXT NOT NULL DEFAULT 'Mehyar | MehyarSoft',
  from_email       TEXT NOT NULL DEFAULT 'hello@mehyar.us',

  -- Suppression / dedup
  skip_if_replied  INTEGER NOT NULL DEFAULT 1,   -- 1 = don't send if prospect has any 'replied' reply record

  active          INTEGER NOT NULL DEFAULT 1,
  description     TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_outreach_steps_source  ON outreach_steps(source_id, step_order);

-- Seed default cold-outreach sequence for 'Cold Seed List' (src_seed)
INSERT OR IGNORE INTO outreach_steps (id, name, source_id, step_order, type, delay_days, require_manual_approval, skip_if_replied, active, subject_template, body_template) VALUES
  ('step_s1', 'Day 0 — Cold Email',         'src_seed', 1, 'email',     0, 1, 1, 1,
   '{{business_name}} — quick question',
   'Hi {{first_name}},\n\nI noticed {{business_name}} has a great presence in {{city}}.\n\nI have a quick idea that could help {{vertical}} businesses like yours grow — happy to share in 2 minutes.\n\nWould a short call this week work?\n\nBest,\nMehyar'),
  ('step_s2', 'Day 4 — Follow-Up #1',        'src_seed', 2, 'followup',  4, 1, 1, 1,
   'Re: {{business_name}} — quick question',
   'Hi {{first_name}},\n\nFollowing up on my note — just a quick check-in.\n\nIf the timing is off, no worries at all. Happy to connect another time.\n\nBest,\nMehyar'),
  ('step_s3', 'Day 11 — Break-Up Email',     'src_seed', 3, 'email',    11, 1, 1, 1,
   'One last thought on {{business_name}}',
   'Hi {{first_name}},\n\nI''ll leave you alone after this 🙂\n\nIf you ever want to explore how {{vertical}} businesses are using automation to grow — just reply here.\n\nWishing {{business_name}} all the best,\nMehyar');

-- Seed default cold-outreach sequence for 'NY DOS CSV'
INSERT OR IGNORE INTO outreach_steps (id, name, source_id, step_order, type, delay_days, require_manual_approval, skip_if_replied, active, subject_template, body_template) VALUES
  ('step_ny1', 'Day 0 — Cold Email',         'src_ny_dos', 1, 'email',     0, 1, 1, 1,
   '{{business_name}} — quick question',
   'Hi {{first_name}},\n\nI noticed {{business_name}} is registered in New York and has a strong local presence.\n\nI have a quick idea that could help {{vertical}} businesses like yours grow — happy to share in 2 minutes.\n\nWould a short call this week work?\n\nBest,\nMehyar'),
  ('step_ny2', 'Day 4 — Follow-Up #1',        'src_ny_dos', 2, 'followup',  4, 1, 1, 1,
   'Re: {{business_name}} — quick question',
   'Hi {{first_name}},\n\nFollowing up on my note — just a quick check-in.\n\nIf the timing is off, no worries at all. Happy to connect another time.\n\nBest,\nMehyar'),
  ('step_ny3', 'Day 11 — Break-Up Email',     'src_ny_dos', 3, 'email',    11, 1, 1, 1,
   'One last thought on {{business_name}}',
   'Hi {{first_name}},\n\nI''ll leave you alone after this 🙂\n\nIf you ever want to explore how {{vertical}} businesses are using automation to grow — just reply here.\n\nWishing {{business_name}} all the best,\nMehyar');

-- ── reply_classifications ────────────────────────────────────────────────────
-- Tracks the auto-classification of inbound replies to outreach emails.
-- Classification is set once on first receipt; only 'unclassified' can be
-- re-classified manually. The 'unread' default only exists to satisfy schema.
CREATE TABLE IF NOT EXISTS reply_classifications (
  id                  TEXT PRIMARY KEY,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),

  reply_id            TEXT NOT NULL,          -- FK → prospect_replies.id
  prospect_id         TEXT NOT NULL,          -- FK → prospects.id (denormalized for fast queries)

  -- Classification labels
  label               TEXT NOT NULL DEFAULT 'unclassified',  -- interest | unsubscribe | stop | out_of_office | objection | not_interested | invalid | warm | unclassified
  confidence          REAL NOT NULL DEFAULT 0,   -- 0.0–1.0, set by LLM classifier or 1.0 if manual

  -- Audit
  classified_by       TEXT NOT NULL DEFAULT 'system',  -- 'system' | 'llm' | 'manual'
  classifier_version  TEXT NOT NULL DEFAULT '',
  review_notes        TEXT NOT NULL DEFAULT '',
  reviewed_at         TEXT                              -- NULL until a human reviews

  -- Triggered actions (set atomically when label is applied)
  action_taken        TEXT NOT NULL DEFAULT 'none',    -- none | suppress_added | note_appended | stage_changed | replied_recorded

  UNIQUE(reply_id)
);

CREATE INDEX IF NOT EXISTS idx_reply_classifications_reply     ON reply_classifications(reply_id);
CREATE INDEX IF NOT EXISTS idx_reply_classifications_prospect  ON reply_classifications(prospect_id);
CREATE INDEX IF NOT EXISTS idx_reply_classifications_label     ON reply_classifications(label);
