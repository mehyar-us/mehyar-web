-- Durable provider reservations prevent re-submitting an uncertain expensive request.
ALTER TABLE mayor_audit_orders ADD COLUMN analysis_job_id TEXT;
ALTER TABLE mayor_audit_orders ADD COLUMN analysis_job_model TEXT;
ALTER TABLE mayor_audit_orders ADD COLUMN analysis_job_reference TEXT;
ALTER TABLE mayor_audit_orders ADD COLUMN analysis_job_started_at INTEGER;
ALTER TABLE mayor_audit_orders ADD COLUMN analysis_job_poll_failures INTEGER NOT NULL DEFAULT 0;
