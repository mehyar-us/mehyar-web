ALTER TABLE mayor_telnyx_ended_calls ADD COLUMN provider_confirmed INTEGER NOT NULL DEFAULT 1 CHECK(provider_confirmed IN (0,1));
CREATE TABLE mayor_telnyx_terminations (
 admission_id TEXT PRIMARY KEY REFERENCES mayor_telnyx_admissions(id),
 command_id TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL CHECK(state IN ('queued','dispatching','accepted','uncertain','blocked','ended')),
 updated_at TEXT NOT NULL
);
CREATE TRIGGER telnyx_confirm_termination_insert AFTER INSERT ON mayor_telnyx_ended_calls
WHEN NEW.provider_confirmed=1 BEGIN
 UPDATE mayor_telnyx_terminations SET state='ended',updated_at=NEW.ended_at WHERE admission_id IN
 (SELECT id FROM mayor_telnyx_admissions WHERE connection_id=NEW.connection_id AND call_control_id=NEW.call_control_id);
END;
CREATE TRIGGER telnyx_confirm_termination_update AFTER UPDATE OF provider_confirmed ON mayor_telnyx_ended_calls
WHEN NEW.provider_confirmed=1 BEGIN
 UPDATE mayor_telnyx_terminations SET state='ended',updated_at=NEW.ended_at WHERE admission_id IN
 (SELECT id FROM mayor_telnyx_admissions WHERE connection_id=NEW.connection_id AND call_control_id=NEW.call_control_id);
END;
