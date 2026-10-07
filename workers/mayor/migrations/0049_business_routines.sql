-- Operator-specific, read-only business briefs; no external automation authority.
CREATE TABLE mayor_business_routines (
 tenant_id TEXT NOT NULL, user_id TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 template_ids_json TEXT NOT NULL, schedule_json TEXT,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 next_run_at TEXT, due_local_date TEXT,
 lease_token TEXT, lease_until TEXT, attempts INTEGER NOT NULL DEFAULT 0,
 last_run_at TEXT, last_status TEXT CHECK(last_status IN ('ready','failed')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,user_id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES agent_memberships(tenant_id,user_id),
 CHECK(enabled=0 OR (schedule_json IS NOT NULL AND next_run_at IS NOT NULL AND due_local_date IS NOT NULL))
);
CREATE INDEX mayor_business_routines_due ON mayor_business_routines(enabled,next_run_at,lease_until);
CREATE TABLE mayor_business_routine_runs (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL,
 config_revision INTEGER NOT NULL, dedupe_key TEXT NOT NULL,
 trigger_kind TEXT NOT NULL CHECK(trigger_kind IN ('manual','scheduled')),
 due_local_date TEXT,
 state TEXT NOT NULL CHECK(state IN ('processing','ready','failed','discarded')),
 lease_token TEXT, lease_until TEXT,
 brief_json TEXT, read_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(tenant_id,user_id,dedupe_key),
 FOREIGN KEY(tenant_id,user_id) REFERENCES mayor_business_routines(tenant_id,user_id),
 CHECK(state!='ready' OR brief_json IS NOT NULL)
);
CREATE INDEX mayor_business_routine_history ON mayor_business_routine_runs(tenant_id,user_id,state,created_at,id);
