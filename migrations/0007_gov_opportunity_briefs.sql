-- MehyarSoft gov opportunity brief table (migration 0007).
-- A brief is a 1-page exec-readiness summary generated per opportunity:
--  - executive_summary: 2-3 sentence what-is-this
--  - why_we_fit / why_we_dont_fit: AI-evaluated bullets
--  - capability_match: { naics: bool, set_aside: bool, capacity: bool, past_performance: bool }
--  - bid_decision: 'go' | 'no-go' | 'watch'
--  - estimated_effort_hours: integer (rough sizing)
--  - missing_artifacts_json: ["CPARS", "Past performance narrative", ...]
--  - risk_flags_json: [..., ...]
--  - next_step: 'request RFI' | 'submit proposal' | 'set reminder' | 'archive'
--  - sources_cited_json: ['https://sam.gov/opp/...', ...]
--  - generated_by: 'gemma-4-26b' | 'template-fallback' | ...
--  - generated_at: timestamp
-- Depends on migration 0004 (gov_opportunities).

CREATE TABLE IF NOT EXISTS gov_opportunity_briefs (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  executive_summary TEXT NOT NULL,
  why_we_fit TEXT NOT NULL DEFAULT '',
  why_we_dont_fit TEXT NOT NULL DEFAULT '',
  capability_match_json TEXT NOT NULL DEFAULT '{}',  -- { naics, set_aside, capacity, past_performance }
  bid_decision TEXT NOT NULL DEFAULT 'watch',         -- 'go' | 'no-go' | 'watch'
  estimated_effort_hours INTEGER,
  estimated_value_usd REAL,
  missing_artifacts_json TEXT NOT NULL DEFAULT '[]',
  risk_flags_json TEXT NOT NULL DEFAULT '[]',
  next_step TEXT NOT NULL DEFAULT 'review',
  sources_cited_json TEXT NOT NULL DEFAULT '[]',
  generated_by TEXT NOT NULL DEFAULT 'template-fallback',
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (opportunity_id) REFERENCES gov_opportunities(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_gov_opportunity_briefs_opp ON gov_opportunity_briefs(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_gov_opportunity_briefs_decision ON gov_opportunity_briefs(bid_decision);