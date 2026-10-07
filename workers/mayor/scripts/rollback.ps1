param(
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9-]{36}$')][string]$VersionId,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9-]{36}$')][string]$ExpectedCurrentVersion,
 [string]$Reason='Restore a verified compatible Mayor release',
 [switch]$PlanOnly
)
$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot '..')
if($env:CF_API_EMAIL){$env:CLOUDFLARE_EMAIL=$env:CF_API_EMAIL}
if($env:CF_API_KEY){$env:CLOUDFLARE_API_KEY=$env:CF_API_KEY}
if($env:CF_ACCOUNT_ID){$env:CLOUDFLARE_ACCOUNT_ID=$env:CF_ACCOUNT_ID}
$config=Get-Content -LiteralPath 'wrangler.production.jsonc' -Raw | ConvertFrom-Json
if($config.name -ne 'mehyar-mayor'){throw 'Unexpected Worker configuration.'}
function Read-Deployments {
 $output=& npx wrangler deployments list --config wrangler.production.jsonc --json
 if($LASTEXITCODE -ne 0){throw 'Could not verify deployment state.'}
 return ($output -join "`n" | ConvertFrom-Json | Sort-Object created_on -Descending)
}
$deployments=@(Read-Deployments)
$current=$deployments[0]
if($current.versions.Count -ne 1 -or $current.versions[0].percentage -ne 100 -or $current.versions[0].version_id -ne $ExpectedCurrentVersion){throw 'The active deployment differs from the expected version. Recheck before rollback.'}
if($VersionId -eq $ExpectedCurrentVersion){throw 'The requested rollback would not change the deployed version.'}
if(-not ($deployments | Where-Object {$_.versions.Count -eq 1 -and $_.versions[0].version_id -eq $VersionId -and $_.versions[0].percentage -eq 100})){throw 'Choose a previously fully deployed version from the recent deployment history.'}
Write-Output "Rollback plan: $ExpectedCurrentVersion -> $VersionId. D1 and Durable Object data will not be restored."
if($PlanOnly){return}
& npx wrangler rollback $VersionId --config wrangler.production.jsonc --message $Reason --yes
if($LASTEXITCODE -ne 0){throw 'Worker rollback failed.'}
$after=@(Read-Deployments)[0]
if($after.versions.Count -ne 1 -or $after.versions[0].version_id -ne $VersionId -or $after.versions[0].percentage -ne 100){throw 'Rollback command finished, but the active version was not verified.'}
& node scripts/smoke.mjs 'https://mayor.mehyar.us'
if($LASTEXITCODE -ne 0){throw 'Post-rollback smoke checks failed. Investigate before accepting traffic.'}
Write-Output 'Rollback version and public smoke checks verified.'
