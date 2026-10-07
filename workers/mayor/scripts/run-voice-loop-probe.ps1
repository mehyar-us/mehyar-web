param([ValidateSet(0,12000)][int]$StartupDelayMs=0,[switch]$CancelRestart,[switch]$Greeting,[string]$EvidenceName='2026-09-22-voice-loop')
$ErrorActionPreference='Stop'
if($EvidenceName -notmatch '^[a-z0-9-]+$'){throw 'Evidence name must contain only lowercase letters, digits and hyphens'}
Set-Location (Join-Path $PSScriptRoot '..')
Get-Command ffprobe,ffmpeg -ErrorAction Stop | Out-Null
$probeConfig='tests/remote/wrangler.voice-loop-probe.jsonc'
$probeName='mayor-voice-loop-probe'
if((Get-Content -Raw -LiteralPath $probeConfig | ConvertFrom-Json).name -ne $probeName){throw 'Unexpected test Worker name'}
$env:CLOUDFLARE_EMAIL=$env:CF_API_EMAIL
$env:CLOUDFLARE_API_KEY=$env:CF_API_KEY
$env:CLOUDFLARE_ACCOUNT_ID=$env:CF_ACCOUNT_ID
$probeApi="https://api.cloudflare.com/client/v4/accounts/$($env:CF_ACCOUNT_ID)/workers/scripts/$probeName"
$probeHeaders=@{'X-Auth-Email'=$env:CF_API_EMAIL;'X-Auth-Key'=$env:CF_API_KEY}
$existingProbe=Invoke-WebRequest -Uri $probeApi -Headers $probeHeaders -SkipHttpErrorCheck
if($existingProbe.StatusCode -ne 404){throw 'Test Worker already exists or absence cannot be verified; refusing to overwrite/delete it.'}
$probeKey=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
try{
 $deployment=& npx wrangler deploy --config $probeConfig 2>&1
 $deployment | Write-Output
 if($LASTEXITCODE -ne 0){throw 'Probe deployment failed'}
 $probeUrl=[regex]::Match(($deployment -join "`n"),'https://mayor-voice-loop-probe\.[a-z0-9-]+\.workers\.dev').Value
 if(-not $probeUrl){throw 'No test Worker URL returned'}
 $probeKey | & npx wrangler secret put PROBE_KEY --config $probeConfig
 if($LASTEXITCODE -ne 0){throw 'Probe secret setup failed'}
 for($probeAttempt=0;$probeAttempt -lt 10;$probeAttempt++){
  $anonymousProbe=Invoke-WebRequest -Method Post -Uri "$probeUrl/run" -SkipHttpErrorCheck
  if($anonymousProbe.StatusCode -eq 401){break}
  Write-Output "Waiting for test route: HTTP $($anonymousProbe.StatusCode)"
  if($anonymousProbe.StatusCode -notin 404,503){break}
  Start-Sleep -Seconds 2
 }
 if($anonymousProbe.StatusCode -ne 401){throw "Test route did not return required 401 (HTTP $($anonymousProbe.StatusCode)): $($anonymousProbe.Content.Substring(0,[Math]::Min(200,$anonymousProbe.Content.Length)))"}
 # A new secret version can lag the deployed route. Only 401 is safe to retry:
 # the probe rejects it before synthesizing audio or opening a call.
 for($secretAttempt=0;$secretAttempt -lt 6;$secretAttempt++){
  $probeResponse=Invoke-WebRequest -Method Post -Uri "$probeUrl/run?delay=$StartupDelayMs&cancelRestart=$($CancelRestart.IsPresent.ToString().ToLowerInvariant())&greeting=$($Greeting.IsPresent.ToString().ToLowerInvariant())" -Headers @{'X-Mayor-Probe-Key'=$probeKey} -TimeoutSec 75 -SkipHttpErrorCheck
  if($probeResponse.StatusCode -ne 401){break}
  if($secretAttempt -lt 5){Start-Sleep -Seconds 2}
 }
 try{$probeResult=$probeResponse.Content | ConvertFrom-Json}catch{throw "Test response HTTP $($probeResponse.StatusCode): $($probeResponse.Content.Substring(0,[Math]::Min(300,$probeResponse.Content.Length)))"}
 if($probeResult.audioBase64){
  $probeAudioPath=[IO.Path]::GetFullPath("../../docs/mayor/evidence/$EvidenceName.mp3")
  [IO.File]::WriteAllBytes($probeAudioPath,[Convert]::FromBase64String($probeResult.audioBase64))
  $probeResult.PSObject.Properties.Remove('audioBase64')
  $decodedAudio=& ffprobe -v error -show_entries stream=codec_name,sample_rate,channels -show_entries format=duration -of json $probeAudioPath
  if($LASTEXITCODE -ne 0){throw 'Returned speech audio cannot be decoded'}
  & ffmpeg -v error -i $probeAudioPath -f null -
  if($LASTEXITCODE -ne 0){throw 'Returned speech audio failed full decoding'}
  $probeResult | Add-Member -NotePropertyName decodedAudio -NotePropertyValue ($decodedAudio | ConvertFrom-Json)
  $probeResult | Add-Member -NotePropertyName audioSha256 -NotePropertyValue ((Get-FileHash -LiteralPath $probeAudioPath -Algorithm SHA256).Hash.ToLowerInvariant())
 }
 $probeResult | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "../../docs/mayor/evidence/$EvidenceName.json"
 $probeResult | ConvertTo-Json -Depth 8
 if($probeResponse.StatusCode -ne 200){throw 'Remote voice loop failed; evidence captured'}
}finally{
 $probeKey=$null
 & npx wrangler delete --name $probeName --force
 if($LASTEXITCODE -ne 0){throw 'Temporary test Worker cleanup failed'}
 $removedProbe=Invoke-WebRequest -Uri $probeApi -Headers $probeHeaders -SkipHttpErrorCheck
 if($removedProbe.StatusCode -ne 404){throw 'Temporary test Worker deletion is not confirmed'}
 Write-Output 'Temporary test Worker deletion confirmed (404).'
}
