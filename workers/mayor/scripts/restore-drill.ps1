param([string]$BackupRoot=(Join-Path $env:LOCALAPPDATA 'TheMayor/recovery'),[string]$SourceExport,[switch]$VerifyQuarantine)
$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..')).TrimEnd('\','/')
$backupBase=[IO.Path]::GetFullPath($BackupRoot).TrimEnd('\','/')
if($backupBase.Equals($repoRoot,[StringComparison]::OrdinalIgnoreCase) -or $backupBase.StartsWith($repoRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Backups must be outside the repository.'}
$runFolder=Join-Path $backupBase ((Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $runFolder -Force | Out-Null
# Restrict plaintext exports/logs to the current Windows identity before writing.
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
$rule=New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $runFolder -AclObject $acl
$env:CLOUDFLARE_EMAIL=$env:CF_API_EMAIL
$env:CLOUDFLARE_API_KEY=$env:CF_API_KEY
$env:CLOUDFLARE_ACCOUNT_ID=$env:CF_ACCOUNT_ID
if(-not $env:CF_ACCOUNT_ID -or -not $env:CF_API_EMAIL -or -not $env:CF_API_KEY){throw 'Cloudflare account credentials are required.'}
$config=Get-Content -LiteralPath 'wrangler.production.jsonc' -Raw | ConvertFrom-Json
$productionId=$config.d1_databases[0].database_id
if($config.d1_databases[0].database_name -ne 'mehyar-mayor'){throw 'Unexpected production database configuration.'}
$headers=@{'X-Auth-Email'=$env:CF_API_EMAIL;'X-Auth-Key'=$env:CF_API_KEY}
$endpoint="https://api.cloudflare.com/client/v4/accounts/$env:CF_ACCOUNT_ID/d1/database"
$drillName='mayor-restore-'+[Guid]::NewGuid().ToString('N').Substring(0,16)
$createdId=$null
$source=Join-Path $runFolder 'production.sql'
$roundTrip=Join-Path $runFolder 'restored.sql'
$log=Join-Path $runFolder 'drill.log'
function Invoke-Private([string]$Executable,[string[]]$Arguments){
 & $Executable @Arguments >> $log 2>&1
 if($LASTEXITCODE -ne 0){throw 'Recovery command failed. Inspect the private drill log.'}
}
try{
 if($SourceExport){
  Copy-Item -LiteralPath ([IO.Path]::GetFullPath($SourceExport)) -Destination $source
  Write-Output 'Using the supplied SQL snapshot in private storage; production will not be read or restored.'
 }else{
  Write-Output 'Exporting the production snapshot to private storage.'
  Invoke-Private npx @('wrangler','d1','export','AGENT_DB','--remote','--config','wrangler.production.jsonc','--output',$source)
 }
 $created=Invoke-RestMethod -Method Post -Uri $endpoint -Headers $headers -ContentType 'application/json' -Body (@{name=$drillName}|ConvertTo-Json)
 if(-not $created.success -or -not $created.result.uuid){throw 'Temporary recovery database creation failed.'}
 $createdId=[string]$created.result.uuid
 if($createdId -eq $productionId -or $created.result.name -ne $drillName){throw 'Temporary database identity validation failed.'}
 @{name=$drillName;id=$createdId;productionId=$productionId;createdAt=(Get-Date).ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content (Join-Path $runFolder 'temporary-resource.json')
 # Only retry read-only readiness: newly provisioned D1 access can propagate
 # after creation. Never retry an uncertain SQL import automatically.
 for($readyAttempt=0;$readyAttempt -lt 10;$readyAttempt++){
  $ready=Invoke-WebRequest -Method Post -Uri "$endpoint/$createdId/query" -Headers $headers -ContentType 'application/json' -Body '{"sql":"SELECT 1 AS ready"}' -SkipHttpErrorCheck
  if($ready.StatusCode -eq 200 -and ($ready.Content|ConvertFrom-Json).success){break}
  if($ready.StatusCode -notin 401,403,404,503){throw "Unexpected recovery database readiness status: $($ready.StatusCode)"}
  Start-Sleep -Seconds 2
 }
 if($ready.StatusCode -ne 200 -or -not ($ready.Content|ConvertFrom-Json).success){throw 'Recovery database query readiness failed.'}
 $drillConfig=Join-Path $runFolder 'drill.json'
 @{name='mayor-restore-drill';compatibility_date='2026-09-22';d1_databases=@(@{binding='RESTORE_DB';database_name=$drillName;database_id=$createdId})} | ConvertTo-Json -Depth 4 | Set-Content $drillConfig
 Write-Output 'Restoring into the isolated temporary database.'
 Invoke-Private npx @('wrangler','d1','execute','RESTORE_DB','--remote','--config',$drillConfig,'--file',$source,'--yes')
 Invoke-Private npx @('wrangler','d1','export','RESTORE_DB','--remote','--config',$drillConfig,'--output',$roundTrip)
 $report=Join-Path $runFolder 'verification.json'
 Invoke-Private node @('scripts/compare-backups.mjs',$source,$roundTrip,$report)
 $verified=Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
 Write-Output "Verified restored schema and row contents: $($verified.tableCount) tables, $($verified.rowCount) rows."
 if($VerifyQuarantine){
  # This database has no Worker binding or provider credentials. Never attach a
  # recovered snapshot before disabling its potentially replayable work.
  $summarySql=@'
SELECT
 (SELECT count(*) FROM mayor_email_outbox) AS mail_rows,
 (SELECT count(*) FROM mayor_email_outbox WHERE state IN ('pending','sending')) AS sendable,
 (SELECT count(*) FROM mayor_email_outbox WHERE state='uncertain') AS uncertain,
 (SELECT count(*) FROM mayor_email_outbox WHERE lease_token IS NOT NULL OR lease_until IS NOT NULL) AS mail_leases,
 (SELECT count(*) FROM mayor_email_preferences WHERE enabled=1) AS enabled_mail,
 (SELECT coalesce(sum(revision),0) FROM mayor_email_preferences) AS mail_revisions,
 (SELECT count(*) FROM mayor_recurring_checks WHERE enabled=1 OR next_run_at IS NOT NULL OR lease_token IS NOT NULL OR lease_until IS NOT NULL) AS active_checks,
 (SELECT coalesce(sum(revision),0) FROM mayor_recurring_checks) AS check_revisions,
 (SELECT count(*) FROM mayor_notifications) AS notices,
 (SELECT count(*) FROM mayor_check_runs) AS check_runs,
 (SELECT count(*) FROM mayor_business_routines) AS routine_configs,
 (SELECT count(*) FROM mayor_business_routines c WHERE enabled=1 OR next_run_at IS NOT NULL OR due_local_date IS NOT NULL OR lease_token IS NOT NULL OR lease_until IS NOT NULL OR EXISTS(SELECT 1 FROM mayor_business_routine_runs r WHERE r.tenant_id=c.tenant_id AND r.user_id=c.user_id AND r.state='processing')) AS active_routine_configs,
 (SELECT coalesce(sum(revision),0) FROM mayor_business_routines) AS routine_revisions,
 (SELECT count(*) FROM mayor_business_routine_runs) AS routine_runs,
 (SELECT count(*) FROM mayor_business_routine_runs WHERE state='processing') AS processing_routine_runs,
 (SELECT count(*) FROM mayor_business_routine_runs WHERE state='failed') AS failed_routine_runs,
 (SELECT count(*) FROM mayor_business_routine_runs WHERE state='ready') AS ready_routine_runs,
 (SELECT coalesce(sum(length(brief_json)),0) FROM mayor_business_routine_runs WHERE state='ready') AS ready_routine_bytes,
 (SELECT count(*) FROM mayor_harness_configs) AS harness_configs,
 (SELECT count(*) FROM mayor_harness_configs c WHERE enabled=1 OR next_run_at IS NOT NULL OR due_local_date IS NOT NULL OR lease_token IS NOT NULL OR lease_until IS NOT NULL OR EXISTS(SELECT 1 FROM mayor_harness_runs r WHERE r.tenant_id=c.tenant_id AND r.user_id=c.user_id AND r.state='processing')) AS active_harness_configs,
 (SELECT coalesce(sum(revision),0) FROM mayor_harness_configs) AS harness_revisions,
 (SELECT count(*) FROM mayor_harness_runs) AS harness_runs,
 (SELECT count(*) FROM mayor_harness_runs WHERE state='processing') AS processing_harness_runs,
 (SELECT count(*) FROM mayor_harness_runs WHERE state='failed' AND error_code='restored_snapshot') AS restored_harness_runs,
 (SELECT count(*) FROM mayor_harness_runs WHERE state='ready') AS ready_harness_runs,
 (SELECT coalesce(sum(length(report_json)),0) FROM mayor_harness_runs WHERE state='ready') AS ready_harness_bytes,
 (SELECT count(*) FROM mayor_harness_proposals) AS harness_proposals,
 (SELECT count(*) FROM mayor_harness_proposals WHERE state='pending' AND expires_at!='1970-01-01T00:00:00.000Z') AS pending_harness_proposals,
 (SELECT count(*) FROM mayor_harness_proposals WHERE state='confirmed') AS confirmed_harness_proposals,
 (SELECT count(*) FROM mayor_harness_task_acceptances) AS harness_task_acceptances,
 (SELECT count(*) FROM mayor_harness_goals) AS harness_goals,
 (SELECT coalesce(sum(revision),0) FROM mayor_harness_goals) AS harness_goal_revisions,
 (SELECT count(*) FROM mayor_harness_skills) AS harness_skills,
 (SELECT coalesce(sum(revision),0) FROM mayor_harness_skills) AS harness_skill_revisions,
 (SELECT count(*) FROM mayor_harness_identity) AS harness_identities,
 (SELECT coalesce(sum(revision),0) FROM mayor_harness_identity) AS harness_identity_revisions,
 (SELECT coalesce(sum(revision),0) FROM mayor_harness_state) AS harness_data_revisions,
 (SELECT count(*) FROM mayor_tasks) AS saved_tasks,
 (SELECT count(*) FROM mayor_audit_orders) AS audit_orders,
 (SELECT count(*) FROM mayor_audit_orders WHERE fulfillment_status IN ('awaiting_payment','queued','in_review')) AS active_audit_orders,
 (SELECT count(*) FROM mayor_audit_orders WHERE fulfillment_status='needs_review') AS held_audit_orders,
 (SELECT count(*) FROM mayor_audit_orders WHERE processing_token IS NOT NULL OR lease_expires_at IS NOT NULL) AS audit_checkout_leases,
 (SELECT count(*) FROM mayor_audit_orders WHERE fulfillment_status='report_ready') AS ready_audit_reports,
 (SELECT coalesce(sum(length(report_json)),0) FROM mayor_audit_orders WHERE fulfillment_status='report_ready') AS ready_audit_report_bytes,
 (SELECT coalesce(sum(length(review_json)),0) FROM mayor_audit_orders WHERE fulfillment_status='report_ready') AS ready_audit_review_bytes,
 (SELECT count(*) FROM mayor_audit_orders WHERE payment_status='pending') AS audit_payment_pending,
 (SELECT count(*) FROM mayor_audit_orders WHERE payment_status='paid') AS audit_payment_paid,
 (SELECT count(*) FROM mayor_audit_orders WHERE payment_status='failed') AS audit_payment_failed,
 (SELECT count(*) FROM mayor_audit_orders WHERE payment_status='expired') AS audit_payment_expired,
 (SELECT count(*) FROM mayor_audit_orders WHERE payment_status='refunded') AS audit_payment_refunded,
 (SELECT coalesce(sum(analysis_attempts),0) FROM mayor_audit_orders) AS audit_analysis_attempts,
 (SELECT coalesce(sum(analysis_stage_attempts),0) FROM mayor_audit_orders) AS audit_stage_attempts,
 (SELECT coalesce(sum(analysis_job_poll_failures),0) FROM mayor_audit_orders) AS audit_poll_failures,
 (SELECT count(*) FROM mayor_billing_events) AS billing_events,
 (SELECT count(*) FROM mayor_billing_events WHERE status='processing') AS processing_billing_events,
 (SELECT count(*) FROM mayor_billing_events WHERE status='failed' AND error_code='restored_snapshot') AS restored_billing_events,
 (SELECT count(*) FROM mayor_billing_events WHERE status='processed') AS processed_billing_events,
 (SELECT count(*) FROM mayor_phone_connections WHERE status='authorized') AS phone_authorized,
 (SELECT coalesce(sum(revision),0) FROM mayor_phone_connections) AS phone_revisions,
 (SELECT count(*) FROM mayor_phone_calls WHERE state!='ended') AS active_calls,
 (SELECT count(*) FROM mayor_phone_verifications WHERE state IN ('offered','sending','pending','checking','approved')) AS live_verifications,
 (SELECT count(*) FROM mayor_telnyx_stream_grants WHERE expires_at!=0) AS stream_grants,
 (SELECT count(*) FROM mayor_phone_oauth_states WHERE expires_at!=0) AS phone_oauth_states,
 (SELECT count(*) FROM mayor_twilio_connect_attempts WHERE expires_at!=0) AS twilio_attempts,
 (SELECT count(*) FROM mayor_telnyx_commands WHERE state IN ('queued','dispatching')) AS active_answers,
 (SELECT count(*) FROM mayor_telnyx_terminations WHERE state IN ('queued','dispatching')) AS active_terminations,
 (SELECT count(*) FROM mayor_telnyx_recovery WHERE state='pending') AS pending_phone_recovery,
 (SELECT count(*) FROM mayor_telnyx_ended_calls WHERE provider_confirmed=1) AS confirmed_hangups
'@
  function Read-QuarantineSummary {
   $response=Invoke-RestMethod -Method Post -Uri "$endpoint/$createdId/query" -Headers $headers -ContentType 'application/json' -Body (@{sql=$summarySql}|ConvertTo-Json)
   if(-not $response.success){throw 'Quarantine verification query failed.'}
   return $response.result[0].results[0]
  }
  $before=Read-QuarantineSummary
  Invoke-Private npx @('wrangler','d1','execute','RESTORE_DB','--remote','--config',$drillConfig,'--file',(Join-Path $PSScriptRoot 'quarantine-restored-database.sql'),'--yes')
  $after=Read-QuarantineSummary
  if($after.sendable -ne 0 -or $after.enabled_mail -ne 0 -or $after.active_checks -ne 0 -or
     $after.uncertain -ne ($before.uncertain+$before.sendable) -or
     $after.mail_revisions -ne ($before.mail_revisions+$before.enabled_mail) -or
     $after.check_revisions -ne ($before.check_revisions+$before.active_checks) -or
     $after.mail_rows -ne $before.mail_rows -or $after.notices -ne $before.notices -or $after.check_runs -ne $before.check_runs){throw 'Restored notification quarantine verification failed.'}
  if($after.active_routine_configs -ne 0 -or $after.processing_routine_runs -ne 0 -or
     $after.routine_revisions -ne ($before.routine_revisions+$before.active_routine_configs) -or
     $after.failed_routine_runs -ne ($before.failed_routine_runs+$before.processing_routine_runs)) {throw 'Restored business routine quarantine verification failed.'}
  if($after.active_harness_configs -ne 0 -or $after.processing_harness_runs -ne 0 -or $after.pending_harness_proposals -ne 0 -or
     $after.harness_revisions -ne ($before.harness_revisions+$before.active_harness_configs) -or
     $after.restored_harness_runs -ne ($before.restored_harness_runs+$before.processing_harness_runs)) {throw 'Restored business agent quarantine verification failed.'}
  foreach($field in @('routine_configs','routine_runs','ready_routine_runs','ready_routine_bytes','harness_configs','harness_runs','ready_harness_runs','ready_harness_bytes','harness_proposals','confirmed_harness_proposals','harness_task_acceptances','harness_goals','harness_goal_revisions','harness_skills','harness_skill_revisions','harness_identities','harness_identity_revisions','harness_data_revisions','saved_tasks')){
   if($after.$field -ne $before.$field){throw "Restored business history changed during quarantine: $field"}
  }
  if($after.active_audit_orders -ne 0 -or $after.audit_checkout_leases -ne 0 -or $after.processing_billing_events -ne 0 -or
     $after.held_audit_orders -ne ($before.held_audit_orders+$before.active_audit_orders) -or
     $after.restored_billing_events -ne ($before.restored_billing_events+$before.processing_billing_events)) {throw 'Restored public audit/billing work quarantine verification failed.'}
  foreach($field in @('audit_orders','ready_audit_reports','ready_audit_report_bytes','ready_audit_review_bytes','audit_payment_pending','audit_payment_paid','audit_payment_failed','audit_payment_expired','audit_payment_refunded','audit_analysis_attempts','audit_stage_attempts','audit_poll_failures','billing_events','processed_billing_events')){
   if($after.$field -ne $before.$field){throw "Restored audit/provider evidence changed during quarantine: $field"}
  }
  if($after.phone_revisions -ne ($before.phone_revisions+$before.phone_authorized) -or $after.confirmed_hangups -ne $before.confirmed_hangups){throw 'Phone quarantine altered authorization revisions or provider receipts incorrectly.'}
  foreach($field in @('phone_authorized','active_calls','live_verifications','stream_grants','phone_oauth_states','twilio_attempts','active_answers','active_terminations','pending_phone_recovery')){
   if($after.$field -ne 0){throw "Restored phone quarantine failed: $field"}
  }
  Invoke-Private npx @('wrangler','d1','execute','RESTORE_DB','--remote','--config',$drillConfig,'--file',(Join-Path $PSScriptRoot 'quarantine-restored-database.sql'),'--yes')
  $again=Read-QuarantineSummary
  if(($again|ConvertTo-Json -Compress) -ne ($after|ConvertTo-Json -Compress)){throw 'Quarantine was not idempotent.'}
  @{verifiedAt=(Get-Date).ToUniversalTime().ToString('o');before=$before;after=$after;idempotent=$true} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $runFolder 'quarantine-verification.json')
  Write-Output 'Remote notification, business agent/routine, public audit/billing and phone quarantine verified; second application unchanged.'
 }
 Write-Output "Private recovery artifacts: $runFolder"
}finally{
 if($createdId -and $createdId -ne $productionId){
  # Re-read identity before deleting only the database created by this invocation.
  $check=Invoke-RestMethod -Method Get -Uri "$endpoint/$createdId" -Headers $headers
  if(-not $check.success -or $check.result.name -ne $drillName){throw 'Cleanup identity mismatch; temporary database was retained for manual review.'}
  $deleted=Invoke-RestMethod -Method Delete -Uri "$endpoint/$createdId" -Headers $headers
  if(-not $deleted.success){throw 'Temporary database cleanup failed.'}
  $missing=Invoke-WebRequest -Method Get -Uri "$endpoint/$createdId" -Headers $headers -SkipHttpErrorCheck
  if($missing.StatusCode -ne 404){throw 'Temporary database deletion could not be verified.'}
  Set-Content -LiteralPath (Join-Path $runFolder 'cleanup.txt') -Value 'Temporary remote database deleted; production was not restored or modified.'
  Write-Output 'Temporary remote database deletion verified (404).'
 }
}
