ALTER TABLE mayor_appointment_jobs ADD COLUMN reservation_active INTEGER NOT NULL DEFAULT 1;
CREATE TABLE mayor_appointment_changes (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 appointment_id TEXT NOT NULL REFERENCES mayor_appointments(id),
 kind TEXT NOT NULL CHECK(kind IN ('reschedule','cancel')),
 state TEXT NOT NULL CHECK(state IN ('proposed','running','applied','rejected','uncertain')),
 expected_etag TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,
 policy_revision INTEGER NOT NULL,authorization_stamp TEXT NOT NULL,
 old_start TEXT NOT NULL,old_end TEXT NOT NULL,new_start TEXT NOT NULL,new_end TEXT NOT NULL,
 expires_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX mayor_one_active_change ON mayor_appointment_changes(appointment_id)
 WHERE state IN ('running','uncertain');
