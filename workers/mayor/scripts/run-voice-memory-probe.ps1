param([ValidateSet('name','nickname','hours','setup','setup-complete','recovery','onboarding','onboarding-natural','website','calendar','agent')][string]$Scenario='name',[switch]$TextOnly,[switch]$HttpTextOnly,[ValidatePattern('^\d{4}-\d{2}-\d{2}$')][string]$EvidenceDate=(Get-Date -Format 'yyyy-MM-dd'))
$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$env:CLOUDFLARE_EMAIL=$env:CF_API_EMAIL
$env:CLOUDFLARE_API_KEY=$env:CF_API_KEY
$env:CLOUDFLARE_ACCOUNT_ID=$env:CF_ACCOUNT_ID
$probeName='mayor-voice-memory-'+[Guid]::NewGuid().ToString('N').Substring(0,8)
$probeHeaders=@{'X-Auth-Email'=$env:CF_API_EMAIL;'X-Auth-Key'=$env:CF_API_KEY}
$probeApi="https://api.cloudflare.com/client/v4/accounts/$($env:CF_ACCOUNT_ID)/workers/scripts/$probeName"
$probeD1Api="https://api.cloudflare.com/client/v4/accounts/$($env:CF_ACCOUNT_ID)/d1/database"
$existing=Invoke-WebRequest -Uri $probeApi -Headers $probeHeaders -SkipHttpErrorCheck
if($existing.StatusCode -ne 404){throw 'Test Worker absence cannot be verified; refusing overwrite/deletion.'}
$productionId=(Get-Content -Raw -LiteralPath 'wrangler.production.jsonc' | ConvertFrom-Json).d1_databases[0].database_id
$probeDbName='mayor-voice-memory-'+[Guid]::NewGuid().ToString('N').Substring(0,16)
$probeConfig=[IO.Path]::GetFullPath('tests/remote/.voice-memory.generated.json')
if(Test-Path -LiteralPath $probeConfig){throw 'Generated test configuration already exists; inspect it before running.'}
$probeDbId=$null;$workerAttempted=$false;$tailJob=$null
$probeKey=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
function Checked([string]$Executable,[string[]]$Arguments){& $Executable @Arguments;if($LASTEXITCODE -ne 0){throw "Test command failed: $Executable"}}
Checked npx @('tsc','--noEmit','--target','ES2022','--module','ESNext','--moduleResolution','Bundler','--lib','ES2022','--types','@cloudflare/workers-types','--strict','--skipLibCheck','tests/remote/voice-memory-probe.ts')
try{
 $created=Invoke-RestMethod -Method Post -Uri $probeD1Api -Headers $probeHeaders -ContentType 'application/json' -Body (@{name=$probeDbName}|ConvertTo-Json)
 if(-not $created.success -or -not $created.result.uuid -or $created.result.name -ne $probeDbName -or $created.result.uuid -eq $productionId){throw 'Test database identity validation failed'}
 $probeDbId=[string]$created.result.uuid
 # A freshly created D1 database can briefly reject queries while its access
 # state propagates. Retry only this read-only readiness query, never mutations.
 for($dbReadyAttempt=0;$dbReadyAttempt -lt 10;$dbReadyAttempt++){
  $dbReady=Invoke-WebRequest -Method Post -Uri "$probeD1Api/$probeDbId/query" -Headers $probeHeaders -ContentType 'application/json' -Body '{"sql":"SELECT 1 AS ready"}' -SkipHttpErrorCheck
  if($dbReady.StatusCode -eq 200 -and ($dbReady.Content|ConvertFrom-Json).success){break}
  if($dbReady.StatusCode -notin 401,403,404,503){throw "Unexpected test database readiness response: $($dbReady.StatusCode)"}
  Start-Sleep -Seconds 2
 }
 if($dbReady.StatusCode -ne 200 -or -not ($dbReady.Content|ConvertFrom-Json).success){throw 'Test database query readiness failed'}
 @{
  name=$probeName;main='voice-memory-probe.ts';compatibility_date='2026-09-22';compatibility_flags=@('nodejs_compat');workers_dev=$true;preview_urls=$false
  ai=@{binding='AI'};vars=@{APP_ORIGIN="https://$probeName.mehyar.workers.dev";ENVIRONMENT='synthetic-test'}
  durable_objects=@{bindings=@(@{name='MAYOR_VOICE';class_name='MayorVoice'})};migrations=@(@{tag='v1';new_sqlite_classes=@('MayorVoice')})
  d1_databases=@(@{binding='AGENT_DB';database_name=$probeDbName;database_id=$probeDbId;migrations_dir='../../migrations'})
 } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $probeConfig
 $migrationOutput=& npx wrangler d1 migrations apply AGENT_DB --remote --config $probeConfig 2>&1
 if($LASTEXITCODE -ne 0){$migrationOutput | Write-Output;throw 'Test migrations failed'}
 Write-Output 'All migrations applied to isolated test database.'
 $workerAttempted=$true
 $deployment=& npx wrangler deploy --config $probeConfig 2>&1
 $deployment | Write-Output
 if($LASTEXITCODE -ne 0){throw 'Test Worker deployment failed'}
 $probeUrl=[regex]::Match(($deployment -join "`n"),('https://'+[regex]::Escape($probeName)+'\.[a-z0-9-]+\.workers\.dev')).Value
 if(-not $probeUrl){throw 'Test Worker URL missing'}
 $probeKey | & npx wrangler secret put PROBE_KEY --config $probeConfig
 if($LASTEXITCODE -ne 0){throw 'Test secret creation failed'}
 for($readyAttempt=0;$readyAttempt -lt 15;$readyAttempt++){
  $readyResponse=Invoke-WebRequest -Uri "$probeUrl/ready" -Headers @{'X-Mayor-Probe-Key'=$probeKey} -SkipHttpErrorCheck
  if($readyResponse.StatusCode -eq 200 -and $readyResponse.Content -match '"ready":true'){break}
  Start-Sleep -Seconds 2
 }
 if($readyResponse.StatusCode -ne 200 -or $readyResponse.Content -notmatch '"ready":true'){throw "Authenticated test readiness failed (HTTP $($readyResponse.StatusCode))"}
 for($attempt=0;$attempt -lt 10;$attempt++){
  $anonymous=Invoke-WebRequest -Method Post -Uri "$probeUrl/run" -SkipHttpErrorCheck
  if($anonymous.StatusCode -eq 401){break}
  if($anonymous.StatusCode -notin 404,503 -and -not ($anonymous.StatusCode -eq 500 -and $anonymous.Content.Trim() -eq 'error code: 1104')){throw "Unexpected unauthenticated test response HTTP $($anonymous.StatusCode): $($anonymous.Content.Substring(0,[Math]::Min(200,$anonymous.Content.Length)))"}
  Start-Sleep -Seconds 2
 }
 if($anonymous.StatusCode -ne 401){throw 'Test route protection not verified'}
 $tailJob=Start-Job -ArgumentList (Get-Location).Path,$probeName -ScriptBlock {
  param($probeWorkdir,$workerName)
  Set-Location $probeWorkdir
  & npx wrangler tail $workerName --format json | & node scripts/probe-exception-filter.mjs
 }
 Start-Sleep -Seconds 3
 for($startupAttempt=0;$startupAttempt -lt 3;$startupAttempt++){
  $result=Invoke-WebRequest -Method Post -Uri "$probeUrl/run?scenario=$Scenario&transport=$(if($HttpTextOnly){'http'}elseif($TextOnly){'text'}else{'speech'})" -Headers @{'X-Mayor-Probe-Key'=$probeKey} -TimeoutSec 170 -SkipHttpErrorCheck
  if($result.StatusCode -eq 401){Start-Sleep -Seconds 2;continue}
  if($result.Content -notmatch '^\s*\{'){
   # Preserve failed transport attempts without copying potentially sensitive response bodies.
   $safeRuntimeCode=[regex]::Match($result.Content,'(?i)(?:error code[: ]*|error[\s:-]*)(\d{3,5})').Groups[1].Value
   $evidence=[pscustomobject]@{passed=$false;scenario=$Scenario;transport=$(if($HttpTextOnly){'http'}elseif($TextOnly){'text'}else{'speech'});stage='remote-response';error='Non-JSON response from remote probe';httpStatus=[int]$result.StatusCode;runtimeErrorCode=$(if($safeRuntimeCode){$safeRuntimeCode}else{$null});turns=@();checks=@{};limitation='No conversation result was returned; this is not evidence of product acceptance.'}
   break
  }
  $evidence=$result.Content | ConvertFrom-Json
  if($evidence.error -ne 'Durable Object reset because its code was updated.' -or @($evidence.turns).Count -ne 0){break}
  Write-Output 'Deployment reset before speech began; retrying isolated startup.'
  Start-Sleep -Seconds 2
 }
 $evidence | Add-Member -NotePropertyName startupRetryCount -NotePropertyValue $startupAttempt
 $evidence | Add-Member -NotePropertyName databaseReadinessAttempts -NotePropertyValue ($dbReadyAttempt+1)
 $evidence | Add-Member -NotePropertyName anonymousReadinessAttempts -NotePropertyValue ($attempt+1)
 $evidencePath=$(if($HttpTextOnly){"../../docs/mayor/evidence/$EvidenceDate-http-$Scenario.json"}elseif($TextOnly){"../../docs/mayor/evidence/$EvidenceDate-text-$Scenario.json"}elseif($Scenario -eq 'name'){"../../docs/mayor/evidence/$EvidenceDate-voice-memory.json"}elseif($Scenario -eq 'hours'){"../../docs/mayor/evidence/$EvidenceDate-voice-hours.json"}else{"../../docs/mayor/evidence/$EvidenceDate-voice-$Scenario.json"})
 if(Test-Path -LiteralPath $evidencePath){$evidencePath=$evidencePath.Replace('.json','-'+[Guid]::NewGuid().ToString('N').Substring(0,8)+'.json')}
 $evidence | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $evidencePath
 Write-Output "Evidence saved: $evidencePath"
 [ordered]@{synthetic=$true;scenario=$Scenario;passed=$evidence.passed;transport=$evidence.transport;checks=$evidence.checks;turnCount=@($evidence.turns).Count} | ConvertTo-Json -Depth 5
 if($result.StatusCode -ne 200 -or -not $evidence.passed){throw 'Conversation onboarding test failed; evidence saved'}
}finally{
 $probeKey=$null
 if($tailJob){Stop-Job $tailJob;Receive-Job $tailJob;Remove-Job $tailJob}
 try{
  if($workerAttempted){
   Checked npx @('wrangler','delete','--name',$probeName,'--force')
   $removed=Invoke-WebRequest -Uri $probeApi -Headers $probeHeaders -SkipHttpErrorCheck
   if($removed.StatusCode -ne 404){throw 'Test Worker deletion not verified'}
   Write-Output 'Temporary voice-memory Worker deletion confirmed (404).'
  }
 }finally{
  if($probeDbId -and $probeDbId -ne $productionId){
   $check=Invoke-RestMethod -Uri "$probeD1Api/$probeDbId" -Headers $probeHeaders
   if(-not $check.success -or $check.result.name -ne $probeDbName){throw 'Test database cleanup identity mismatch'}
   $deleted=Invoke-RestMethod -Method Delete -Uri "$probeD1Api/$probeDbId" -Headers $probeHeaders
   if(-not $deleted.success){throw 'Test database cleanup failed'}
   $missing=Invoke-WebRequest -Uri "$probeD1Api/$probeDbId" -Headers $probeHeaders -SkipHttpErrorCheck
   if($missing.StatusCode -ne 404){throw 'Test database deletion not verified'}
   Write-Output 'Temporary voice-memory database deletion confirmed (404).'
  }
  if(Test-Path -LiteralPath $probeConfig){Remove-Item -LiteralPath $probeConfig}
 }
}
