// Additive development resource only. Never updates or deletes any gateway.
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const account=process.env.CLOUDFLARE_ACCOUNT_ID??process.env.CF_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
const key=process.env.CLOUDFLARE_API_KEY??process.env.CF_API_KEY,email=process.env.CLOUDFLARE_EMAIL??process.env.CF_API_EMAIL;
if(!/^[a-f0-9]{32}$/i.test(account??'')||(!token&&!(key&&email)))throw new Error('Cloudflare credentials are required; values are not logged.');
const desired={id:'mehyar-business-agent-dev',authentication:true,collect_logs:false,cache_ttl:0,cache_invalidate_on_update:false,rate_limiting_interval:60,rate_limiting_limit:10,rate_limiting_technique:'fixed',retry_max_attempts:1,workers_ai_billing_mode:'postpaid'};
const headers={'content-type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{'X-Auth-Key':key,'X-Auth-Email':email})};
const base=`https://api.cloudflare.com/client/v4/accounts/${account}/ai-gateway/gateways`;
async function api(url,method='GET',body){
  const response=await fetch(url,{method,headers,body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(30000)});
  const envelope=await response.json();
  if(!response.ok||!envelope.success)throw new Error(`Gateway ${method} failed with HTTP ${response.status}; no automatic retry.`);
  return envelope;
}
const before=await api(`${base}?per_page=50`);
if(before.result_info.total_count>50)throw new Error('Complete gateway inventory required before provisioning.');
const selected=g=>Object.fromEntries(Object.keys(desired).map(k=>[k,g[k]]));
const previous=before.result.map(selected);
let created=false;
if(!before.result.some(g=>g.id===desired.id)){
  if(!process.argv.includes('--create')){console.log(JSON.stringify({state:'not_created',desired}));process.exit(0);}
  await api(base,'POST',desired);created=true;
}
const after=await api(`${base}?per_page=50`),current=after.result.find(g=>g.id===desired.id);
const matches=current&&Object.entries(desired).every(([key,value])=>current[key]===value);
const unchanged=previous.every(g=>JSON.stringify(selected(after.result.find(item=>item.id===g.id)??{}))===JSON.stringify(g));
const report={checkedAt:new Date().toISOString(),created,desired,observed:current?selected(current):null,settingsMatch:!!matches,existingGatewaysUnchanged:unchanged,productionReleaseApproved:false};
const directory=new URL('../../../docs/implementation/evidence/',import.meta.url);await mkdir(directory,{recursive:true});
const output=new URL(`dev-gateway-${Date.now()}.json`,directory);await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:fileURLToPath(output),...report}));
if(!matches||!unchanged)process.exitCode=1;
