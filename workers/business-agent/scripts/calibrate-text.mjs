// Explicit, bounded synthetic probe. Never deploys or changes provider settings.
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const compiled=await build({stdin:{contents:"export {estimateStandardText} from './src/billing/text-meter.ts'; export {parseTextUsageReceipt} from './src/billing/text-receipt.ts';",resolveDir:root},bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
const {estimateStandardText,parseTextUsageReceipt}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const cases=[
  {id:'short',text:'Hello, world!'},
  {id:'unicode-json',text:JSON.stringify({emailText:'مرحبا 😀 Please book Friday.\nQuotation: "hello".',trustedForInstructions:false})},
  {id:'long-ascii',text:'alpha beta gamma delta '.repeat(2400)},
  {id:'credit-boundary',text:' a'.repeat(11950)},
];
const requests=cases.map(item=>({id:item.id,request:{messages:[{role:'system',content:'Synthetic token calibration. Reply only OK.'},{role:'user',content:item.text}],max_tokens:64}}));
const live=process.argv.includes('--live');
const report={version:1,startedAt:new Date().toISOString(),mode:live?'live':'dry-run',route:'workers-ai-direct-rest',model:'@cf/openai/gpt-oss-120b',syntheticOnly:true,productionSettingsChanged:false,records:[]};
report.scriptSha256=createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex');
const account=process.env.CLOUDFLARE_ACCOUNT_ID??process.env.CF_ACCOUNT_ID;
const token=process.env.CLOUDFLARE_API_TOKEN;
const key=process.env.CLOUDFLARE_API_KEY??process.env.CF_API_KEY,email=process.env.CLOUDFLARE_EMAIL??process.env.CF_API_EMAIL;
if(live&&(!/^[a-f0-9]{32}$/i.test(account??'')||(!token&&!(key&&email))))throw new Error('Cloudflare account and credentials are required; values are not logged.');
for(const {id,request} of requests){
  const estimate=estimateStandardText(request),body=JSON.stringify(request);
  const record={id,requestSha256:createHash('sha256').update(body).digest('hex'),estimate};report.records.push(record);
  if(!live)continue;
  try{
    const started=Date.now();
    const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/openai/gpt-oss-120b`,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{'content-type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{'X-Auth-Key':key,'X-Auth-Email':email})},body});
    record.httpStatus=response.status;record.elapsedMs=Date.now()-started;
    const envelope=await response.json();
    if(!response.ok||envelope.success===false){record.state='provider_error';record.errorCodes=Array.isArray(envelope.errors)?envelope.errors.map(e=>e.code).filter(Number.isSafeInteger):[];break;}
    record.receipt=parseTextUsageReceipt(envelope.result??envelope);
    record.state=record.receipt.state;
    if(record.receipt.state==='reported'){
      record.inputTokenDifference=record.receipt.inputTokens-estimate.inputTokens;
      record.reportedCreditUnits=Math.max(1,Math.ceil(record.receipt.inputTokens/12000),Math.ceil(record.receipt.outputTokens/2000));
    }
    else break;
  }catch(error){record.state='transport_error';record.errorType=error instanceof Error?error.name:'unknown';break;}
}
report.completedAt=new Date().toISOString();
report.allReported=live&&report.records.length===requests.length&&report.records.every(r=>r.state==='reported');
// A direct synthetic probe cannot certify the production Gateway or release gates.
report.productionCalibrationApproved=false;
const directory=new URL('../../../docs/implementation/evidence/',import.meta.url);
await mkdir(directory,{recursive:true});
const output=new URL(`text-calibration-${Date.now()}.json`,directory);
await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:fileURLToPath(output),allReported:report.allReported,records:report.records.map(({id,state,httpStatus,receipt,inputTokenDifference})=>({id,state,httpStatus,receipt,inputTokenDifference}))}));
if(live&&!report.allReported)process.exitCode=1;
