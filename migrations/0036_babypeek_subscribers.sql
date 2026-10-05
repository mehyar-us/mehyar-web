-- 0036: babypeek_subscribers — per-brand drip/CRM table for BabyPeek paid buyers.
-- Mirrors floodlens_subscribers. Written by webhook BRAND_DRIP_TABLES
-- (functions/api/pay/webhook.js): paid buyers land here with status='purchased'.

CREATE TABLE IF NOT EXISTS babypeek_subscribers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT NOT NULL UNIQUE,
  status         TEXT NOT NULL DEFAULT 'pending',
  brand          TEXT NOT NULL DEFAULT 'babypeek',
  lookup_token   TEXT,
  confirm_token  TEXT,
  confirmed_at   TEXT,
  unsubscribed   INTEGER NOT NULL DEFAULT 0,
  unsubscribed_at TEXT,
  converted      INTEGER NOT NULL DEFAULT 0,
  source         TEXT NOT NULL DEFAULT 'free',
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_babypeek_subscribers_email ON babypeek_subscribers(email);
CREATE INDEX IF NOT EXISTS idx_babypeek_subscribers_confirm ON babypeek_subscribers(confirm_token);
