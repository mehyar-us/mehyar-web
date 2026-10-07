param([string]$EvidenceName='2026-10-03-business-audit',[switch]$SkipModelAvailability,[ValidateRange(1,180)][int]$MaxPhases=120,[ValidateRange(0,180)][int]$StartupSettleSeconds=0)
$ErrorActionPreference='Stop'
if($EvidenceName -notmatch '^[a-z0-9-]+$'){throw 'Evidence name must contain only lowercase letters, digits and hyphens.'}
Set-Location (Join-Path $PSScriptRoot '..')
foreach($required in 'CF_ACCOUNT_ID','CF_API_EMAIL','CF_API_KEY'){if(-not [Environment]::GetEnvironmentVariable($required)){throw "Missing configured credential: $required"}}
$env:CLOUDFLARE_EMAIL=$env:CF_API_EMAIL
$env:CLOUDFLARE_API_KEY=$env:CF_API_KEY
$env:CLOUDFLARE_ACCOUNT_ID=$env:CF_ACCOUNT_ID
$auditProbeSuffix=[Guid]::NewGuid().ToString('N').Substring(0,12)
$auditProbeName="mayor-audit-probe-$auditProbeSuffix"
$auditSiteName="mayor-audit-site-$auditProbeSuffix"
$auditDbName="mayor-audit-db-$auditProbeSuffix"
$auditHeaders=@{'X-Auth-Email'=$env:CF_API_EMAIL;'X-Auth-Key'=$env:CF_API_KEY}
$auditApi="https://api.cloudflare.com/client/v4/accounts/$($env:CF_ACCOUNT_ID)"
$auditProbeConfig=[IO.Path]::GetFullPath(".wrangler/audit-probe-$auditProbeSuffix.json")
$auditSiteConfig=[IO.Path]::GetFullPath(".wrangler/audit-site-$auditProbeSuffix.json")
$auditEvidencePath=[IO.Path]::GetFullPath("../../docs/mayor/evidence/$EvidenceName.json")
$auditKey=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
function ConvertTo-AuditStartupSafeText([object]$value,[int]$limit=2400){
 $text=[string]$value
 foreach($sensitive in @($auditKey,$env:CF_ACCOUNT_ID,$env:CF_API_EMAIL,$env:CF_API_KEY)){if($sensitive){$text=$text.Replace($sensitive,'[REDACTED]')}}
 if($text.Length -gt $limit){$text=$text.Substring(0,$limit)}
 return $text
}
function Get-AuditStartupResponseEvidence([string]$stage,[object]$response){
 $body=[string]$response.Content
 return [ordered]@{stage=$stage;checkedAt=[DateTime]::UtcNow.ToString('o');status=[int]$response.StatusCode;contentType=ConvertTo-AuditStartupSafeText ($response.Headers.'Content-Type' -join ',') 300;cfRay=ConvertTo-AuditStartupSafeText ($response.Headers.'CF-Ray' -join ',') 300;retryAfter=ConvertTo-AuditStartupSafeText ($response.Headers.'Retry-After' -join ',') 300;body=ConvertTo-AuditStartupSafeText $body;bodyCharacters=$body.Length;bodyTruncated=$body.Length -gt 2400}
}
$auditDbId=$null;$auditProbeCreated=$false;$auditSiteCreated=$false
$auditEvidence=[ordered]@{synthetic=$true;createdAt=[DateTime]::UtcNow.ToString('o');worker=$auditProbeName;siteWorker=$auditSiteName;databaseName=$auditDbName;startupSettleSeconds=$StartupSettleSeconds;startupResponses=@();authenticatedReadyRetries=0;authenticatedRunRetries=0;phases=@();cleanup=[ordered]@{}}
foreach($name in $auditProbeName,$auditSiteName){$existing=Invoke-WebRequest -Uri "$auditApi/workers/scripts/$name" -Headers $auditHeaders -SkipHttpErrorCheck;if($existing.StatusCode -ne 404){throw 'Temporary Worker absence could not be verified; refusing to overwrite it.'}}
try{
 $createdDb=Invoke-RestMethod -Method Post -Uri "$auditApi/d1/database" -Headers $auditHeaders -ContentType 'application/json' -Body (@{name=$auditDbName}|ConvertTo-Json)
 if(-not $createdDb.success -or -not $createdDb.result.uuid){throw 'Temporary database creation failed.'};$auditDbId=$createdDb.result.uuid;$auditEvidence.databaseId=$auditDbId
 $prodConfig=Get-Content -Raw -LiteralPath 'wrangler.jsonc'
 if($prodConfig.Contains($auditDbId)){throw 'Temporary database matched a production binding; refusing further actions.'}
 [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($auditProbeConfig)) | Out-Null
 @{name=$auditSiteName;main=[IO.Path]::GetFullPath('tests/remote/business-audit-site.ts');workers_dev=$true;preview_urls=$false;compatibility_date='2026-09-22'} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $auditSiteConfig
 @{name=$auditProbeName;main=[IO.Path]::GetFullPath('tests/remote/business-audit-probe.ts');workers_dev=$true;preview_urls=$false;compatibility_date='2026-09-22';compatibility_flags=@('nodejs_compat','global_fetch_strictly_public');ai=@{binding='AI'};vars=@{APP_ORIGIN='https://mayor.mehyar.us';MAYOR_STRIPE_MODE='test'};d1_databases=@(@{binding='AGENT_DB';database_name=$auditDbName;database_id=$auditDbId})} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $auditProbeConfig
 & npx --no-install wrangler d1 execute AGENT_DB --remote --config $auditProbeConfig --file migrations/0047_mayor_billing.sql
 if($LASTEXITCODE -ne 0){throw 'Temporary database migration failed.'}
 & npx --no-install wrangler d1 execute AGENT_DB --remote --config $auditProbeConfig --file migrations/0048_mayor_audit_jobs.sql
 if($LASTEXITCODE -ne 0){throw 'Temporary audit-job migration failed.'}
 $auditSiteCreated=$true;$siteDeployment=& npx --no-install wrangler deploy --config $auditSiteConfig 2>&1
 if($LASTEXITCODE -ne 0){throw 'Temporary source Worker deployment failed.'}
 $siteUrl=[regex]::Match(($siteDeployment -join "`n"),"https://$([regex]::Escape($auditSiteName))\.[a-z0-9-]+\.workers\.dev").Value
 if(-not $siteUrl){throw 'No temporary source URL returned.'};$auditEvidence.siteUrl="$siteUrl/"
 $auditProbeCreated=$true;$probeDeployment=& npx --no-install wrangler deploy --config $auditProbeConfig 2>&1
 if($LASTEXITCODE -ne 0){throw 'Temporary audit Worker deployment failed.'}
 $probeUrl=[regex]::Match(($probeDeployment -join "`n"),"https://$([regex]::Escape($auditProbeName))\.[a-z0-9-]+\.workers\.dev").Value
 if(-not $probeUrl){throw 'No temporary audit URL returned.'};$auditEvidence.workerUrl=$probeUrl
 $auditEvidence.deploymentVersion=[regex]::Match(($probeDeployment -join "`n"),'Current Version ID: ([a-f0-9-]+)').Groups[1].Value
 $auditKey | & npx --no-install wrangler secret put PROBE_KEY --config $auditProbeConfig
 if($LASTEXITCODE -ne 0){throw 'Temporary audit secret setup failed.'}
 # A bounded startup-only pause precedes every readiness request. It does not
 # assert the cause of an earlier failure or retry accepted inference work.
 $auditEvidence.startupSettlingStartedAt=[DateTime]::UtcNow.ToString('o')
 $auditStartupRemaining=$StartupSettleSeconds
 while($auditStartupRemaining -gt 0){$auditStartupSlice=[Math]::Min(30,$auditStartupRemaining);Start-Sleep -Seconds $auditStartupSlice;$auditStartupRemaining-=$auditStartupSlice}
 $auditEvidence.startupSettlingCompletedAt=[DateTime]::UtcNow.ToString('o')
 for($routeAttempt=0;$routeAttempt -lt 12;$routeAttempt++){
  $anonymous=Invoke-WebRequest -Method Post -Uri "$probeUrl/init" -SkipHttpErrorCheck
  $auditEvidence.startupResponses+=@(Get-AuditStartupResponseEvidence 'anonymous_init_denial' $anonymous)
  if($anonymous.StatusCode -eq 401){break};if($anonymous.StatusCode -notin 404,503){break};Start-Sleep -Seconds 2
 }
 if($anonymous.StatusCode -ne 401){throw 'Temporary route did not demonstrate the required anonymous 401.'}
 $auditEvidence.anonymousHttpStatus=$anonymous.StatusCode
 for($keyAttempt=0;$keyAttempt -lt 20;$keyAttempt++){
  $keyReady=Invoke-WebRequest -Uri "$probeUrl/ready" -Headers @{'x-mayor-probe-key'=$auditKey} -SkipHttpErrorCheck
  $auditEvidence.startupResponses+=@(Get-AuditStartupResponseEvidence 'authenticated_get_ready' $keyReady)
  if($keyReady.StatusCode -eq 200){break};if($keyReady.StatusCode -notin 401,404 -or $keyAttempt -ge 19){break}
  # Read-only readiness precedes initialization and all model activity. The new
  # route and secret may propagate independently; this never retries /run.
  $auditEvidence.authenticatedReadyRetries++;Start-Sleep -Seconds 2
 }
 $auditEvidence.authenticatedReadyHttpStatus=$keyReady.StatusCode
 if($keyReady.StatusCode -ne 200){$auditEvidence.error="key_readiness_http_$($keyReady.StatusCode)";throw "Temporary authentication is not ready (HTTP $($keyReady.StatusCode))."}
 for($siteAttempt=0;$siteAttempt -lt 12;$siteAttempt++){$siteReady=Invoke-WebRequest -Uri "$siteUrl/" -SkipHttpErrorCheck;if($siteReady.StatusCode -eq 200){break};Start-Sleep -Seconds 2}
 if($siteReady.StatusCode -ne 200){throw 'Synthetic source route is not ready.'}
 for($secretAttempt=0;$secretAttempt -lt 6;$secretAttempt++){
  $initialized=Invoke-WebRequest -Method Post -Uri "$probeUrl/init" -Headers @{'x-mayor-probe-key'=$auditKey} -ContentType 'application/json' -Body (@{website="$siteUrl/"}|ConvertTo-Json) -SkipHttpErrorCheck
  if($initialized.StatusCode -ne 401){break};Start-Sleep -Seconds 2
 }
 $auditEvidence.initializationHttpStatus=$initialized.StatusCode
 if($initialized.StatusCode -ne 200){$auditEvidence.error="initialization_http_$($initialized.StatusCode)";if($initialized.Headers.'Content-Type' -match 'json'){$auditEvidence.initializationError=$initialized.Content|ConvertFrom-Json};throw "Synthetic order initialization failed (HTTP $($initialized.StatusCode))."};$auditOrder=($initialized.Content|ConvertFrom-Json).orderId;$auditEvidence.orderId=$auditOrder
 $network=Invoke-WebRequest -Uri "$probeUrl/network?website=$([Uri]::EscapeDataString("$siteUrl/"))" -Headers @{'x-mayor-probe-key'=$auditKey} -SkipHttpErrorCheck
 $auditEvidence.networkHttpStatus=$network.StatusCode
 if($network.StatusCode -eq 200){$auditEvidence.network=$network.Content|ConvertFrom-Json;$auditEvidence.network | ConvertTo-Json -Depth 8 | Write-Output}
 if(-not $SkipModelAvailability){$models=Invoke-WebRequest -Method Post -Uri "$probeUrl/models" -Headers @{'x-mayor-probe-key'=$auditKey} -TimeoutSec 120 -SkipHttpErrorCheck
  $auditEvidence.modelAvailabilityHttpStatus=$models.StatusCode
  if($models.StatusCode -ne 200){$auditEvidence.error="model_probe_http_$($models.StatusCode)";throw 'Model availability probe failed.'};$auditEvidence.modelAvailability=$models.Content|ConvertFrom-Json;$auditEvidence.modelAvailability | ConvertTo-Json -Depth 8 | Write-Output}
 $auditEvidence | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $auditEvidencePath
 for($phase=0;$phase -lt $MaxPhases;$phase++){
  Write-Output "Running isolated audit phase $($phase+1) (bounded latest-model inference when applicable)."
  for($runAuthAttempt=0;$runAuthAttempt -lt 3;$runAuthAttempt++){
   $response=Invoke-WebRequest -Method Post -Uri "$probeUrl/run?order=$auditOrder" -Headers @{'x-mayor-probe-key'=$auditKey} -TimeoutSec 650 -SkipHttpErrorCheck
   if($response.StatusCode -ne 401 -or $runAuthAttempt -ge 2 -or $response.Headers.'Content-Type' -notmatch 'json'){break}
   $runAuthBody=$null;try{$runAuthBody=$response.Content|ConvertFrom-Json}catch{}
   # This exact fixture branch returns before any database/model activity. Unknown
   # HTTP errors, transport failures and accepted model work are never resubmitted.
   if(-not $runAuthBody -or @($runAuthBody.PSObject.Properties.Name).Count -ne 1 -or $runAuthBody.error -ne 'unauthorized'){break}
   $auditEvidence.authenticatedRunRetries++;Write-Output 'Verified temporary unauthorized-before-engine response; retrying the same authenticated route after two seconds.';Start-Sleep -Seconds 2
  }
  if($response.StatusCode -ne 200){$auditEvidence.error="probe_http_$($response.StatusCode)";throw 'Temporary audit invocation failed.'}
  $result=$response.Content|ConvertFrom-Json;$auditEvidence.phases+=@($result)
  $result.state | Select-Object analysis_stage,analysis_attempts,analysis_review_count,analysis_error_code,fulfillment_status | ConvertTo-Json -Compress | Write-Output
  $result.calls | ConvertTo-Json -Depth 8 -Compress | Write-Output
  $auditEvidence | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $auditEvidencePath
  if($result.state.fulfillment_status -eq 'report_ready'){$auditEvidence.success=$true;break}
  if($result.state.fulfillment_status -eq 'needs_review'){$auditEvidence.success=$false;throw 'Audit requires review; evidence captured, no fallback or manual retry.'}
  if($result.state.analysis_error_code){
   if($result.summary.retrying -ne 1 -or $result.state.fulfillment_status -ne 'in_review' -or $result.state.analysis_attempts -gt 12){$auditEvidence.success=$false;throw 'Audit error was not an explicitly bounded runtime retry.'}
   $retryDelay=[Math]::Ceiling(($result.state.analysis_next_attempt_at-[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())/1000)
   if($retryDelay -lt 0 -or $retryDelay -gt 900){throw 'Audit retry deadline was outside its bounded backoff.'}
   Write-Output "Recorded runtime retry: $($result.state.analysis_error_code), attempt $($result.state.analysis_attempts); waiting for the persisted deadline."
   while($retryDelay -gt 0){$retrySlice=[Math]::Min(60,$retryDelay);Start-Sleep -Seconds $retrySlice;$retryDelay-=$retrySlice}
  }
  if($result.summary.waiting -gt 0){Write-Output 'Model job queued; waiting 60 seconds before reusing its persisted job.';Start-Sleep -Seconds 60}
 }
 if(-not $auditEvidence.success){$auditEvidence.error='bounded_harness_deadline';throw 'The bounded harness deadline did not produce a reviewed report; this does not establish a provider rejection.'}
 Write-Output 'Synthetic audit report stored only after independent model approval.'
}catch{$auditEvidence.success=$false;if(-not $auditEvidence.error){$auditEvidence.error='probe_incomplete'};throw}
finally{
 $auditKey=$null
 foreach($owned in @(@{name=$auditProbeName;created=$auditProbeCreated},@{name=$auditSiteName;created=$auditSiteCreated})){
  if($owned.created){& npx --no-install wrangler delete --name $owned.name --force; if($LASTEXITCODE -ne 0){$auditEvidence.cleanup[$owned.name]='delete_failed'}else{$removed=Invoke-WebRequest -Uri "$auditApi/workers/scripts/$($owned.name)" -Headers $auditHeaders -SkipHttpErrorCheck;$auditEvidence.cleanup[$owned.name]=$removed.StatusCode;if($removed.StatusCode -ne 404){Write-Error 'Temporary Worker deletion is not confirmed.' -ErrorAction Continue}}}
 }
 if($auditDbId){
  $ownedDb=Invoke-RestMethod -Uri "$auditApi/d1/database/$auditDbId" -Headers $auditHeaders
  if(-not $ownedDb.success -or $ownedDb.result.name -ne $auditDbName -or -not $auditDbName.StartsWith('mayor-audit-db-')){Write-Error 'Temporary database ownership did not match; refusing deletion.' -ErrorAction Continue}else{
   $deletedDb=Invoke-RestMethod -Method Delete -Uri "$auditApi/d1/database/$auditDbId" -Headers $auditHeaders
   $removedDb=Invoke-WebRequest -Uri "$auditApi/d1/database/$auditDbId" -Headers $auditHeaders -SkipHttpErrorCheck;$auditEvidence.cleanup.database=$removedDb.StatusCode
   if(-not $deletedDb.success -or $removedDb.StatusCode -ne 404){Write-Error 'Temporary database deletion is not confirmed.' -ErrorAction Continue}
  }
 }
 foreach($config in $auditProbeConfig,$auditSiteConfig){if(Test-Path -LiteralPath $config){Remove-Item -LiteralPath $config}}
 $auditEvidence | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $auditEvidencePath
 Write-Output "Audit evidence: $auditEvidencePath"
}
