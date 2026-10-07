param([Parameter(Mandatory)][string]$SnapshotPath,[ValidatePattern('^[a-z0-9-]+$')][string]$EvidenceName='2026-10-03-business-audit-continuation',[ValidateRange(1,180)][int]$MaxPhases=120)
$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$auditResume=Get-Content -Raw -LiteralPath $SnapshotPath|ConvertFrom-Json
$auditResumeOrder=$auditResume.order
if($auditResume.continuationEligible -eq $false){throw 'This historical job settled and is not eligible for continuation.'}
if(-not $auditResume.synthetic -or $auditResumeOrder.mode -ne 'test' -or $auditResumeOrder.payment_status -ne 'paid' -or $auditResumeOrder.fulfillment_status -ne 'in_review' -or $auditResumeOrder.id -notmatch '^[a-f0-9-]{36}$' -or $auditResumeOrder.analysis_stage -notin 'analyze','review','revise' -or $auditResumeOrder.analysis_attempts -gt 12 -or $auditResumeOrder.analysis_stage_attempts -gt 3){throw 'Only a bounded synthetic in-review order is eligible.'}
$auditResumePending=$auditResumeOrder.analysis_job_id -match '^[a-f0-9-]{36}$' -and $auditResumeOrder.analysis_job_model -eq '@cf/moonshotai/kimi-k2.6' -and $auditResumeOrder.analysis_job_reference -eq "mayor-audit:$($auditResumeOrder.id):$($auditResumeOrder.analysis_stage):$($auditResumeOrder.analysis_stage_attempts)"
$auditResumeAdvanced=$auditResumeOrder.analysis_stage -in 'review','revise' -and $auditResumeOrder.draft_json -and -not $auditResumeOrder.analysis_job_id -and -not $auditResumeOrder.analysis_job_reference -and -not $auditResumeOrder.analysis_job_model -and -not $auditResumeOrder.analysis_job_started_at -and -not $auditResumeOrder.analysis_error_code -and $auditResumeOrder.analysis_stage_attempts -eq 0
if(-not $auditResumePending -and -not $auditResumeAdvanced){throw 'Continuation requires an exact acknowledged job or a validated next stage; uncertain reservations cannot resume.'}
$auditResumeIntake=$auditResumeOrder.intake_json|ConvertFrom-Json
if($auditResumeIntake.businessName -notmatch '\(synthetic test\)' -or $auditResumeIntake.email -ne 'synthetic-audit@example.com' -or $auditResumeIntake.website -notmatch '^https://mayor-audit-site-[a-f0-9]+\.[a-z0-9-]+\.workers\.dev/$'){throw 'Synthetic intake provenance did not match.'}
foreach($required in 'CF_ACCOUNT_ID','CF_API_EMAIL','CF_API_KEY'){if(-not [Environment]::GetEnvironmentVariable($required)){throw "Missing configured credential: $required"}}
$env:CLOUDFLARE_EMAIL=$env:CF_API_EMAIL;$env:CLOUDFLARE_API_KEY=$env:CF_API_KEY;$env:CLOUDFLARE_ACCOUNT_ID=$env:CF_ACCOUNT_ID
$auditResumeHeaders=@{'X-Auth-Email'=$env:CF_API_EMAIL;'X-Auth-Key'=$env:CF_API_KEY}
$auditResumeApi="https://api.cloudflare.com/client/v4/accounts/$($env:CF_ACCOUNT_ID)"
if($auditResume.sourceDatabaseId -notmatch '^[a-f0-9-]{36}$' -or (Get-Content -Raw -LiteralPath 'wrangler.jsonc').Contains($auditResume.sourceDatabaseId)){throw 'Invalid or production source database.'}
$oldDb=Invoke-WebRequest -Uri "$auditResumeApi/d1/database/$($auditResume.sourceDatabaseId)" -Headers $auditResumeHeaders -SkipHttpErrorCheck
if($oldDb.StatusCode -ne 404){throw 'Original database must be deleted before continuation; refusing concurrent phase owners.'}
foreach($oldWorker in $auditResume.sourceWorker,$auditResume.sourceSiteWorker){if($oldWorker -notmatch '^mayor-audit-(?:probe|site)-[a-f0-9]{12}$'){throw 'Original Worker identity did not match.'};$old=Invoke-WebRequest -Uri "$auditResumeApi/workers/scripts/$oldWorker" -Headers $auditResumeHeaders -SkipHttpErrorCheck;if($old.StatusCode -ne 404){throw 'Original Workers must be deleted before continuation.'}}
$auditResumeFreeze=Get-Content -Raw -LiteralPath $auditResume.codeFreezePath|ConvertFrom-Json
foreach($file in $auditResumeFreeze.files){if((Get-FileHash -Algorithm SHA256 -LiteralPath $file.path).Hash.ToLowerInvariant() -ne $file.sha256){throw 'Continuation requires the exact original frozen engine snapshot.'}}
$auditResumeSuffix=[Guid]::NewGuid().ToString('N').Substring(0,12)
$auditResumeWorker="mayor-audit-resume-$auditResumeSuffix";$auditResumeDbName="mayor-audit-db-$auditResumeSuffix"
$auditResumeConfig=[IO.Path]::GetFullPath(".wrangler/audit-resume-$auditResumeSuffix.json")
$auditResumeEvidencePath=[IO.Path]::GetFullPath("../../docs/mayor/evidence/$EvidenceName.json")
$auditResumeKey=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
$auditResumeDbId=$null;$auditResumeCreated=$false
$auditResumeEvidence=[ordered]@{synthetic=$true;createdAt=[DateTime]::UtcNow.ToString('o');continuationOf=@{worker=$auditResume.sourceWorker;databaseId=$auditResume.sourceDatabaseId;jobId=$auditResumeOrder.analysis_job_id;reference=$auditResumeOrder.analysis_job_reference;attempts=$auditResumeOrder.analysis_attempts;stageAttempts=$auditResumeOrder.analysis_stage_attempts};worker=$auditResumeWorker;databaseName=$auditResumeDbName;orderId=$auditResumeOrder.id;phases=@();cleanup=[ordered]@{}}
$absent=Invoke-WebRequest -Uri "$auditResumeApi/workers/scripts/$auditResumeWorker" -Headers $auditResumeHeaders -SkipHttpErrorCheck;if($absent.StatusCode -ne 404){throw 'Continuation Worker absence could not be verified.'}
try{
 $db=Invoke-RestMethod -Method Post -Uri "$auditResumeApi/d1/database" -Headers $auditResumeHeaders -ContentType 'application/json' -Body (@{name=$auditResumeDbName}|ConvertTo-Json)
 if(-not $db.success -or -not $db.result.uuid){throw 'Continuation database creation failed.'};$auditResumeDbId=$db.result.uuid;$auditResumeEvidence.databaseId=$auditResumeDbId
 if((Get-Content -Raw -LiteralPath 'wrangler.jsonc').Contains($auditResumeDbId)){throw 'Refusing a production database.'}
 @{name=$auditResumeWorker;main=[IO.Path]::GetFullPath('tests/remote/business-audit-probe.ts');workers_dev=$true;preview_urls=$false;compatibility_date='2026-09-22';compatibility_flags=@('nodejs_compat','global_fetch_strictly_public');ai=@{binding='AI'};vars=@{APP_ORIGIN='https://mayor.mehyar.us';MAYOR_STRIPE_MODE='test'};d1_databases=@(@{binding='AGENT_DB';database_name=$auditResumeDbName;database_id=$auditResumeDbId})}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $auditResumeConfig
 foreach($migration in 'migrations/0047_mayor_billing.sql','migrations/0048_mayor_audit_jobs.sql'){& npx --no-install wrangler d1 execute AGENT_DB --remote --config $auditResumeConfig --file $migration;if($LASTEXITCODE -ne 0){throw 'Continuation migration failed.'}}
 # Preserve stage, attempts, evidence, and the exact acknowledged provider job. Receipt identities are new synthetic values.
 $columns=@('id','mode','payment_status','fulfillment_status','intake_json','amount_cents','currency','paid_at','created_at','updated_at','analysis_stage','analysis_attempts','analysis_stage_attempts','analysis_next_attempt_at','analysis_error_code','analysis_review_count','evidence_json','draft_json','review_json','report_json','report_created_at','analysis_job_id','analysis_job_model','analysis_job_reference','analysis_job_started_at','analysis_job_poll_failures')
 $values=@($columns|ForEach-Object{$auditResumeOrder.$_})+@([Guid]::NewGuid().ToString(),'c'*64,[Guid]::NewGuid().ToString('N')+'d'*32)
 $allColumns=$columns+@('request_id','request_hash','status_token_hash');$placeholders=($allColumns|ForEach-Object{'?'})-join ','
 $insert=@{sql="INSERT INTO mayor_audit_orders($($allColumns -join ',')) VALUES($placeholders)";params=$values}|ConvertTo-Json -Depth 8
 $seed=Invoke-RestMethod -Method Post -Uri "$auditResumeApi/d1/database/$auditResumeDbId/query" -Headers $auditResumeHeaders -ContentType 'application/json' -Body $insert
 if(-not $seed.success){throw 'Exact synthetic continuation seed failed.'}
 $auditResumeCreated=$true;$deployed=& npx --no-install wrangler deploy --config $auditResumeConfig 2>&1;if($LASTEXITCODE -ne 0){throw 'Continuation Worker deployment failed.'}
 $url=[regex]::Match(($deployed-join "`n"),"https://$([regex]::Escape($auditResumeWorker))\.[a-z0-9-]+\.workers\.dev").Value;if(-not $url){throw 'No continuation URL returned.'};$auditResumeEvidence.workerUrl=$url
 $auditResumeEvidence.deploymentVersion=[regex]::Match(($deployed-join "`n"),'Current Version ID: ([a-f0-9-]+)').Groups[1].Value
 $auditResumeKey|& npx --no-install wrangler secret put PROBE_KEY --config $auditResumeConfig;if($LASTEXITCODE -ne 0){throw 'Continuation secret setup failed.'}
 for($readyAttempt=0;$readyAttempt -lt 20;$readyAttempt++){$ready=Invoke-WebRequest -Uri "$url/ready" -Headers @{'x-mayor-probe-key'=$auditResumeKey} -SkipHttpErrorCheck;if($ready.StatusCode -eq 200){break};Start-Sleep -Seconds 2};if($ready.StatusCode -ne 200){throw 'Continuation authentication was not ready.'}
 $anonymous=Invoke-WebRequest -Uri "$url/status?order=$($auditResumeOrder.id)" -SkipHttpErrorCheck;if($anonymous.StatusCode -ne 401){throw 'Continuation anonymous access was not denied.'};$auditResumeEvidence.anonymousHttpStatus=401
 for($phase=0;$phase -lt $MaxPhases;$phase++){
  Write-Output "Continuing persisted audit phase $($phase+1)."
  $response=Invoke-WebRequest -Method Post -Uri "$url/run?order=$($auditResumeOrder.id)" -Headers @{'x-mayor-probe-key'=$auditResumeKey} -TimeoutSec 650 -SkipHttpErrorCheck;if($response.StatusCode -ne 200){throw 'Continuation invocation failed.'}
  $result=$response.Content|ConvertFrom-Json;$auditResumeEvidence.phases+=@($result)
  $result.state|Select-Object analysis_stage,analysis_attempts,analysis_stage_attempts,analysis_error_code,fulfillment_status|ConvertTo-Json -Compress|Write-Output
  $result.calls|ConvertTo-Json -Depth 8 -Compress|Write-Output
  $auditResumeEvidence|ConvertTo-Json -Depth 35|Set-Content -LiteralPath $auditResumeEvidencePath
  if($result.state.fulfillment_status -eq 'report_ready'){$auditResumeEvidence.success=$true;break}
  if($result.state.fulfillment_status -eq 'needs_review'){throw 'Continuation settled into needs_review; no bypass or manual resubmission.'}
  if($result.state.analysis_error_code){if($result.summary.retrying -ne 1 -or $result.state.fulfillment_status -ne 'in_review' -or $result.state.analysis_attempts -gt 12){throw 'Continuation was not a bounded runtime retry.'};$delay=[Math]::Ceiling(($result.state.analysis_next_attempt_at-[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())/1000);if($delay -lt 0 -or $delay -gt 900){throw 'Invalid continuation backoff.'};while($delay -gt 0){$slice=[Math]::Min(60,$delay);Start-Sleep -Seconds $slice;$delay-=$slice}}
  if($result.summary.waiting -gt 0){Start-Sleep -Seconds 60}
 }
 if(-not $auditResumeEvidence.success){$auditResumeEvidence.error='bounded_harness_deadline';throw 'Continuation harness deadline; existing provider state is not a model rejection.'}
}catch{$auditResumeEvidence.success=$false;if(-not $auditResumeEvidence.error){$auditResumeEvidence.error='continuation_incomplete'};throw}
finally{
 $auditResumeKey=$null
 if($auditResumeCreated){& npx --no-install wrangler delete --name $auditResumeWorker --force;if($LASTEXITCODE -eq 0){$removed=Invoke-WebRequest -Uri "$auditResumeApi/workers/scripts/$auditResumeWorker" -Headers $auditResumeHeaders -SkipHttpErrorCheck;$auditResumeEvidence.cleanup.worker=$removed.StatusCode}else{$auditResumeEvidence.cleanup.worker='delete_failed'}}
 if($auditResumeDbId){$owned=Invoke-RestMethod -Uri "$auditResumeApi/d1/database/$auditResumeDbId" -Headers $auditResumeHeaders;if($owned.success -and $owned.result.name -eq $auditResumeDbName -and $auditResumeDbName -match '^mayor-audit-db-[a-f0-9]{12}$'){$deleted=Invoke-RestMethod -Method Delete -Uri "$auditResumeApi/d1/database/$auditResumeDbId" -Headers $auditResumeHeaders;$removed=Invoke-WebRequest -Uri "$auditResumeApi/d1/database/$auditResumeDbId" -Headers $auditResumeHeaders -SkipHttpErrorCheck;$auditResumeEvidence.cleanup.database=$removed.StatusCode}else{$auditResumeEvidence.cleanup.database='ownership_mismatch'}}
 if(Test-Path -LiteralPath $auditResumeConfig){Remove-Item -LiteralPath $auditResumeConfig}
 $auditResumeEvidence|ConvertTo-Json -Depth 35|Set-Content -LiteralPath $auditResumeEvidencePath
 Write-Output "Continuation evidence: $auditResumeEvidencePath"
}
