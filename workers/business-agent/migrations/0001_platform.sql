-- Dedicated AGENT_DB only. Never apply to LEADS_DB or existing product databases.
PRAGMA foreign_keys = ON;

CREATE TABLE agent_tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  website TEXT NOT NULL DEFAULT '',
  goal TEXT NOT NULL DEFAULT '',
  agent_name TEXT NOT NULL DEFAULT 'Mayor',
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','researching','awaiting-owner-confirmation','awaiting-connections','trial','ready-for-activation','active','degraded','paused','past-due','offboarding','deleted')),
  plan_id TEXT NOT NULL DEFAULT 'trial' CHECK(plan_id IN ('trial','business','growth','operations')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  trial_expires_at TEXT NOT NULL,
  UNIQUE(id, owner_id)
);
CREATE TABLE agent_memberships (
  tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','manager','staff','billing','viewer','support')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  created_at TEXT NOT NULL,
  expires_at TEXT,
  support_reason TEXT,
  PRIMARY KEY(tenant_id, user_id),
  CHECK(role != 'support' OR (expires_at IS NOT NULL AND support_reason IS NOT NULL))
);
CREATE INDEX agent_memberships_user ON agent_memberships(user_id,status);
CREATE TABLE agent_provisioning (
  user_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id,request_key)
);
CREATE TABLE agent_memory (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'owner',
  source_url TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,id)
);
CREATE INDEX agent_memory_tenant ON agent_memory(tenant_id,updated_at);
CREATE TABLE agent_activity (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,id)
);
CREATE INDEX agent_activity_tenant ON agent_activity(tenant_id,created_at);
CREATE TABLE agent_connections (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
  provider TEXT NOT NULL,
  account_label TEXT NOT NULL,
  credential_ref TEXT NOT NULL,
  granted_scopes TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'partially-connected',
  last_sync_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,id)
);
CREATE TABLE agent_workflow_configs (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
  template_id TEXT NOT NULL,
  version TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'preview' CHECK(mode IN ('preview','approve','automatic')),
  enabled INTEGER NOT NULL DEFAULT 0,
  policy_json TEXT NOT NULL,
  authorized_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,id)
);
CREATE TABLE agent_inbox (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  tenant_id TEXT REFERENCES agent_tenants(id),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL,
  PRIMARY KEY(provider,event_id)
);
CREATE TABLE agent_outbox (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','running','uncertain','succeeded','failed','cancelled')),
  payload_json TEXT NOT NULL,
  provider_receipt TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,idempotency_key)
);
CREATE TABLE agent_billing_customers (
  tenant_id TEXT PRIMARY KEY REFERENCES agent_tenants(id),
  stripe_customer_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE agent_billing_orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
  sku TEXT NOT NULL,
  price_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  stripe_session_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,id)
);
CREATE TABLE agent_billing_subscriptions (
  tenant_id TEXT PRIMARY KEY REFERENCES agent_tenants(id),
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL,
  paid_through TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
