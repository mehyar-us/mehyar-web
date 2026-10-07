-- Independent Mayor billing; legacy payment and business-agent tables are untouched.
CREATE TABLE mayor_billing_customers (
 tenant_id TEXT NOT NULL REFERENCES agent_tenants(id), mode TEXT NOT NULL CHECK(mode IN ('test','live')),
 stripe_customer_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,mode)
);
CREATE TABLE mayor_billing_checkouts (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES agent_tenants(id), mode TEXT NOT NULL CHECK(mode IN ('test','live')),
 request_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','open','completed','expired','failed')),
 stripe_session_id TEXT UNIQUE, checkout_url TEXT, expires_at INTEGER, provider_started_at INTEGER,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(tenant_id,mode,request_id)
);
CREATE UNIQUE INDEX mayor_billing_checkout_pending ON mayor_billing_checkouts(tenant_id,mode) WHERE status IN ('pending','open');
CREATE TABLE mayor_billing_subscriptions (
 tenant_id TEXT NOT NULL REFERENCES agent_tenants(id), mode TEXT NOT NULL CHECK(mode IN ('test','live')),
 stripe_subscription_id TEXT NOT NULL UNIQUE, stripe_customer_id TEXT NOT NULL,
 checkout_id TEXT NOT NULL REFERENCES mayor_billing_checkouts(id), status TEXT NOT NULL,
 cancel_at_period_end INTEGER NOT NULL DEFAULT 0, last_event_created INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL, PRIMARY KEY(tenant_id,mode)
);
CREATE TABLE mayor_billing_paid_periods (
 tenant_id TEXT NOT NULL REFERENCES agent_tenants(id), mode TEXT NOT NULL CHECK(mode IN ('test','live')),
 period_key TEXT NOT NULL, stripe_subscription_id TEXT NOT NULL, stripe_invoice_id TEXT NOT NULL UNIQUE, stripe_payment_intent_id TEXT NOT NULL,
 period_start INTEGER NOT NULL, period_end INTEGER NOT NULL, invalidated INTEGER NOT NULL DEFAULT 0,
 verified_at TEXT NOT NULL, CHECK(period_end > period_start), PRIMARY KEY(tenant_id,period_key)
);
CREATE INDEX mayor_billing_active_periods ON mayor_billing_paid_periods(tenant_id,mode,period_end,period_start);
CREATE TABLE mayor_billing_usage_periods (
 tenant_id TEXT NOT NULL REFERENCES agent_tenants(id), period_key TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('turn','minute')), count INTEGER NOT NULL DEFAULT 0 CHECK(count >= 0),
 last_claim_id TEXT, PRIMARY KEY(tenant_id,period_key,kind)
);
CREATE TABLE mayor_billing_events (
 mode TEXT NOT NULL CHECK(mode IN ('test','live')), event_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','processing','processed','failed')), event_type TEXT NOT NULL,
 processing_token TEXT, lease_expires_at INTEGER, error_code TEXT, received_at TEXT NOT NULL,
 PRIMARY KEY(mode,event_id)
);
CREATE TABLE mayor_billing_leases (
 tenant_id TEXT NOT NULL REFERENCES agent_tenants(id), mode TEXT NOT NULL,
 token TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(tenant_id,mode)
);
CREATE TABLE mayor_billing_fences (
 token TEXT PRIMARY KEY, verified_token TEXT NOT NULL
);
CREATE TABLE mayor_audit_orders (
 id TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK(mode IN ('test','live')),
 request_id TEXT NOT NULL, request_hash TEXT NOT NULL, status_token_hash TEXT NOT NULL UNIQUE,
 stripe_session_id TEXT UNIQUE, stripe_payment_intent_id TEXT, stripe_customer_id TEXT, checkout_url TEXT,
 expires_at INTEGER, provider_started_at INTEGER,
 payment_status TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('pending','paid','failed','expired','refunded')),
 fulfillment_status TEXT NOT NULL DEFAULT 'awaiting_payment' CHECK(fulfillment_status IN ('awaiting_payment','queued','in_review','report_ready','needs_review')),
 intake_json TEXT NOT NULL, amount_cents INTEGER NOT NULL DEFAULT 33000 CHECK(amount_cents=33000), currency TEXT NOT NULL DEFAULT 'usd' CHECK(currency='usd'),
 processing_token TEXT, lease_expires_at INTEGER, paid_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 report_json TEXT, review_json TEXT, report_created_at TEXT,
 analysis_token TEXT, analysis_lease_expires_at INTEGER, analysis_attempts INTEGER NOT NULL DEFAULT 0,
 analysis_next_attempt_at INTEGER NOT NULL DEFAULT 0, analysis_error_code TEXT,
 analysis_stage TEXT NOT NULL DEFAULT 'collect' CHECK(analysis_stage IN ('collect','analyze','review','revise')),
 analysis_stage_attempts INTEGER NOT NULL DEFAULT 0, evidence_json TEXT, draft_json TEXT,
 analysis_review_count INTEGER NOT NULL DEFAULT 0,
 UNIQUE(mode,request_id)
);
CREATE INDEX mayor_audit_fulfillment_queue ON mayor_audit_orders(mode,fulfillment_status,created_at);
