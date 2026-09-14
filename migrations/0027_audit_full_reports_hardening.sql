-- 0027_audit_full_reports_hardening.sql — paid-report money-path hardening.
-- ALTER TABLE ADD COLUMN only (D1 enforces foreign keys; never DROP+RENAME).
-- New columns: status_changed_at (stuck-report recovery), failure_reason,
-- email_sent / emailed_at (delivery logging). New status value 'paid'
-- distinguishes "paid, not yet generated" from "never paid".

ALTER TABLE audit_full_reports ADD COLUMN status_changed_at TEXT;
ALTER TABLE audit_full_reports ADD COLUMN failure_reason TEXT;
ALTER TABLE audit_full_reports ADD COLUMN email_sent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audit_full_reports ADD COLUMN emailed_at TEXT;

-- Backfill: rows that have a paid_at but were left 'pending' by the old
-- webhook are genuinely paid.
UPDATE audit_full_reports
SET status_changed_at = COALESCE(paid_at, delivered_at, created_at)
WHERE status_changed_at IS NULL;

UPDATE audit_full_reports
SET status = 'paid'
WHERE status = 'pending' AND paid_at IS NOT NULL;
