# Synthetic remote drill only. Never accepts an existing database as a target.
param([string]$EvidenceName='2026-09-28-time-travel-drill')
$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot '..')
if($EvidenceName -notmatch '^[a-z0-9-]+$'){throw 'Invalid evidence name'}
$reportPath=[IO.Path]::GetFullPath("../../docs/mayor/evidence/$EvidenceName.json")
if(Test-Path -LiteralPath $reportPath){throw 'Evidence already exists; choose a new name'}
if(-not $env:CF_ACCOUNT_ID -or -not $env:CF_API_EMAIL -or -not $env:CF_API_KEY){throw 'Cloudflare credentials are required'}
$production=(Get-Content -LiteralPath wrangler.production.jsonc -Raw|ConvertFrom-Json).d1_databases[0].database_id
$headers=@{'X-Auth-Email'=$env:CF_API_EMAIL;'X-Auth-Key'=$env:CF_API_KEY}
$endpoint="https://api.cloudflare.com/client/v4/accounts/$env:CF_ACCOUNT_ID/d1/database"
$drillName='mayor-time-travel-'+[Guid]::NewGuid().ToString('N').Substring(0,16)
$createdId=$null
$report=[ordered]@{startedAt=(Get-Date).ToUniversalTime().ToString('o');syntheticOnly=$true;productionModified=$false;restored=$false;cleanupVerified=$false}
function Assert-DrillIdentity {
 if(-not $createdId -or $createdId -eq $production){throw 'Unsafe restore target'}
 $current=Invoke-RestMethod -Uri "$endpoint/$createdId" -Headers $headers -TimeoutSec 30
 if(-not $current.success -or $current.result.name -ne $drillName){throw 'Temporary database identity mismatch'}
}
function Invoke-DrillSQL([string]$sql){
 $result=Invoke-RestMethod -Method Post -Uri "$endpoint/$createdId/query" -Headers $headers -ContentType application/json -Body (@{sql=$sql}|ConvertTo-Json -Compress) -TimeoutSec 30
 if(-not $result.success -or @($result.result|Where-Object {-not $_.success}).Count){throw 'Drill query failed'}
 return $result.result
}
try {
 $created=Invoke-RestMethod -Method Post -Uri $endpoint -Headers $headers -ContentType application/json -Body (@{name=$drillName}|ConvertTo-Json -Compress) -TimeoutSec 30
 if(-not $created.success -or -not $created.result.uuid){throw 'Temporary database creation failed'}
 $createdId=[string]$created.result.uuid
 Assert-DrillIdentity
 $report.databaseId=$createdId;$report.databaseName=$drillName
 Write-Output "Created isolated synthetic database: $drillName ($createdId)"
 for($attempt=0;$attempt -lt 10;$attempt++){
  $ready=Invoke-WebRequest -Method Post -Uri "$endpoint/$createdId/query" -Headers $headers -ContentType application/json -Body '{"sql":"SELECT 1 AS ready"}' -SkipHttpErrorCheck -TimeoutSec 30
  if($ready.StatusCode -eq 200 -and ($ready.Content|ConvertFrom-Json).success){break}
  if($ready.StatusCode -notin 401,403,404,503){throw "Unexpected readiness response: $($ready.StatusCode)"}
  Start-Sleep -Seconds 2
 }
 if($ready.StatusCode -ne 200 -or -not ($ready.Content|ConvertFrom-Json).success){throw 'Temporary database not ready'}
 Invoke-DrillSQL "CREATE TABLE restore_probe(id INTEGER PRIMARY KEY,value TEXT NOT NULL); INSERT INTO restore_probe VALUES(1,'confirmed fixture'),(2,'second fixture');" | Out-Null
 $bookmark=Invoke-RestMethod -Uri "$endpoint/$createdId/time_travel/bookmark" -Headers $headers -TimeoutSec 30
 if(-not $bookmark.success -or -not $bookmark.result.bookmark){throw 'No restore bookmark returned'}
 $report.bookmark=[string]$bookmark.result.bookmark
 Invoke-DrillSQL "UPDATE restore_probe SET value='changed fixture' WHERE id=1; DELETE FROM restore_probe WHERE id=2; CREATE TABLE later_schema(id INTEGER);" | Out-Null
 $changed=Invoke-DrillSQL 'SELECT id,value FROM restore_probe ORDER BY id;'
 if($changed.results.Count -ne 1 -or $changed.results[0].value -ne 'changed fixture'){throw 'Fixture mutation not verified'}
 Assert-DrillIdentity
 $restoreStarted=Get-Date
 # Never replay a restore request after timeout/ambiguous response.
 $restored=Invoke-RestMethod -Method Post -Uri "$endpoint/$createdId/time_travel/restore?bookmark=$([Uri]::EscapeDataString($report.bookmark))" -Headers $headers -TimeoutSec 60
 if(-not $restored.success){throw 'Time Travel restore was not accepted'}
 $report.restoreRequestMs=[Math]::Round(((Get-Date)-$restoreStarted).TotalMilliseconds)
 $rows=Invoke-DrillSQL 'SELECT id,value FROM restore_probe ORDER BY id;'
 $schema=Invoke-DrillSQL "SELECT name FROM sqlite_master WHERE type='table' AND name='later_schema';"
 if($rows.results.Count -ne 2 -or $rows.results[0].value -ne 'confirmed fixture' -or $rows.results[1].value -ne 'second fixture' -or $schema.results.Count -ne 0){throw 'Restored row/schema state does not match bookmark'}
 $report.restored=$true;$report.verifiedRows=2;$report.laterSchemaRemoved=$true
 $report.limitation='Synthetic native D1 restore only; not production restore, retention-window validation, secrets, provider reconciliation or full disaster recovery.'
 Write-Output 'Verified original rows and schema restored through native Time Travel.'
}finally {
 if($createdId -and $createdId -ne $production){
  Assert-DrillIdentity
  $deleted=Invoke-RestMethod -Method Delete -Uri "$endpoint/$createdId" -Headers $headers -TimeoutSec 30
  if(-not $deleted.success){throw 'Temporary database deletion failed'}
  $missing=Invoke-WebRequest -Uri "$endpoint/$createdId" -Headers $headers -SkipHttpErrorCheck -TimeoutSec 30
  if($missing.StatusCode -ne 404){throw 'Temporary database deletion unverified'}
  $report.cleanupVerified=$true
  Write-Output 'Temporary database deletion verified (404).'
 }
 $report.completedAt=(Get-Date).ToUniversalTime().ToString('o')
 $report|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $reportPath
}
