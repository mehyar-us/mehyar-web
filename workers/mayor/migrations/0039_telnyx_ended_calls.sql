CREATE TABLE mayor_telnyx_ended_calls (
 connection_id TEXT NOT NULL REFERENCES mayor_phone_connections(id),
 call_control_id TEXT NOT NULL,
 event_id TEXT NOT NULL,
 ended_at TEXT NOT NULL,
 PRIMARY KEY(connection_id,call_control_id)
);
-- Keep terminal receipts across reconnects and out-of-order deliveries.
CREATE TRIGGER telnyx_reject_ended_admission BEFORE INSERT ON mayor_telnyx_admissions
WHEN EXISTS(SELECT 1 FROM mayor_telnyx_ended_calls WHERE connection_id=NEW.connection_id AND call_control_id=NEW.call_control_id)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER telnyx_end_pending_work AFTER INSERT ON mayor_telnyx_ended_calls
BEGIN
 UPDATE mayor_telnyx_commands SET state='blocked',updated_at=NEW.ended_at
 WHERE state='queued' AND id IN (SELECT id FROM mayor_telnyx_admissions WHERE connection_id=NEW.connection_id AND call_control_id=NEW.call_control_id);
 UPDATE mayor_telnyx_stream_grants SET expires_at=0
 WHERE admission_id IN (SELECT id FROM mayor_telnyx_admissions WHERE connection_id=NEW.connection_id AND call_control_id=NEW.call_control_id);
END;
CREATE TRIGGER telnyx_reject_ended_grant BEFORE INSERT ON mayor_telnyx_stream_grants
WHEN EXISTS(SELECT 1 FROM mayor_telnyx_admissions a JOIN mayor_telnyx_ended_calls e ON e.connection_id=a.connection_id AND e.call_control_id=a.call_control_id WHERE a.id=NEW.admission_id)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER telnyx_reject_ended_dispatch BEFORE UPDATE OF state ON mayor_telnyx_commands
WHEN NEW.state='dispatching' AND EXISTS(SELECT 1 FROM mayor_telnyx_admissions a JOIN mayor_telnyx_ended_calls e ON e.connection_id=a.connection_id AND e.call_control_id=a.call_control_id WHERE a.id=NEW.id)
BEGIN SELECT RAISE(IGNORE); END;
