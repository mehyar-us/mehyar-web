-- Additive delivery claim ledger. No customer data or bearer tokens stored.
-- An unknown/claimed row must be reconciled with the provider before retry.
CREATE TABLE IF NOT EXISTS promptpack_email_delivery (
  order_id INTEGER PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('claimed', 'sent', 'unknown')),
  claimed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
