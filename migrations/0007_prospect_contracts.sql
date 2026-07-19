-- MehyarSoft prospect contract pipeline.
-- Tracks the contract lifecycle from "interested reply" through
-- "paid in full". One row per engagement. Linked to prospect_id
-- so the Pipeline tab can show revenue per prospect + total ARR.
--
-- status:
--   proposed     — MehyarSoft sent a quote/contract for review
--   sent         — proposal delivered to prospect (open + read receipt optional)
--   viewed        — prospect opened the hosted quote page (QuoteView logs this)
--   negotiating   — back-and-forth on scope/price
--   accepted      — prospect signed the hosted quote
--   contracted    — both sides signed (becomes binding engagement)
--   invoiced      — invoice issued
--   paid_partial  — partial payment received
--   paid_full     — paid in full
--   delivered     — work delivered, engagement closed
--   renewed       — extended for another period
--   cancelled     — prospect or MehyarSoft cancelled
--   lost          — went cold, no engagement

CREATE TABLE IF NOT EXISTS prospect_contracts (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL,

  -- Engagement shape
  service_id TEXT,                            -- matches SERVICE_CATALOG.id (e.g. 'missed-call-followup')
  service_title TEXT NOT NULL,                -- denormalized for UI; human-readable label
  scope_text TEXT,                            -- short description of what's in scope

  -- Pricing
  price_model TEXT NOT NULL DEFAULT 'one_time',-- 'one_time' | 'monthly' | 'hourly' | 'project'
  price_low INTEGER,                          -- in USD cents (50000 = $500)
  price_high INTEGER,                         -- range midpoint
  price_committed INTEGER,                    -- once accepted, locked-in amount
  currency TEXT NOT NULL DEFAULT 'USD',

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'proposed',
  proposed_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  viewed_at TEXT,
  accepted_at TEXT,
  contracted_at TEXT,
  invoiced_at TEXT,
  paid_at TEXT,
  delivered_at TEXT,
  cancelled_at TEXT,

  -- Linked artifacts
  quote_slug TEXT,                            -- matches /q/<slug> route
  invoice_slug TEXT,
  contract_pdf_url TEXT,

  -- Audit
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (prospect_id) REFERENCES prospects(id)
);

CREATE INDEX IF NOT EXISTS idx_contracts_prospect       ON prospect_contracts(prospect_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status         ON prospect_contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_paid           ON prospect_contracts(paid_at) WHERE paid_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_service        ON prospect_contracts(service_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status_paid    ON prospect_contracts(status, paid_at);

-- Hooked from QuoteView when a prospect opens the hosted quote page.
-- Track "viewed" so the Pipeline tab can show proposal→view→accepted funnel.
CREATE TABLE IF NOT EXISTS prospect_contract_events (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL,
  prospect_id TEXT NOT NULL,
  event TEXT NOT NULL,                         -- 'viewed' | 'accepted' | 'signed' | 'invoice_viewed' | 'invoice_paid' | 'note'
  payload_json TEXT NOT NULL DEFAULT '{}',     -- arbitrary metadata
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (contract_id) REFERENCES prospect_contracts(id)
);

CREATE INDEX IF NOT EXISTS idx_contract_events_cid  ON prospect_contract_events(contract_id, created_at);
CREATE INDEX IF NOT EXISTS idx_contract_events_pid  ON prospect_contract_events(prospect_id, created_at);