-- 2026-07-14: Unified Opportunity Pipeline.
-- Used by /admin/opportunities and /admin/opportunities/[id].
-- Adds: stage + last_touched_at to both prospects and gov_opportunities,
-- and a single opportunity_events table for audit trail across both kinds.

-- ── Stages (single source of truth) ───────────────────────────────────────────
-- Discovery    — listed, not yet evaluated
-- Evaluating   — owner looking at the fit, debating
-- Drafting     — reply/email drafted, not approved
-- ReadyToSend  — draft approved, queued
-- Sent         — has been sent
-- Replied      — got a reply
-- Won          — won / hired
-- Lost         — declined / closed
-- Archived     — owner moved it aside

-- ── prospects: add stage + last_touched_at (idempotent) ────────────────────────
-- SQLite ALTER TABLE only accepts constant defaults — backfilled below.
ALTER TABLE prospects ADD COLUMN stage TEXT NOT NULL DEFAULT 'Discovery';
ALTER TABLE prospects ADD COLUMN last_touched_at TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_prospects_stage       ON prospects(stage);
CREATE INDEX IF NOT EXISTS idx_prospects_last_touch  ON prospects(last_touched_at);

-- ── gov_opportunities: add stage + last_touched_at (idempotent) ────────────────
ALTER TABLE gov_opportunities ADD COLUMN stage TEXT NOT NULL DEFAULT 'Discovery';
ALTER TABLE gov_opportunities ADD COLUMN last_touched_at TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_gov_opportunities_stage      ON gov_opportunities(stage);
CREATE INDEX IF NOT EXISTS idx_gov_opportunities_last_touch ON gov_opportunities(last_touched_at);

-- ── opportunity_events (shared audit trail for both kinds) ────────────────────
CREATE TABLE IF NOT EXISTS opportunity_events (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,                -- 'prospect' | 'sam'
  prospect_id   TEXT,
  sam_id        TEXT,
  event_type    TEXT NOT NULL,                -- 'stage_change' | 'note' | 'draft' | 'sent' | 'application' | 'view'
  from_stage    TEXT,
  to_stage      TEXT,
  actor         TEXT NOT NULL DEFAULT 'owner',
  payload_json  TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_opp_events_prospect ON opportunity_events(prospect_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opp_events_sam      ON opportunity_events(sam_id,      created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opp_events_type     ON opportunity_events(event_type);

-- ── opportunity_notes (separate from events so they can be edited) ────────────
CREATE TABLE IF NOT EXISTS opportunity_notes (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  prospect_id  TEXT,
  sam_id       TEXT,
  body         TEXT NOT NULL,
  author       TEXT NOT NULL DEFAULT 'owner',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_opp_notes_prospect ON opportunity_notes(prospect_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opp_notes_sam      ON opportunity_notes(sam_id,      created_at DESC);
