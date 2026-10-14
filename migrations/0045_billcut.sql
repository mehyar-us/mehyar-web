-- Billcut (billcut.mehyar.us) — statement audit product.
-- Data minimization: NO raw files, NO raw transactions, NO account
-- numbers are ever stored. Only the derived audit summary lives here.
CREATE TABLE IF NOT EXISTS billcut_audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'teaser',  -- teaser | paid | monitor
  source TEXT,
  charges_json TEXT NOT NULL DEFAULT '[]',
  summary_json TEXT NOT NULL DEFAULT '{}',
  payment_id INTEGER,
  monitor_payment_id INTEGER,
  parent_token TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  paid_at TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_billcut_audits_payment ON billcut_audits(payment_id);

CREATE TABLE IF NOT EXISTS billcut_teaser_ips (
  ip_hash TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, day)
);

CREATE TABLE IF NOT EXISTS billcut_subscribers (
  email TEXT PRIMARY KEY,
  source TEXT,
  unsubscribed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS billcut_unsub_tokens (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL
);

INSERT INTO billing_products
  (id, name, brand, price_cents, currency, fulfillment, description,
   success_url_template, cancel_url, allowed_return_hosts, active, digital_file,
   billing_mode, billing_interval)
VALUES
  ('billcut-audit', 'Billcut Full Audit', 'billcut', 900, 'usd', 'billcut',
   'Full statement audit: every recurring charge ranked by annual cost, with cancel steps and negotiation scripts.',
   'https://billcut.mehyar.us/?token={access_token}&paid=1',
   'https://billcut.mehyar.us/', 'billcut.mehyar.us', 1, NULL, 'one_time', 'month'),
  ('billcut-monitoring', 'Billcut Monitoring', 'billcut', 700, 'usd', 'billcut',
   'Monthly monitoring: full audit included, plus a fresh diff of new, changed, and removed recurring charges on each monthly re-upload.',
   'https://billcut.mehyar.us/?token={access_token}&paid=1',
   'https://billcut.mehyar.us/', 'billcut.mehyar.us', 1, NULL, 'subscription', 'month')
ON CONFLICT(id) DO UPDATE SET name=excluded.name, price_cents=excluded.price_cents,
  fulfillment=excluded.fulfillment, description=excluded.description,
  success_url_template=excluded.success_url_template, cancel_url=excluded.cancel_url,
  allowed_return_hosts=excluded.allowed_return_hosts, active=excluded.active,
  billing_mode=excluded.billing_mode, billing_interval=excluded.billing_interval;
