-- Apply ONLY to the new AGENT_DB. No legacy schema or Stripe configuration changes.
ALTER TABLE agent_billing_orders ADD COLUMN stage TEXT NOT NULL DEFAULT 'setup' CHECK(stage IN ('setup','activation'));
ALTER TABLE agent_billing_orders ADD COLUMN plan_id TEXT NOT NULL DEFAULT 'business';
ALTER TABLE agent_billing_orders ADD COLUMN billing_interval TEXT NOT NULL DEFAULT 'monthly' CHECK(billing_interval IN ('monthly','annual'));
ALTER TABLE agent_billing_orders ADD COLUMN catalog_version TEXT NOT NULL DEFAULT '2026-09-16.1';
ALTER TABLE agent_billing_orders ADD COLUMN request_key TEXT;
ALTER TABLE agent_billing_orders ADD COLUMN request_hash TEXT;
ALTER TABLE agent_billing_orders ADD COLUMN checkout_url TEXT;
ALTER TABLE agent_billing_orders ADD COLUMN stripe_payment_intent_id TEXT;
ALTER TABLE agent_billing_orders ADD COLUMN provider_request_started_at TEXT;
ALTER TABLE agent_billing_orders ADD COLUMN paid_at TEXT;
ALTER TABLE agent_billing_orders ADD COLUMN refunded_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_billing_orders ADD COLUMN updated_at TEXT;
CREATE UNIQUE INDEX agent_billing_order_request ON agent_billing_orders(tenant_id,request_key);
CREATE UNIQUE INDEX agent_billing_pending_stage ON agent_billing_orders(tenant_id,stage) WHERE status IN ('pending','checkout_created');
CREATE UNIQUE INDEX agent_billing_order_intent ON agent_billing_orders(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

ALTER TABLE agent_billing_subscriptions ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE agent_billing_subscriptions ADD COLUMN price_id TEXT;
ALTER TABLE agent_billing_subscriptions ADD COLUMN billing_interval TEXT NOT NULL DEFAULT 'monthly';
ALTER TABLE agent_billing_subscriptions ADD COLUMN catalog_version TEXT NOT NULL DEFAULT '2026-09-16.1';
ALTER TABLE agent_billing_subscriptions ADD COLUMN activation_order_id TEXT;
ALTER TABLE agent_billing_subscriptions ADD COLUMN last_event_created INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_billing_subscriptions ADD COLUMN last_invoice_id TEXT;
ALTER TABLE agent_billing_subscriptions ADD COLUMN grace_expires_at TEXT;
ALTER TABLE agent_billing_subscriptions ADD COLUMN access_state TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE agent_billing_subscriptions ADD COLUMN pending_plan_id TEXT;
ALTER TABLE agent_billing_subscriptions ADD COLUMN dispute_state TEXT;

ALTER TABLE agent_inbox ADD COLUMN processing_token TEXT;
ALTER TABLE agent_inbox ADD COLUMN lease_expires_at TEXT;
ALTER TABLE agent_inbox ADD COLUMN payload_hash TEXT;
ALTER TABLE agent_inbox ADD COLUMN last_error_code TEXT;
ALTER TABLE agent_inbox ADD COLUMN processed_at TEXT;

CREATE TABLE agent_billing_readiness (
  scope_id TEXT NOT NULL,
  gate TEXT NOT NULL,
  catalog_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','verified','revoked')),
  evidence_ref TEXT NOT NULL,
  verified_by TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  PRIMARY KEY(scope_id,gate,catalog_version)
);
-- Readiness records are operator-owned evidence. No public/customer write endpoint exists.
CREATE TABLE agent_billing_invoices (
  stripe_invoice_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
  stripe_subscription_id TEXT NOT NULL,
  stripe_customer_id TEXT NOT NULL,
  amount_paid_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  period_end TEXT,
  stripe_payment_intent_id TEXT,
  last_event_created INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX agent_billing_invoice_tenant ON agent_billing_invoices(tenant_id,updated_at);
CREATE INDEX agent_billing_invoice_intent ON agent_billing_invoices(stripe_payment_intent_id);
CREATE TABLE agent_billing_notices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
  event_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,event_id,kind)
);
CREATE TABLE agent_billing_adjustments (
  stripe_object_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
  order_id TEXT,
  stripe_invoice_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  event_created INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE agent_billing_event_fences (
  event_id TEXT PRIMARY KEY,
  processing_token TEXT NOT NULL
);
