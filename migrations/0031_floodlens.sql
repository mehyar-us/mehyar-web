-- 0031: FloodLens (fema-based flood zone lookup + $19/$39 PDF reports).
--
-- floodlens_lookups   — one row per free lookup; the lookup TOKEN is what the
--   frontend passes to /api/pay/checkout, so checkout → webhook → PDF all
--   read from the same row and a zone is never invented.
-- floodlens_subscribers — free-tier email capture (double opt-in) +
--   purchase rows; converted=1 stops the staged drip (drip-campaign.md).
--   Mirrored into subscribers_global with brand='floodlens'.
-- floodlens_orders    — one row per paid checkout (UNIQUE payment_id →
--   webhook replays are no-ops); token unifies billing_payments.access_token
--   so one token gates status polling + download + success page.

CREATE TABLE IF NOT EXISTS floodlens_lookups (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  token        TEXT NOT NULL UNIQUE,
  address      TEXT NOT NULL,
  normalized   TEXT,
  lat          REAL NOT NULL,
  lon          REAL NOT NULL,
  geohash      TEXT,
  zone         TEXT,
  zone_subtype TEXT,
  sfha         INTEGER NOT NULL DEFAULT 0,
  risk         TEXT,
  risk_plain   TEXT,
  band         TEXT,
  bfe          REAL,
  dfirm_id     TEXT,
  firm_pan     TEXT,
  data_as_of   TEXT,
  queried_at   TEXT,
  degraded     INTEGER NOT NULL DEFAULT 0,
  ip           TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_floodlens_lookups_geohash ON floodlens_lookups(geohash, created_at);
CREATE INDEX IF NOT EXISTS idx_floodlens_lookups_ip ON floodlens_lookups(ip, created_at);
CREATE INDEX IF NOT EXISTS idx_floodlens_lookups_token ON floodlens_lookups(token);

CREATE TABLE IF NOT EXISTS floodlens_subscribers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT NOT NULL UNIQUE,
  status         TEXT NOT NULL DEFAULT 'pending',
  brand          TEXT NOT NULL DEFAULT 'floodlens',
  lookup_token   TEXT,
  confirm_token  TEXT,
  confirmed_at   TEXT,
  unsubscribed   INTEGER NOT NULL DEFAULT 0,
  unsubscribed_at TEXT,
  converted      INTEGER NOT NULL DEFAULT 0,
  source         TEXT NOT NULL DEFAULT 'free-lookup',
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_floodlens_subscribers_email ON floodlens_subscribers(email);
CREATE INDEX IF NOT EXISTS idx_floodlens_subscribers_confirm ON floodlens_subscribers(confirm_token);

CREATE TABLE IF NOT EXISTS floodlens_orders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id   TEXT NOT NULL UNIQUE,
  token        TEXT NOT NULL UNIQUE,
  product_id   TEXT NOT NULL,
  email        TEXT NOT NULL,
  lookup_token TEXT,
  address      TEXT,
  zone         TEXT,
  status       TEXT NOT NULL DEFAULT 'paid',
  r2_key       TEXT,
  inputs_json  TEXT,
  ready_at     TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_floodlens_orders_token ON floodlens_orders(token);
CREATE INDEX IF NOT EXISTS idx_floodlens_orders_email ON floodlens_orders(email, created_at);
