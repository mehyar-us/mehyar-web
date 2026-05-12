-- AI-assisted offer fulfillment state for owner-reviewed micro-offer engine.
-- Apply remotely:
--   npx wrangler d1 migrations apply mehyar_leads_prod --remote

CREATE TABLE IF NOT EXISTS lead_offer_evaluations (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  lead_classification TEXT NOT NULL,
  service_fit_score INTEGER NOT NULL DEFAULT 0,
  offer_id TEXT NOT NULL,
  offer_title TEXT NOT NULL,
  draft_subject TEXT,
  draft_body TEXT,
  owner_review_status TEXT NOT NULL DEFAULT 'pending_review',
  fulfillment_status TEXT NOT NULL DEFAULT 'drafted_for_review',
  send_allowed INTEGER NOT NULL DEFAULT 0,
  audit_summary_json TEXT,
  zoho_hooks_json TEXT,
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE INDEX IF NOT EXISTS idx_lead_offer_evaluations_updated_at ON lead_offer_evaluations(updated_at);
CREATE INDEX IF NOT EXISTS idx_lead_offer_evaluations_review_status ON lead_offer_evaluations(owner_review_status);
CREATE INDEX IF NOT EXISTS idx_lead_offer_evaluations_offer_id ON lead_offer_evaluations(offer_id);
