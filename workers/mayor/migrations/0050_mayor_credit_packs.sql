-- One-time, period-bound packs. Purchases do not alter consumed usage or the subscription.
CREATE TABLE mayor_billing_credit_checkouts (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
 mode TEXT NOT NULL CHECK(mode IN ('test','live')),
 request_id TEXT NOT NULL,
 pack_id TEXT NOT NULL CHECK(pack_id IN ('small','medium','large')),
 catalog_version TEXT NOT NULL,
 price_id TEXT NOT NULL,
 period_key TEXT NOT NULL,
 period_start INTEGER NOT NULL,
 period_end INTEGER NOT NULL CHECK(period_end>period_start),
 status TEXT NOT NULL CHECK(status IN ('pending','open','paid','expired','refunded','disputed','paid_expired')),
 stripe_session_id TEXT UNIQUE,
 stripe_payment_intent_id TEXT UNIQUE,
 checkout_url TEXT,
 expires_at INTEGER,
 provider_started_at INTEGER,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(tenant_id,mode,request_id)
);
CREATE UNIQUE INDEX mayor_credit_open_business ON mayor_billing_credit_checkouts(tenant_id,mode) WHERE status IN ('pending','open');
CREATE INDEX mayor_credit_intent ON mayor_billing_credit_checkouts(mode,stripe_payment_intent_id);
CREATE TABLE mayor_billing_credit_grants (
 checkout_id TEXT PRIMARY KEY REFERENCES mayor_billing_credit_checkouts(id),
 tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
 mode TEXT NOT NULL CHECK(mode IN ('test','live')),
 period_key TEXT NOT NULL,
 period_start INTEGER NOT NULL,
 period_end INTEGER NOT NULL,
 reply_attempts INTEGER NOT NULL CHECK(reply_attempts>0),
 voice_minutes INTEGER NOT NULL CHECK(voice_minutes>0),
 invalidated INTEGER NOT NULL DEFAULT 0 CHECK(invalidated IN (0,1)),
 paid_at TEXT NOT NULL
);
CREATE INDEX mayor_credit_period ON mayor_billing_credit_grants(tenant_id,mode,period_key,invalidated);
