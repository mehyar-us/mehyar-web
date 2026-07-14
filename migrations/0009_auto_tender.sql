-- 2026-07-14: Auto-tender pipeline — draft generation runs + capability library.
--
-- auto_tender_runs      — one row per scheduled morning pipeline execution
-- capability_statements — reusable approved capability narrative blocks
-- past_performance      — owner-approved past-performance references
--
-- idempotent: all tables use CREATE TABLE IF NOT EXISTS

-- ── auto_tender_runs ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auto_tender_runs (
  id                  TEXT PRIMARY KEY,
  triggered_at        TEXT NOT NULL,                  -- ISO-8601 when the cron fired
  sam_item_id         TEXT,                           -- gov_opportunities.id that was drafted (NULL = pipeline-level run record)
  status              TEXT NOT NULL DEFAULT 'running', -- running | completed | failed | noop
  status_detail       TEXT NOT NULL DEFAULT '',
  draft_id            TEXT,                           -- auto_tender_drafts.id if a draft was generated
  sam_item_title      TEXT,
  sam_item_deadline   TEXT,
  sam_item_stage      TEXT,
  sam_item_fit_score  REAL,
  drafts_count        INTEGER NOT NULL DEFAULT 0,      -- how many drafts generated in this run
  errors_json         TEXT NOT NULL DEFAULT '[]',
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_auto_tender_runs_triggered ON auto_tender_runs(triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_tender_runs_sam_item  ON auto_tender_runs(sam_item_id);

-- ── capability_statements ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS capability_statements (
  id           TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'general',  -- general | technical | management | past_performance
  text         TEXT NOT NULL,
  approved     INTEGER NOT NULL DEFAULT 0,        -- 0=pending review, 1=approved
  source_url   TEXT NOT NULL DEFAULT '',
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_capability_statements_category ON capability_statements(category);
CREATE INDEX IF NOT EXISTS idx_capability_statements_approved  ON capability_statements(approved);

-- Seed a minimal approved capability block so the heuristic fallback always works
INSERT OR IGNORE INTO capability_statements (id, label, category, text, approved, source_url)
VALUES (
  'cs-default-001',
  'Custom Software Development',
  'general',
  'MehyarSoft delivers end-to-end custom software and web application development: requirements gathering, UX design, full-stack implementation, testing, deployment, and documentation. We specialize in cloud-native builds on Cloudflare Workers, Pages, D1, KV, and R2; we also integrate with third-party APIs, CRMs, and SaaS platforms.',
  1,
  'https://mehyar.us/services'
);

INSERT OR IGNORE INTO capability_statements (id, label, category, text, approved, source_url)
VALUES (
  'cs-default-002',
  'Workflow Automation & Integration',
  'general',
  'MehyarSoft automates manual workflows using RPA-style triggers, scheduled jobs, and event-driven architectures. We integrate disparate systems via REST/GraphQL APIs, webhooks, and message queues, reducing operational overhead and eliminating repetitive data-entry tasks.',
  1,
  'https://mehyar.us/services'
);

INSERT OR IGNORE INTO capability_statements (id, label, category, text, approved, source_url)
VALUES (
  'cs-default-003',
  'AI / Machine Learning Integration',
  'general',
  'MehyarSoft incorporates LLM-powered features — AI agents, semantic search, document extraction, and conversational interfaces — into existing workflows and new applications. We use Cloudflare Workers AI, OpenAI, and open-source models depending on data sensitivity and latency requirements.',
  1,
  'https://mehyar.us/services'
);

-- ── past_performance ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS past_performance (
  id                  TEXT PRIMARY KEY,
  project_title       TEXT NOT NULL,
  client_name         TEXT NOT NULL DEFAULT 'Confidential',
  contract_agency     TEXT NOT NULL DEFAULT '',
  contract_award_id  TEXT NOT NULL DEFAULT '',
  period_start        TEXT NOT NULL DEFAULT '',
  period_end          TEXT NOT NULL DEFAULT '',
  description         TEXT NOT NULL,
  relevance_to_gov   TEXT NOT NULL DEFAULT '',
  reference_name      TEXT NOT NULL DEFAULT '',
  reference_title     TEXT NOT NULL DEFAULT '',
  reference_email     TEXT NOT NULL DEFAULT '',
  reference_phone    TEXT NOT NULL DEFAULT '',
  contract_value      REAL,
  labor_categories    TEXT NOT NULL DEFAULT '[]',  -- JSON array of labor categories used
  approved            INTEGER NOT NULL DEFAULT 0,   -- 0=pending, 1=approved
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_past_performance_approved ON past_performance(approved);

-- Seed one placeholder past-performance record
INSERT OR IGNORE INTO past_performance (id, project_title, client_name, description, relevance_to_gov, approved)
VALUES (
  'pp-placeholder-001',
  'Healthcare Misrouted-Call Remediation',
  'Confidential Healthcare Client',
  'Designed and deployed a Twilio + CRM workflow that automatically identified misrouted patient calls and triggered 90-second follow-up sequences, reducing missed appointments by 34%.',
  'Demonstrates healthcare workflow automation, HIPAA-adjacent communication handling, and CRM integration for regulated environments — directly applicable to government case-management and intake-portal engagements.',
  1
);
