param([ValidatePattern('^[a-z0-9-]+$')][string]$EvidenceName='2026-10-03-business-harness')
$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot '..')
foreach($required in 'CF_ACCOUNT_ID','CF_API_EMAIL','CF_API_KEY'){if(-not [Environment]::GetEnvironmentVariable($required)){throw "Missing configured credential: $required"}}
$env:CLOUDFLARE_EMAIL=$env:CF_API_EMAIL
$env:CLOUDFLARE_API_KEY=$env:CF_API_KEY
$env:CLOUDFLARE_ACCOUNT_ID=$env:CF_ACCOUNT_ID
$harnessSuffix=[Guid]::NewGuid().ToString('N').Substring(0,12)
$harnessName="mayor-harness-probe-$harnessSuffix"
$harnessDbName="mayor-harness-db-$harnessSuffix"
$harnessHeaders=@{'X-Auth-Email'=$env:CF_API_EMAIL;'X-Auth-Key'=$env:CF_API_KEY}
$harnessApi="https://api.cloudflare.com/client/v4/accounts/$($env:CF_ACCOUNT_ID)"
$harnessConfig=[IO.Path]::GetFullPath(".wrangler/harness-probe-$harnessSuffix.json")
$harnessEvidencePath=[IO.Path]::GetFullPath("../../docs/mayor/evidence/$EvidenceName.json")
$harnessKey=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
$harnessDbId=$null;$harnessWorkerCreated=$false
$harnessEvidence=[ordered]@{synthetic=$true;createdAt=[DateTime]::UtcNow.ToString('o');worker=$harnessName;databaseName=$harnessDbName;cleanup=[ordered]@{}}
$harnessAbsent=Invoke-WebRequest -Uri "$harnessApi/workers/scripts/$harnessName" -Headers $harnessHeaders -SkipHttpErrorCheck
if($harnessAbsent.StatusCode -ne 404){throw 'Temporary Worker absence could not be verified; refusing to overwrite.'}
function Checked([string]$Executable,[string[]]$Arguments){& $Executable @Arguments;if($LASTEXITCODE -ne 0){throw "Command failed: $Executable"}}
Checked npx @('tsc','--noEmit','--target','ES2022','--module','ESNext','--moduleResolution','Bundler','--lib','ES2022','--types','@cloudflare/workers-types','--strict','--skipLibCheck','tests/remote/business-harness-probe.ts')
try{
 $harnessCreated=Invoke-RestMethod -Method Post -Uri "$harnessApi/d1/database" -Headers $harnessHeaders -ContentType 'application/json' -Body (@{name=$harnessDbName}|ConvertTo-Json)
 $harnessProductionId=(Get-Content -Raw -LiteralPath 'wrangler.production.jsonc'|ConvertFrom-Json).d1_databases[0].database_id
 if(-not $harnessCreated.success -or -not $harnessCreated.result.uuid -or $harnessCreated.result.name -ne $harnessDbName -or $harnessCreated.result.uuid -eq $harnessProductionId){throw 'Temporary database identity validation failed.'}
 $harnessDbId=[string]$harnessCreated.result.uuid;$harnessEvidence.databaseId=$harnessDbId
 for($harnessDbReadyAttempt=0;$harnessDbReadyAttempt -lt 10;$harnessDbReadyAttempt++){
  $harnessReady=Invoke-WebRequest -Method Post -Uri "$harnessApi/d1/database/$harnessDbId/query" -Headers $harnessHeaders -ContentType 'application/json' -Body '{"sql":"SELECT 1 AS ready"}' -SkipHttpErrorCheck
  if($harnessReady.StatusCode -eq 200 -and ($harnessReady.Content|ConvertFrom-Json).success){break}
  if($harnessReady.StatusCode -notin 401,403,404,503){throw 'Unexpected temporary database readiness response.'}
  Start-Sleep -Seconds 2
 }
 if($harnessReady.StatusCode -ne 200 -or -not ($harnessReady.Content|ConvertFrom-Json).success){throw 'Temporary database query readiness failed.'}
 [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($harnessConfig))|Out-Null
 @{name=$harnessName;main=[IO.Path]::GetFullPath('tests/remote/business-harness-probe.ts');workers_dev=$true;preview_urls=$false;compatibility_date='2026-09-22';compatibility_flags=@('nodejs_compat','global_fetch_strictly_public');ai=@{binding='AI'};vars=@{APP_ORIGIN='https://mayor.mehyar.us';ENVIRONMENT='synthetic-test';MAYOR_STRIPE_MODE='test'};d1_databases=@(@{binding='AGENT_DB';database_name=$harnessDbName;database_id=$harnessDbId;migrations_dir=[IO.Path]::GetFullPath('migrations')})}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $harnessConfig
 $harnessMigrationOutput=& npx --no-install wrangler d1 migrations apply AGENT_DB --remote --config $harnessConfig 2>&1
 if($LASTEXITCODE -ne 0){throw 'Temporary database migrations failed.'}
 Write-Output 'All migrations applied to isolated agent acceptance database.'
 $harnessWorkerCreated=$true;$harnessDeployment=& npx --no-install wrangler deploy --config $harnessConfig 2>&1
 if($LASTEXITCODE -ne 0){throw 'Temporary agent Worker deployment failed.'}
 $harnessUrl=[regex]::Match(($harnessDeployment -join "`n"),"https://$([regex]::Escape($harnessName))\.[a-z0-9-]+\.workers\.dev").Value
 if(-not $harnessUrl){throw 'Temporary Worker URL was not returned.'}
 $harnessEvidence.workerUrl=$harnessUrl;$harnessEvidence.deploymentVersion=[regex]::Match(($harnessDeployment -join "`n"),'Current Version ID: ([a-f0-9-]+)').Groups[1].Value
 $harnessKey|& npx --no-install wrangler secret put PROBE_KEY --config $harnessConfig
 if($LASTEXITCODE -ne 0){throw 'Temporary Worker secret setup failed.'}
 for($harnessRouteAttempt=0;$harnessRouteAttempt -lt 15;$harnessRouteAttempt++){
  $harnessAnonymous=Invoke-WebRequest -Uri "$harnessUrl/ready" -SkipHttpErrorCheck
  $harnessAuthenticated=Invoke-WebRequest -Uri "$harnessUrl/ready" -Headers @{'x-mayor-probe-key'=$harnessKey} -SkipHttpErrorCheck
  if($harnessAnonymous.StatusCode -eq 401 -and $harnessAuthenticated.StatusCode -eq 200){break}
  Start-Sleep -Seconds 2
 }
 $harnessEvidence.anonymousHttpStatus=$harnessAnonymous.StatusCode;$harnessEvidence.authenticatedHttpStatus=$harnessAuthenticated.StatusCode
 if($harnessAnonymous.StatusCode -ne 401 -or $harnessAuthenticated.StatusCode -ne 200){throw 'Temporary route protection or readiness failed.'}
 Write-Output 'Running actual Workers AI report, usage, replay and reviewed-task acceptance.'
 $harnessResponse=Invoke-WebRequest -Method Post -Uri "$harnessUrl/run" -Headers @{'x-mayor-probe-key'=$harnessKey} -TimeoutSec 100 -SkipHttpErrorCheck
 $harnessEvidence.httpStatus=$harnessResponse.StatusCode
 if($harnessResponse.Headers.'Content-Type' -notmatch 'json'){throw 'Temporary acceptance did not return JSON.'}
 $harnessResult=$harnessResponse.Content|ConvertFrom-Json;$harnessEvidence.result=$harnessResult
 $harnessResult.checks|ConvertTo-Json -Compress|Write-Output
 if($harnessResponse.StatusCode -ne 200 -or -not $harnessResult.passed){throw 'Actual agent acceptance failed; inspect saved evidence.'}
 $harnessEvidence.success=$true
}catch{$harnessEvidence.success=$false;$harnessEvidence.error='acceptance_incomplete';throw}
finally{
 $harnessKey=$null
 if($harnessWorkerCreated){
  & npx --no-install wrangler delete --name $harnessName --force
  if($LASTEXITCODE -ne 0){$harnessEvidence.cleanup.worker='delete_failed'}else{$harnessRemoved=Invoke-WebRequest -Uri "$harnessApi/workers/scripts/$harnessName" -Headers $harnessHeaders -SkipHttpErrorCheck;$harnessEvidence.cleanup.worker=$harnessRemoved.StatusCode}
 }
 if($harnessDbId){
  $harnessOwned=Invoke-RestMethod -Uri "$harnessApi/d1/database/$harnessDbId" -Headers $harnessHeaders
  if($harnessOwned.success -and $harnessOwned.result.name -eq $harnessDbName -and $harnessDbName.StartsWith('mayor-harness-db-') -and $harnessDbId -ne $harnessProductionId){
   $harnessDeleted=Invoke-RestMethod -Method Delete -Uri "$harnessApi/d1/database/$harnessDbId" -Headers $harnessHeaders
   $harnessRemovedDb=Invoke-WebRequest -Uri "$harnessApi/d1/database/$harnessDbId" -Headers $harnessHeaders -SkipHttpErrorCheck
   $harnessEvidence.cleanup.database=$harnessRemovedDb.StatusCode
  }else{$harnessEvidence.cleanup.database='ownership_not_verified'}
 }
 if(Test-Path -LiteralPath $harnessConfig){Remove-Item -LiteralPath $harnessConfig}
 $harnessEvidence|ConvertTo-Json -Depth 35|Set-Content -LiteralPath $harnessEvidencePath
 Write-Output "Agent evidence saved: $harnessEvidencePath"
}
