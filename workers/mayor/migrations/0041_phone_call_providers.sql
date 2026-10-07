ALTER TABLE mayor_phone_calls ADD COLUMN provider TEXT NOT NULL DEFAULT 'twilio' CHECK(provider IN ('twilio','telnyx'));
ALTER TABLE mayor_phone_verifications ADD COLUMN provider TEXT NOT NULL DEFAULT 'twilio' CHECK(provider IN ('twilio','telnyx'));
CREATE TRIGGER telnyx_end_voice_principal AFTER INSERT ON mayor_telnyx_ended_calls
BEGIN
 UPDATE mayor_phone_calls SET state='ended' WHERE provider='telnyx' AND id IN
 (SELECT id FROM mayor_telnyx_admissions WHERE connection_id=NEW.connection_id AND call_control_id=NEW.call_control_id);
END;
