param([switch]$SkipChecks)
$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot '..')
if($env:CF_API_EMAIL){$env:CLOUDFLARE_EMAIL=$env:CF_API_EMAIL}
if($env:CF_API_KEY){$env:CLOUDFLARE_API_KEY=$env:CF_API_KEY}
if($env:CF_ACCOUNT_ID){$env:CLOUDFLARE_ACCOUNT_ID=$env:CF_ACCOUNT_ID}
function Invoke-Checked([string]$Executable,[string[]]$Arguments){
  & $Executable @Arguments
  if($LASTEXITCODE -ne 0){throw "Command failed: $Executable $($Arguments -join ' ')"}
}
# Shared checkout and fulfillment are immutable in this project.
Invoke-Checked git @('diff','--exit-code','5f8eb6c','--','../../functions/api/pay','../../functions/api/_shared')
if(-not $SkipChecks){
  Invoke-Checked npm @('run','check')
  Invoke-Checked npx @('tsc','-p','web/tsconfig.json')
  Invoke-Checked npm @('test')
  Invoke-Checked npm @('run','test:integration')
  $recoveryTests=@(Get-ChildItem -LiteralPath 'tests/recovery' -Filter '*.test.mjs' | Sort-Object Name | ForEach-Object {$_.FullName})
  Invoke-Checked node (@('--test')+$recoveryTests)
}
Invoke-Checked npm @('run','build')
Invoke-Checked npx @('wrangler','d1','migrations','apply','AGENT_DB','--remote','--config','wrangler.production.jsonc')
Invoke-Checked npx @('wrangler','deploy','--config','wrangler.production.jsonc')
Invoke-Checked node @('scripts/smoke.mjs','https://mayor.mehyar.us')
