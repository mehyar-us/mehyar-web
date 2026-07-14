-- 2026-07-14: Migration 0012
-- 1. opportunity_decisions — per-opportunity win/loss/reason records
-- 2. case_studies          — public-facing success story pages (slug-based)
-- 3. case_study_pages      — individual sections/pages within a case study
-- Apply with: npx wrangler d1 migrations apply mehyar_leads_prod --remote
-- Idempotent: all CREATE TABLE IF NOT EXISTS + idempotent column adds

-- ── opportunity_decisions ─────────────────────────────────────────────────────
-- One row per opportunity (prospect or SAM) capturing the final decision.
-- stage='Won' or stage='Lost' is the signal; this table stores the reason.
CREATE TABLE IF NOT EXISTS opportunity_decisions (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,                -- 'prospect' | 'sam'
  opportunity_id TEXT NOT NULL,                -- prospects.id or gov_opportunities.id
  decision        TEXT NOT NULL,                -- 'won' | 'lost' | 'passed'
  reason_code     TEXT,                         -- 'budget'|'timing'|'no_response'|'competitor'|'fit'|'resubmit'|'other'|null
  reason_body     TEXT,                         -- free-text notes
  decided_by      TEXT NOT NULL DEFAULT 'owner',
  decided_at      TEXT NOT NULL DEFAULT (datetime('now')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(kind, opportunity_id)
);

CREATE INDEX IF NOT EXISTS idx_opp_decisions_kind_oid  ON opportunity_decisions(kind, opportunity_id);
CREATE INDEX IF NOT EXISTS idx_opp_decisions_decision ON opportunity_decisions(decision);

-- Add columns to prospects (idempotent — only runs if column missing)
-- We use a transaction with explicit column checks so SQLite "duplicate column" errors are silenced
ALTER TABLE prospects ADD COLUMN decision TEXT;
ALTER TABLE prospects ADD COLUMN decision_reason_code TEXT;
ALTER TABLE prospects ADD COLUMN decision_reason_body TEXT;
ALTER TABLE prospects ADD COLUMN decided_at TEXT;
ALTER TABLE prospects ADD COLUMN decided_by TEXT;

-- Add columns to gov_opportunities (idempotent)
ALTER TABLE gov_opportunities ADD COLUMN decision TEXT;
ALTER TABLE gov_opportunities ADD COLUMN decision_reason_code TEXT;
ALTER TABLE gov_opportunities ADD COLUMN decision_reason_body TEXT;
ALTER TABLE gov_opportunities ADD COLUMN decided_at TEXT;
ALTER TABLE gov_opportunities ADD COLUMN decided_by TEXT;

-- ── case_studies ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_studies (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  subtitle      TEXT,
  vertical      TEXT,                          -- 'dental' | 'hvac' | 'legal' | 'real_estate' | etc.
  client_name   TEXT,
  clientLogo_url TEXT,
  challenge_short TEXT,                        -- 1-line summary for cards
  challenge_body TEXT,                         -- full HTML/markdown
  solution_short TEXT,
  solution_body  TEXT,
  result_body    TEXT,
  metrics_json   TEXT NOT NULL DEFAULT '[]',   -- [{"label":"...","value":"..."}]
  tags          TEXT NOT NULL DEFAULT '[]',    -- JSON array of strings
  featured      INTEGER NOT NULL DEFAULT 0,    -- 0=normal, 1=featured on homepage
  published     INTEGER NOT NULL DEFAULT 0,    -- 0=draft, 1=published
  published_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_case_studies_slug     ON case_studies(slug);
CREATE INDEX        IF NOT EXISTS idx_case_studies_vertical ON case_studies(vertical);
CREATE INDEX        IF NOT EXISTS idx_case_studies_featured ON case_studies(featured, published);
CREATE INDEX        IF NOT EXISTS idx_case_studies_published ON case_studies(published);

-- ── case_study_pages ──────────────────────────────────────────────────────────
-- Individual pages/sections within a case study (e.g. Part 1, Part 2, etc.)
CREATE TABLE IF NOT EXISTS case_study_pages (
  id              TEXT PRIMARY KEY,
  case_study_id   TEXT NOT NULL,
  page_order      INTEGER NOT NULL DEFAULT 1,
  page_title      TEXT NOT NULL,
  page_slug       TEXT NOT NULL,               -- url-safe within the study
  body_html       TEXT,
  call_to_action  TEXT,
  cta_url         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(case_study_id, page_order),
  UNIQUE(case_study_id, page_slug)
);

CREATE INDEX IF NOT EXISTS idx_cs_pages_csid ON case_study_pages(case_study_id);
