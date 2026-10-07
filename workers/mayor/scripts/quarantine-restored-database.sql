-- RECOVERY ONLY. Apply to the verified restored database BEFORE attaching any
-- Worker, cron, queue consumer or provider credentials. Not a live migration.
-- A backup's pending email may already have been sent after the snapshot.
-- Preserve its fingerprint as uncertain, even after the owner opts in again.
UPDATE mayor_email_outbox
SET state='uncertain', failure_code='restored_snapshot', lease_token=NULL,
    lease_until=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE state IN ('pending','sending');

-- Increment revisions to invalidate proposals prepared before the restore.
UPDATE mayor_email_preferences
SET enabled=0, revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE enabled=1;

UPDATE mayor_recurring_checks
SET enabled=0, revision=revision+1, next_run_at=NULL, due_local_date=NULL,
    lease_token=NULL, lease_until=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE enabled=1 OR next_run_at IS NOT NULL OR lease_token IS NOT NULL OR lease_until IS NOT NULL;

-- Restored business schedules are historical choices, not authority to resume.
-- Fence configuration revisions before closing their captured in-flight runs.
UPDATE mayor_business_routines
SET enabled=0, revision=revision+1, next_run_at=NULL, due_local_date=NULL,
    lease_token=NULL, lease_until=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE enabled=1 OR next_run_at IS NOT NULL OR due_local_date IS NOT NULL
   OR lease_token IS NOT NULL OR lease_until IS NOT NULL
   OR EXISTS (SELECT 1 FROM mayor_business_routine_runs r
              WHERE r.tenant_id=mayor_business_routines.tenant_id
                AND r.user_id=mayor_business_routines.user_id AND r.state='processing');

UPDATE mayor_business_routine_runs
SET state='failed', brief_json=NULL, lease_token=NULL, lease_until=NULL,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE state='processing';

UPDATE mayor_harness_configs
SET enabled=0, revision=revision+1, next_run_at=NULL, due_local_date=NULL,
    lease_token=NULL, lease_until=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE enabled=1 OR next_run_at IS NOT NULL OR due_local_date IS NOT NULL
   OR lease_token IS NOT NULL OR lease_until IS NOT NULL
   OR EXISTS (SELECT 1 FROM mayor_harness_runs r
              WHERE r.tenant_id=mayor_harness_configs.tenant_id
                AND r.user_id=mayor_harness_configs.user_id AND r.state='processing');

-- Keep attempt/charge and dedupe evidence; an unknown attempt is not resubmitted.
UPDATE mayor_harness_runs
SET state='failed', report_json=NULL, error_code='restored_snapshot',
    lease_token=NULL, lease_until=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE state='processing';

-- Proposal state has no expired value. Retain its actor/payload and expire it.
-- Confirmed proposals and task acceptances are historical receipts, unchanged.
UPDATE mayor_harness_proposals
SET expires_at='1970-01-01T00:00:00.000Z'
WHERE state='pending' AND expires_at!='1970-01-01T00:00:00.000Z';

-- Restore paid/public audit work to a manual reconciliation hold. Keep exact
-- provider job IDs/references, paid receipts and saved evidence as uncertainty
-- evidence; SQL cannot cancel an already-open hosted payment URL.
-- Keep checkout/fulfillment READY=false until canonical billing is reconciled.
UPDATE mayor_audit_orders
SET fulfillment_status='needs_review', analysis_error_code='restored_database_quarantine',
    analysis_token=NULL, analysis_lease_expires_at=NULL, analysis_next_attempt_at=0,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE fulfillment_status IN ('awaiting_payment','queued','in_review');

UPDATE mayor_audit_orders
SET processing_token=NULL, lease_expires_at=NULL
WHERE processing_token IS NOT NULL OR lease_expires_at IS NOT NULL;

-- A NULL lease on a processing event would strand it. Mark the unknown attempt
-- failed while preserving canonical provider identity and processed receipts.
UPDATE mayor_billing_events
SET status='failed', error_code='restored_snapshot', processing_token=NULL, lease_expires_at=NULL
WHERE status='processing';

-- Restored call authorization is historical, not permission to resume a call.
-- Reconnect provider accounts explicitly after reviewing their live call state.
UPDATE mayor_phone_connections SET status='revoked',revision=revision+1,
 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE status='authorized';
UPDATE mayor_phone_calls SET state='ended' WHERE state!='ended';
UPDATE mayor_phone_verifications SET state='failed',expires_at='1970-01-01T00:00:00.000Z'
 WHERE state IN ('offered','sending','pending','checking','approved');
UPDATE mayor_phone_oauth_states SET expires_at=0 WHERE expires_at!=0;
UPDATE mayor_twilio_connect_attempts SET expires_at=0 WHERE expires_at!=0;
UPDATE mayor_telnyx_stream_grants SET expires_at=0 WHERE expires_at!=0;
-- Keep dispatched commands uncertain; never claim provider-side termination.
UPDATE mayor_telnyx_commands SET state=CASE WHEN state='queued' THEN 'blocked' ELSE 'uncertain' END,
 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE state IN ('queued','dispatching');
UPDATE mayor_telnyx_terminations SET state=CASE WHEN state='queued' THEN 'blocked' ELSE 'uncertain' END,
 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE state IN ('queued','dispatching');
UPDATE mayor_telnyx_recovery SET state='review',lease_until=0,lease_token='',next_attempt_at=0,last_result='restored_snapshot'
 WHERE state='pending';
