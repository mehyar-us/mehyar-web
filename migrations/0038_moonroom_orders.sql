-- 0038_moonroom_orders.sql
-- Moonroom AI photo studio order ledger (fulfillment='moonroom').
-- One row per billing_payments.id; the UNIQUE index on payment_id is what
-- the shared webhook's ORDER_HOOKS idempotency relies on (duplicate Stripe
-- deliveries for the same session re-run the hook but hit the existing row).
-- Additive only; no changes to existing tables.

CREATE TABLE IF NOT EXISTS moonroom_orders (
  id INTEGER PRIMARY KEY,
  payment_id INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  email TEXT NOT NULL,
  inputs_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'paid',
  output_json TEXT,
  access_token TEXT NOT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ready_at TEXT,
  email_sent_at TEXT,
  failure_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_moonroom_orders_payment ON moonroom_orders(payment_id);
CREATE INDEX IF NOT EXISTS idx_moonroom_orders_token ON moonroom_orders(access_token);
