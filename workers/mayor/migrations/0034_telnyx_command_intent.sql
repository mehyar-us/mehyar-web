CREATE TABLE mayor_telnyx_commands (
 id TEXT PRIMARY KEY REFERENCES mayor_telnyx_admissions(id),
 kind TEXT NOT NULL CHECK(kind='answer'),
 state TEXT NOT NULL CHECK(state IN ('queued','dispatching','accepted','uncertain','blocked')),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
-- Existing admissions have no known dispatch outcome. Never turn them into work.
INSERT INTO mayor_telnyx_commands(id,kind,state,created_at,updated_at)
 SELECT id,'answer','blocked',created_at,created_at FROM mayor_telnyx_admissions;
-- Admission and its first command are one SQLite transaction, including on crash.
CREATE TRIGGER mayor_telnyx_admission_command AFTER INSERT ON mayor_telnyx_admissions
BEGIN
 INSERT INTO mayor_telnyx_commands(id,kind,state,created_at,updated_at)
 VALUES(NEW.id,'answer','queued',NEW.created_at,NEW.created_at);
END;
CREATE INDEX mayor_telnyx_commands_pending ON mayor_telnyx_commands(state,created_at);
