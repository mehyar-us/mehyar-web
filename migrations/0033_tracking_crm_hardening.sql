-- 0033_tracking_crm_hardening.sql (STAGED 2026-10-05 — NOT APPLIED)
--
-- One shared attribution + buyer-CRM hardening for every product on the
-- centralized mehyar-web checkout. Apply BEFORE the code patches
-- (03-checkout.js.patch, 04-webhook.js.patch) reference the new columns.
--
-- How to apply (on Mayor's word):
--   wrangler d1 migrations apply mehyar_leads_prod --remote
-- from ~/workspace/repos/mehyar-web with this file as
-- migrations/0033_tracking_crm_hardening.sql
-- (D1 migrations run additively; every statement is idempotent-safe.)

-- 1. billing_payments: carry attribution + Stripe customer details on every order.
ALTER TABLE billing_payments ADD COLUMN attribution_json TEXT;
ALTER TABLE billing_payments ADD COLUMN customer_name TEXT;
ALTER TABLE billing_payments ADD COLUMN billing_city TEXT;
ALTER TABLE billing_payments ADD COLUMN billing_state TEXT;
ALTER TABLE billing_payments ADD COLUMN billing_country TEXT;
ALTER TABLE billing_payments ADD COLUMN stripe_customer_id TEXT;

-- 2. floodlens_lookups: full entry attribution on the free lookup (the funnel head).
ALTER TABLE floodlens_lookups ADD COLUMN utm_source TEXT;
ALTER TABLE floodlens_lookups ADD COLUMN utm_medium TEXT;
ALTER TABLE floodlens_lookups ADD COLUMN utm_campaign TEXT;
ALTER TABLE floodlens_lookups ADD COLUMN utm_term TEXT;
ALTER TABLE floodlens_lookups ADD COLUMN utm_content TEXT;
ALTER TABLE floodlens_lookups ADD COLUMN referrer TEXT;
ALTER TABLE floodlens_lookups ADD COLUMN landing_page TEXT;
ALTER TABLE floodlens_lookups ADD COLUMN click_ids TEXT;  -- JSON: {gclid,fbclid,msclkid,...}

-- 3. floodlens_orders: keep the lookup's attribution on the order row too.
ALTER TABLE floodlens_orders ADD COLUMN attribution_json TEXT;

-- 4. subscribers_global: the brand CRM list — buyer rollups live here.
ALTER TABLE subscribers_global ADD COLUMN converted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subscribers_global ADD COLUMN first_order_at TEXT;
ALTER TABLE subscribers_global ADD COLUMN last_order_at TEXT;
ALTER TABLE subscribers_global ADD COLUMN total_spent_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subscribers_global ADD COLUMN attribution_json TEXT;

-- 5. buyers_rollup: global buyer view for the sprint dashboard
-- (per email+brand; billing_payments stays the ledger of record).
CREATE TABLE IF NOT EXISTS buyers_rollup (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  brand TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  orders_count INTEGER NOT NULL DEFAULT 1,
  total_cents INTEGER NOT NULL DEFAULT 0,
  first_attribution_json TEXT,
  UNIQUE(email, brand)
);
