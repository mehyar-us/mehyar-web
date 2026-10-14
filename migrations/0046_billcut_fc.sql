-- Billcut v2: Stripe Financial Connections link state (2026-10-14).
-- Stores ONLY the link identifiers + derived coverage info. Raw connected
-- transactions are processed in-request and never stored (same data-
-- minimization rule as uploaded files).
ALTER TABLE billcut_audits ADD COLUMN fc_customer_id TEXT;
ALTER TABLE billcut_audits ADD COLUMN fc_accounts_json TEXT;
ALTER TABLE billcut_audits ADD COLUMN fc_linked_at TEXT;
ALTER TABLE billcut_audits ADD COLUMN fc_last_sync_at TEXT;
ALTER TABLE billcut_audits ADD COLUMN source TEXT DEFAULT 'upload';
ALTER TABLE billcut_audits ADD COLUMN coverage_note TEXT;
