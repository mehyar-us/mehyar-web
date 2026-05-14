-- Private government opportunity drafting-assist workflow.
-- Owner-review drafts only: no autonomous submission, no invented claims.
-- Depends on 0004_gov_opportunities.sql.
-- Apply remotely:
--   npx wrangler d1 migrations apply mehyar_leads_prod --remote

ALTER TABLE gov_opportunity_events ADD COLUMN draft_id TEXT;

CREATE TABLE IF NOT EXISTS gov_application_drafts (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'owner_review_required',
  owner_review_only INTEGER NOT NULL DEFAULT 1,
  auto_submit_allowed INTEGER NOT NULL DEFAULT 0,
  generated_by TEXT NOT NULL DEFAULT 'system',
  requirements_checklist_json TEXT NOT NULL,
  compliance_matrix_json TEXT NOT NULL,
  contracting_officer_questions_json TEXT NOT NULL,
  response_outline_json TEXT NOT NULL,
  capability_blocks_json TEXT NOT NULL,
  owner_confirmation_items_json TEXT NOT NULL,
  risk_flags_json TEXT NOT NULL,
  source_citations_json TEXT NOT NULL,
  audit_metadata_json TEXT NOT NULL,
  owner_notes TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  FOREIGN KEY (opportunity_id) REFERENCES gov_opportunities(id),
  CHECK (owner_review_only = 1),
  CHECK (auto_submit_allowed = 0)
);

CREATE INDEX IF NOT EXISTS idx_gov_drafts_opportunity ON gov_application_drafts(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_gov_drafts_status ON gov_application_drafts(status);
CREATE INDEX IF NOT EXISTS idx_gov_events_draft ON gov_opportunity_events(draft_id);
