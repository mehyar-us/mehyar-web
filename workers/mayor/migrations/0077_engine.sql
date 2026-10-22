-- Reinvention Slice 2 (blueprint §1.1/§1.3/§1.4/§1.8): the new engine's
-- state. Every table is tenant-scoped; every store query binds tenant_id
-- (isolation is enforced by the store's shape + the cross-tenant bleed
-- test — physical per-tenant D1 provisioning is the Slice 3 bridge,
-- §1.9). The Grant Book starts EMPTY for every tenant (§4.8e: no
-- standing-authority state exists to migrate; every grant row here is a
-- provably new row created by the probed lifecycle).

-- Stage 1 envelopes: one row per admitted stimulus; the unique
-- (tenant, idempotency_key) index makes replays no-ops, and result_json
-- lets a replay return the original surface instead of re-running.
CREATE TABLE IF NOT EXISTS mayor_engine_envelopes(
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 channel TEXT NOT NULL,
 actor_kind TEXT NOT NULL,
 created_at TEXT NOT NULL,
 result_json TEXT,
 UNIQUE(tenant_id,idempotency_key)
);

-- The Grant Book (§1.3.1). A grant is a typed object, never a re-read
-- sentence: source_utterance is the owner's exact words (immutable per
-- version); conditions/never_lines are compiled, machine-checked data.
CREATE TABLE IF NOT EXISTS mayor_grants(
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL, -- proposed | probed | shadow | live | narrowed | revoked | expired
 action_class TEXT NOT NULL,
 scope_json TEXT NOT NULL,
 conditions_json TEXT NOT NULL DEFAULT '[]',
 never_lines_json TEXT NOT NULL DEFAULT '[]',
 source_utterance TEXT NOT NULL,
 plain_summary TEXT NOT NULL,
 origin TEXT NOT NULL DEFAULT 'owner_stated', -- owner_stated | assistant_proposed
 capability_state TEXT NOT NULL DEFAULT 'present', -- present | pending | revoked | stale_probe
 probe_set_id TEXT,
 session_scope TEXT NOT NULL DEFAULT 'standard', -- owner_test (session one) | standard
 asks_json TEXT NOT NULL DEFAULT '[]',
 created_at TEXT NOT NULL,
 confirmed_at TEXT,
 expires_at TEXT,
 supersedes_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_mayor_grants_tenant_status ON mayor_grants(tenant_id,status,action_class);

-- Probe sets + boundary scenarios (§1.3.2 step 3). A scenario the owner
-- flips re-compiles the rule; the ruling is recorded, never overwritten.
CREATE TABLE IF NOT EXISTS mayor_probe_sets(
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 grant_id TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mayor_probe_scenarios(
 id TEXT PRIMARY KEY,
 probe_set_id TEXT NOT NULL,
 tenant_id TEXT NOT NULL,
 ordinal INTEGER NOT NULL,
 description TEXT NOT NULL,
 detail_json TEXT NOT NULL DEFAULT '{}',
 expected_outcome TEXT NOT NULL, -- allowed | blocked
 owner_ruling TEXT, -- allowed | blocked (NULL until ruled)
 flipped INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mayor_probe_scenarios_set ON mayor_probe_scenarios(probe_set_id,ordinal);

-- Stage 6 PreparedActions. In Slice 2 nothing here ever executes
-- externally: kind 'ask' = prepare-and-ask; kind 'shadow' = a covered
-- act rendered as "Would have sent" under a shadow grant.
CREATE TABLE IF NOT EXISTS mayor_prepared_actions(
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 kind TEXT NOT NULL, -- ask | shadow
 action_class TEXT NOT NULL,
 target_person TEXT,
 channel TEXT NOT NULL,
 payload_json TEXT NOT NULL DEFAULT '{}',
 payload_summary TEXT NOT NULL,
 grant_id TEXT,
 grant_version INTEGER,
 predicate_fired TEXT,
 decision_id TEXT,
 near_boundary INTEGER NOT NULL DEFAULT 0,
 reversibility_json TEXT,
 expires_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'prepared', -- prepared | approved | dismissed | expired | cancelled
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mayor_prepared_tenant_status ON mayor_prepared_actions(tenant_id,status,created_at DESC);

-- The audit trail (§1.3.4). No act exists without a log row. kind:
-- 'shadow' (would-have-sent under a grant), 'prepared' (prepare-and-ask
-- surfaced), 'note' (engine bookkeeping: revocations, conflicts,
-- security drops). action_key is deterministic per act (§1.1 Stage 8).
CREATE TABLE IF NOT EXISTS mayor_action_log(
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 action_key TEXT NOT NULL,
 at TEXT NOT NULL,
 kind TEXT NOT NULL,
 action_class TEXT,
 target_person TEXT,
 channel TEXT,
 payload_summary TEXT NOT NULL,
 grant_id TEXT,
 grant_version INTEGER,
 source_utterance TEXT,
 decision_id TEXT,
 verification_result TEXT,
 undo_available_until TEXT,
 prepared_action_id TEXT,
 UNIQUE(tenant_id,action_key)
);
CREATE INDEX IF NOT EXISTS idx_mayor_action_log_tenant_at ON mayor_action_log(tenant_id,at DESC);

-- Stage 5 DecisionLog (§1.2): question ids, answers, confidences, the
-- band outcome, the named threshold profile — and the state HASH,
-- never state text (no customer content is duplicated into this log).
CREATE TABLE IF NOT EXISTS mayor_decision_log(
 decision_id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 run_id TEXT NOT NULL,
 question_ids_json TEXT NOT NULL,
 answers_json TEXT NOT NULL,
 confidences_json TEXT NOT NULL,
 band_outcome TEXT NOT NULL, -- auto | review | hold | unavailable
 threshold_profile TEXT NOT NULL,
 model TEXT,
 latency_ms INTEGER,
 cost_microcents INTEGER,
 state_hash TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mayor_decision_log_tenant ON mayor_decision_log(tenant_id,created_at DESC);

-- Memory Objects (§1.4): typed, versioned, provenanced. A correction
-- supersedes (the old row stays, status='superseded'); forgetting
-- tombstones (status='forgotten', payload purged).
CREATE TABLE IF NOT EXISTS mayor_memory_objects(
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 type TEXT NOT NULL, -- BusinessFact | Person | Commitment | Preference | Rule | Episode | VoiceTrait
 version INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'active', -- active | superseded | disputed | forgotten
 payload_json TEXT NOT NULL,
 confidence_tier TEXT NOT NULL, -- owner_confirmed | observed_strong | observed_weak
 provenance_json TEXT NOT NULL,
 created_at TEXT NOT NULL,
 last_confirmed_at TEXT,
 last_used_at TEXT,
 decay_class TEXT NOT NULL DEFAULT 'permanent',
 supersedes_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_mayor_memory_tenant_type ON mayor_memory_objects(tenant_id,type,status);

CREATE TABLE IF NOT EXISTS mayor_memory_edges(
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 from_id TEXT NOT NULL,
 edge_type TEXT NOT NULL,
 to_id TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mayor_memory_edges_from ON mayor_memory_edges(tenant_id,from_id);

-- Engine state per tenant: the run mode (onboarding stage lives in
-- onboarding_json), the §8.6 cost meter (monthly microcents + fence),
-- and the anonymous/claimed flags the 30-day reaper reads.
CREATE TABLE IF NOT EXISTS mayor_engine_state(
 tenant_id TEXT PRIMARY KEY,
 mode TEXT NOT NULL DEFAULT 'onboarding', -- onboarding | supervised | talk
 onboarding_json TEXT NOT NULL DEFAULT '{}',
 cost_period TEXT NOT NULL,
 cost_microcents INTEGER NOT NULL DEFAULT 0,
 cost_ceiling_microcents INTEGER NOT NULL,
 anonymous INTEGER NOT NULL DEFAULT 0,
 claimed_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);

-- Assistant-proposed grants (§1.3.2 step 1): a class may be proposed
-- only after >=3 manual approvals of that class, at most once, and a
-- "no" suppresses the class for 30 days. This table is the memory of
-- that discipline; it can never widen authority by itself.
CREATE TABLE IF NOT EXISTS mayor_grant_suggestions(
 tenant_id TEXT NOT NULL,
 action_class TEXT NOT NULL,
 approvals INTEGER NOT NULL DEFAULT 0,
 proposed_count INTEGER NOT NULL DEFAULT 0,
 suppressed_until TEXT,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,action_class)
);
