// Creates one short-lived, account-scoped probe token, runs local Wrangler,
// captures a fixed synthetic result, then stops the process and revokes the token.
import {spawn} from 'node:child_process';
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const account=process.env.CLOUDFLARE_ACCOUNT_ID??process.env.CF_ACCOUNT_ID;
const key=process.env.CLOUDFLARE_API_KEY??process.env.CF_API_KEY,email=process.env.CLOUDFLARE_EMAIL??process.env.CF_API_EMAIL;
if(!process.argv.includes('--live')){console.log('Use --live for one synthetic binding call and temporary token creation.');process.exit(0);}
if(!/^[a-f0-9]{32}$/i.test(account??'')||!key||!email)throw new Error('Probe credential bootstrap is unavailable.');
const headers={'content-type':'application/json','X-Auth-Key':key,'X-Auth-Email':email};
async function api(path,method='GET',body){
  const response=await fetch(`https://api.cloudflare.com/client/v4${path}`,{method,headers,body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(30000)});
  const data=await response.json();if(!response.ok||!data.success){
    const detail=JSON.stringify(data.errors??[]).slice(0,1000).replaceAll(key,'[redacted]').replaceAll(email,'[redacted]').replaceAll(account,'[account]');
    throw new Error(`Probe credential operation failed: HTTP ${response.status} ${detail}`);
  }return data.result;
}
const names=['Workers Scripts Write','Workers AI Read','AI Gateway Run'];
const groups=await api('/user/tokens/permission_groups');
const selected=names.map(name=>{const group=groups.find(g=>g.name===name&&g.scopes.includes('com.cloudflare.api.account'));if(!group)throw new Error('Required probe permission unavailable.');return {id:group.id};});
const report={version:1,startedAt:new Date().toISOString(),syntheticOnly:true,permissions:names,tokenExpiresAt:new Date(Date.now()+30*60*1000).toISOString().replace(/\.\d{3}Z$/,'Z'),tokenRevoked:false,productionAcceptanceApproved:false};
let token,child,log='';
const cleanup=new URL('../.wrangler/binding-probe-token.json',import.meta.url);
try{
  token=await api('/user/tokens','POST',{name:'Mehyar Business Agent temporary binding probe',expires_on:report.tokenExpiresAt,policies:[{effect:'allow',permission_groups:selected,resources:{[`com.cloudflare.api.account.${account}`]:'*'}}]});
  await mkdir(new URL('../.wrangler/',import.meta.url),{recursive:true});
  await writeFile(cleanup,JSON.stringify({id:token.id,expiresAt:report.tokenExpiresAt}));
  const childEnv={...process.env,CLOUDFLARE_API_TOKEN:token.value,CLOUDFLARE_ACCOUNT_ID:account};
  for(const name of ['CF_API_KEY','CF_API_EMAIL','CLOUDFLARE_API_KEY','CLOUDFLARE_EMAIL'])delete childEnv[name];
  child=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url)),'dev','--config','wrangler.binding-probe.jsonc','--ip','127.0.0.1','--port','8799'],{cwd:root,env:childEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const collect=data=>{log=(log+data.toString()).slice(-4000);};child.stdout.on('data',collect);child.stderr.on('data',collect);
  let ready=false;
  for(let attempt=0;attempt<60;attempt++){
    if(child.exitCode!==null)throw new Error('Wrangler exited before readiness.');
    try{const response=await fetch('http://127.0.0.1:8799/probe',{signal:AbortSignal.timeout(500)});if(response.status===404){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  if(!ready)throw new Error('Local probe readiness timed out.');
  const response=await fetch('http://127.0.0.1:8799/probe',{method:'POST',headers:{'x-probe-intent':'synthetic-only'},signal:AbortSignal.timeout(70000)});
  report.httpStatus=response.status;report.result=await response.json();
  if(!response.ok)throw new Error('Binding call failed.');
  report.state='validated';
}catch(error){report.state='failed';report.error=error instanceof Error?error.message:'Probe failed';}
finally{
  if(child?.pid&&child.exitCode===null){
    if(process.platform==='win32')await new Promise(resolve=>{const stop=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});stop.on('close',resolve);stop.on('error',resolve);});
    else child.kill('SIGTERM');
  }
  if(token?.id){try{await api(`/user/tokens/${token.id}`,'DELETE');report.tokenRevoked=true;await unlink(cleanup);}catch{report.cleanupRequired=true;}}
}
if(report.state==='failed')report.wranglerLog=log.replaceAll(token?.value??'never-matches-secret', '[redacted]').replaceAll(key,'[redacted]').replaceAll(email,'[redacted]').replaceAll(account,'[account]');
report.completedAt=new Date().toISOString();
const directory=new URL('../../../docs/implementation/evidence/',import.meta.url);await mkdir(directory,{recursive:true});
const output=new URL(`ai-binding-${Date.now()}.json`,directory);await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:fileURLToPath(output),state:report.state,tokenRevoked:report.tokenRevoked,result:report.result,error:report.error}));
if(report.state!=='validated'||!report.tokenRevoked)process.exitCode=1;
