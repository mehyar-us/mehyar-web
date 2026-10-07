ALTER TABLE mayor_telnyx_admissions ADD COLUMN call_session_id TEXT;
ALTER TABLE mayor_telnyx_admissions ADD COLUMN calling_number TEXT;
ALTER TABLE mayor_telnyx_admissions ADD COLUMN called_number TEXT;
-- Historical admissions intentionally have no stream binding and cannot stream.
