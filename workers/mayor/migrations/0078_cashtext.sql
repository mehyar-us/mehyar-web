-- CashText module (integration spec §3.2): the tenant invoices their own
-- customers by conversation. Every table is tenant-scoped and the module's
-- billing rows are domain-separated from the Pro subscription:
-- mayor_cashtext_checkouts / mayor_cashtext_subscriptions mirror
-- mayor_billing_checkouts / mayor_billing_subscriptions field-for-field so
-- subscriptionEffects (whose contract hard-rejects any subscription it did
-- not mint) never sees a module row. Module money (the tenant paying
-- MehyarSoft) and merchant money (the tenant's customers paying the tenant
-- through Stripe Connect) never share an object or a table.
CREATE TABLE mayor_cashtext_settings (
 tenant_id TEXT PRIMARY KEY REFERENCES agent_tenants(id),
 stripe_account_id TEXT UNIQUE,
 account_status TEXT NOT NULL DEFAULT 'not_connected' CHECK(account_status IN ('not_connected','pending','active','restricted')),
 charges_enabled INTEGER NOT NULL DEFAULT 0 CHECK(charges_enabled IN (0,1)),
 payouts_enabled INTEGER NOT NULL DEFAULT 0 CHECK(payouts_enabled IN (0,1)),
 summary_enabled INTEGER NOT NULL DEFAULT 1 CHECK(summary_enabled IN (0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE mayor_cashtext_checkouts (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES agent_tenants(id), mode TEXT NOT NULL CHECK(mode IN ('test','live')),
 request_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','open','completed','expired','failed')),
 stripe_session_id TEXT UNIQUE, checkout_url TEXT, expires_at INTEGER, provider_started_at INTEGER,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(tenant_id,mode,request_id)
);
CREATE UNIQUE INDEX mayor_cashtext_checkout_pending ON mayor_cashtext_checkouts(tenant_id,mode) WHERE status IN ('pending','open');
CREATE TABLE mayor_cashtext_subscriptions (
 tenant_id TEXT NOT NULL REFERENCES agent_tenants(id), mode TEXT NOT NULL CHECK(mode IN ('test','live')),
 stripe_subscription_id TEXT NOT NULL UNIQUE, stripe_customer_id TEXT NOT NULL,
 checkout_id TEXT NOT NULL REFERENCES mayor_cashtext_checkouts(id), status TEXT NOT NULL,
 cancel_at_period_end INTEGER NOT NULL DEFAULT 0, last_event_created INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL, PRIMARY KEY(tenant_id,mode)
);
-- Invoice lifecycle (spec §3.3): draft -> approved -> sent -> paid, with
-- overdue derived from sent past due_date, and void/failed as terminal
-- side-exits. No Stripe object is touched while a row is a draft.
-- draft_error is the kill-criteria instrument (spec §10).
CREATE TABLE mayor_cashtext_invoices (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
 customer_id TEXT NOT NULL REFERENCES mayor_customers(id),
 stripe_customer_id TEXT, stripe_invoice_id TEXT,
 description TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 currency TEXT NOT NULL DEFAULT 'usd' CHECK(currency='usd'),
 status TEXT NOT NULL CHECK(status IN ('draft','approved','sent','paid','overdue','void','failed')),
 due_date TEXT, prepared_action_id TEXT,
 idempotency_key TEXT NOT NULL,
 hosted_invoice_url TEXT, sent_at TEXT, paid_at TEXT,
 chase_count INTEGER NOT NULL DEFAULT 0, last_chase_at TEXT,
 draft_error INTEGER NOT NULL DEFAULT 0 CHECK(draft_error IN (0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(tenant_id,idempotency_key)
);
CREATE INDEX mayor_cashtext_invoice_status ON mayor_cashtext_invoices(tenant_id,status);
-- A customer's chase opt-out (or the owner's per-customer call) ends chases
-- for that customer permanently (spec §3.4 / §8 R3).
CREATE TABLE mayor_cashtext_contacts (
 tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
 customer_id TEXT NOT NULL REFERENCES mayor_customers(id),
 chase_opt_out INTEGER NOT NULL DEFAULT 0 CHECK(chase_opt_out IN (0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,customer_id)
);
