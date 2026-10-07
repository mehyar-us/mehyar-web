param([ValidatePattern('^[a-z0-9-]+$')][string]$EvidenceName='2026-10-03-business-audit')
$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$auditSavedEvidence=Get-Content -Raw -LiteralPath "../../docs/mayor/evidence/$EvidenceName.json"|ConvertFrom-Json
if(-not $auditSavedEvidence.synthetic -or $auditSavedEvidence.orderId -notmatch '^[a-f0-9-]{36}$'){throw 'Only isolated synthetic audit evidence is eligible.'}
$auditQueuedCall=@($auditSavedEvidence.phases.calls|Where-Object operation -eq 'queue')[-1]
$auditSavedJobId=$auditQueuedCall.jobId
if($auditSavedJobId -notmatch '^[a-f0-9-]{36}$'){throw 'No verified queued job identity is available.'}
$auditInspectHeaders=@{'X-Auth-Email'=$env:CF_API_EMAIL;'X-Auth-Key'=$env:CF_API_KEY}
$auditInspectUrl="https://api.cloudflare.com/client/v4/accounts/$($env:CF_ACCOUNT_ID)/ai/run/@cf/moonshotai/kimi-k2.6?queueRequest=true"
$auditInspectResponse=Invoke-WebRequest -Method Post -Uri $auditInspectUrl -Headers $auditInspectHeaders -ContentType 'application/json' -Body (@{request_id=$auditSavedJobId}|ConvertTo-Json) -SkipHttpErrorCheck
if($auditInspectResponse.StatusCode -ne 200){throw "Existing job retrieval returned HTTP $($auditInspectResponse.StatusCode)."}
$auditInspectEnvelope=$auditInspectResponse.Content|ConvertFrom-Json
$auditInspectItem=@($auditInspectEnvelope.result.results)[0]
if(-not $auditInspectEnvelope.success -or -not $auditInspectItem.success -or -not $auditInspectItem.external_reference.StartsWith("mayor-audit:$($auditSavedEvidence.orderId):")){throw 'A matching completed synthetic result was not returned.'}
$auditInspectChoice=$auditInspectItem.result.choices[0]
if($auditInspectChoice.finish_reason -ne 'stop' -or -not $auditInspectChoice.message.content){throw 'A complete structured model result was not returned.'}
# Do not save or print hidden reasoning, raw provider errors, credentials, or unrelated jobs.
$auditInspectDraft=$auditInspectChoice.message.content|ConvertFrom-Json
$auditInspectChoice.message.content|Set-Content -LiteralPath "../../docs/mayor/evidence/$EvidenceName-completed-content.json"
$auditInspectSources=$auditSavedEvidence.phases[0].evidence.sources
$auditInspectMismatches=@()
foreach($auditInspectFinding in $auditInspectDraft.findings){foreach($auditInspectCitation in $auditInspectFinding.citations){
 if($auditInspectCitation.quoteId){continue}
 $auditInspectSource=$auditInspectSources|Where-Object id -eq $auditInspectCitation.sourceId
 $auditInspectNormalizedSource=($auditInspectSource.excerpt -replace '\s+',' ').Trim()
 $auditInspectNormalizedQuote=($auditInspectCitation.quote -replace '\s+',' ').Trim()
 if(-not $auditInspectNormalizedSource.Contains($auditInspectNormalizedQuote)){$auditInspectMismatches+=@([ordered]@{finding=$auditInspectFinding.id;source=$auditInspectCitation.sourceId;quote=$auditInspectCitation.quote;excerpt=$auditInspectSource.excerpt})}
}}
$auditUsesQuoteIds=@($auditInspectDraft.findings.citations|Where-Object quoteId).Count -gt 0
$auditInspectProof=[ordered]@{synthetic=$true;newInference=$false;jobId=$auditSavedJobId;reference=$auditInspectItem.external_reference;model=$auditInspectItem.result.model;finishReason=$auditInspectChoice.finish_reason;usage=$auditInspectItem.result.usage;citationCheck=$(if($auditUsesQuoteIds){'quote_ids_deferred_to_engine_catalog'}else{'normalized_literal_inclusion'});unsupportedCitations=$(if($auditUsesQuoteIds){$null}else{$auditInspectMismatches})}
$auditInspectProof|ConvertTo-Json -Depth 12|Set-Content -LiteralPath "../../docs/mayor/evidence/$EvidenceName-completed-proof.json"
$auditInspectProof|ConvertTo-Json -Depth 12
