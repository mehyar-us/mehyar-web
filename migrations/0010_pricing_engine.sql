-- 2026-07-14: Pricing engine — rate cards and pricing models.
--
-- rate_cards   — named labor-rate schedules (one per contract type)
-- pricing_models — generated pricing bundles per opportunity draft
--
-- idempotent: all tables use CREATE TABLE IF NOT EXISTS

-- ── rate_cards ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rate_cards (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,                    -- "GSA STLS 2024", "Commercial T&M", "FFP Baseline"
  schedule_name   TEXT NOT NULL DEFAULT '',          -- e.g. "GSA IT Schedule 47QTCH"
  contract_type   TEXT NOT NULL DEFAULT 'T&M',      -- T&M | FFP | CPFF | Labor-Hour
  min_labor_rate  REAL NOT NULL DEFAULT 0,           -- lowest loaded hourly rate ($/hr)
  max_labor_rate  REAL NOT NULL DEFAULT 500,         -- highest loaded hourly rate ($/hr)
  is_gov_facing   INTEGER NOT NULL DEFAULT 1,        -- 1=can be shown in gov proposals
  year            INTEGER NOT NULL DEFAULT 2024,     -- effective year
  effective_from  TEXT NOT NULL DEFAULT '',           -- ISO date
  effective_to    TEXT NOT NULL DEFAULT '',           -- ISO date or ''
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rate_cards_contract_type ON rate_cards(contract_type);
CREATE INDEX IF NOT EXISTS idx_rate_cards_is_gov_facing  ON rate_cards(is_gov_facing);

-- Seed a default commercial + GSA-like rate card so pricing always has a fallback
INSERT OR IGNORE INTO rate_cards (id, name, contract_type, min_labor_rate, max_labor_rate, is_gov_facing, year, effective_from, notes)
VALUES (
  'rc-default-commercial',
  'Commercial T&M Baseline',
  'T&M',
  75.00,
  225.00,
  1,
  2024,
  '2024-01-01',
  'Default commercial time-and-materials schedule. Loaded rates include all indirect costs and fee. Used as fallback when no opportunity-specific rate card exists.'
);

INSERT OR IGNORE INTO rate_cards (id, name, contract_type, min_labor_rate, max_labor_rate, is_gov_facing, year, effective_from, notes)
VALUES (
  'rc-default-labor-hour',
  'GSA IT Schedule (Labor-Hour Proxy)',
  'Labor-Hour',
  65.00,
  250.00,
  1,
  2024,
  '2024-01-01',
  'Proxy GSA IT Schedule 47QTCH-XX rates. Used as heuristic fallback for opportunities indicating LH or T&M contract type. Replace with actual verified rate card before submission.'
);

-- ── pricing_models ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pricing_models (
  id                  TEXT PRIMARY KEY,
  opportunity_id      TEXT NOT NULL,                  -- gov_opportunities.id
  run_id              TEXT,                           -- auto_tender_runs.id
  draft_id            TEXT,                           -- auto_tender_drafts.id (future)
  rate_card_id        TEXT NOT NULL,
  contract_type       TEXT NOT NULL DEFAULT 'T&M',
  labor_categories    TEXT NOT NULL DEFAULT '[]',   -- JSON array of {category, hours, rate}
  total_estimated_hours REAL NOT NULL DEFAULT 0,
  total_price         REAL NOT NULL DEFAULT 0,
  price_low           REAL NOT NULL DEFAULT 0,       -- range for competitive range
  price_high          REAL NOT NULL DEFAULT 0,
  pricing_notes       TEXT NOT NULL DEFAULT '',
  pricing_validated   INTEGER NOT NULL DEFAULT 0,    -- 1=owner has validated
  pricing_confirmed   INTEGER NOT NULL DEFAULT 0,    -- 1=owner has explicitly confirmed numbers
  section_b_raw       TEXT NOT NULL DEFAULT '',       -- raw generated Section-B table text
  section_b_markdown  TEXT NOT NULL DEFAULT '',
  llm_used            INTEGER NOT NULL DEFAULT 0,    -- 1=LLM was consulted
  llm_model           TEXT NOT NULL DEFAULT '',
  generated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pricing_models_opp     ON pricing_models(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_pricing_models_run     ON pricing_models(run_id);
CREATE INDEX IF NOT EXISTS idx_pricing_models_validated ON pricing_models(pricing_validated);
