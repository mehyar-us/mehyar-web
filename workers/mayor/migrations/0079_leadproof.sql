-- LeadProof module (integration spec §4.2): evidence-backed business lead
-- packs — export only; this module has no send verb anywhere. Checkouts
-- mirror mayor_billing_credit_checkouts (the period_* fields are the only
-- omission: a pack is not period-bound). A pack credit is granted exactly
-- once per checkout (mayor_leadproof_pack_credits.checkout_id UNIQUE), so a
-- replayed webhook can never grant twice. Leads carry their evidence by
-- schema: source_url, why_now and evidence_json are NOT NULL — a lead
-- without evidence cannot exist in this table (spec §8 R2).
CREATE TABLE mayor_leadproof_checkouts (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
 mode TEXT NOT NULL CHECK(mode IN ('test','live')),
 request_id TEXT NOT NULL,
 catalog_version TEXT NOT NULL,
 price_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','open','paid','expired','refunded','disputed')),
 stripe_session_id TEXT UNIQUE,
 stripe_payment_intent_id TEXT UNIQUE,
 checkout_url TEXT,
 expires_at INTEGER,
 provider_started_at INTEGER,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(tenant_id,mode,request_id)
);
CREATE UNIQUE INDEX mayor_leadproof_open_business ON mayor_leadproof_checkouts(tenant_id,mode) WHERE status IN ('pending','open');
CREATE INDEX mayor_leadproof_intent ON mayor_leadproof_checkouts(mode,stripe_payment_intent_id);
CREATE TABLE mayor_leadproof_pack_credits (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
 checkout_id TEXT NOT NULL UNIQUE REFERENCES mayor_leadproof_checkouts(id),
 consumed_by_pack_id TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
-- Pack lifecycle (spec §4.3): requested -> paid -> queued -> discovering ->
-- profiling -> drafting -> ready -> exported; failed from any working
-- state (the credit restores). icp_text is the owner's own words, immutable.
CREATE TABLE mayor_leadproof_packs (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
 credit_id TEXT NOT NULL REFERENCES mayor_leadproof_pack_credits(id),
 icp_text TEXT NOT NULL,
 icp_params_json TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('requested','paid','queued','discovering','profiling','drafting','ready','exported','failed')),
 harvey_job_ref TEXT,
 lead_count INTEGER,
 shortfall_reason TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 ready_at TEXT, exported_at TEXT
);
CREATE TABLE mayor_leadproof_leads (
 id TEXT PRIMARY KEY,
 pack_id TEXT NOT NULL REFERENCES mayor_leadproof_packs(id),
 tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
 company_name TEXT NOT NULL,
 contact_name TEXT,
 website TEXT, phone TEXT,
 source_url TEXT NOT NULL,
 why_now TEXT NOT NULL,
 evidence_json TEXT NOT NULL,
 first_line TEXT,
 score REAL,
 created_at TEXT NOT NULL,
 UNIQUE(pack_id,source_url)
);
CREATE INDEX mayor_leadproof_leads_pack ON mayor_leadproof_leads(pack_id);
-- The kill-criteria ledger (spec §10): every lead in the first five packs
-- gets a QA verdict here; the same tripwire samples packs after that.
CREATE TABLE mayor_leadproof_qa (
 id TEXT PRIMARY KEY,
 pack_id TEXT NOT NULL REFERENCES mayor_leadproof_packs(id),
 lead_id TEXT NOT NULL REFERENCES mayor_leadproof_leads(id),
 verdict TEXT NOT NULL CHECK(verdict IN ('fit','wrong_fit','fabricated')),
 reviewer TEXT NOT NULL,
 created_at TEXT NOT NULL
);
