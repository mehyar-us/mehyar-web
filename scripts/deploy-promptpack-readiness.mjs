import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Preserve live assets (including unpublished work) instead of rebuilding the
// homepage. Always run from a clean checkout of the pushed repair commit.
const root=fileURLToPath(new URL('../',import.meta.url));
const action=process.argv[2];
assert.ok(['prepare','preview','production'].includes(action),'Use prepare, preview or production');
assert.equal(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),'','Deployment requires a clean checkout');
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const releaseDir=path.join(os.tmpdir(),'promptpack-release-'+commit.slice(0,12));
const recordFile=path.join(releaseDir,'release.json');
const headers={'X-Auth-Email':process.env.CF_API_EMAIL,'X-Auth-Key':process.env.CF_API_KEY};
const account=process.env.CF_ACCOUNT_ID;
assert.ok(account&&headers['X-Auth-Email']&&headers['X-Auth-Key'],'Existing Cloudflare credentials required; no interactive login');
const api=async(endpoint,options={})=>{
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${endpoint}`,{...options,headers:{...headers,...options.headers}});
  const data=await response.json();
  assert.ok(response.ok&&data.success,`Cloudflare request failed: ${response.status}`);
  return data.result;
};
let record;
const save=async()=>fs.writeFile(recordFile,JSON.stringify(record,null,2));
if(action==='prepare'){
  await fs.mkdir(releaseDir,{recursive:true});
  try{await fs.access(recordFile);throw Error('Release already prepared; inspect its journal instead of repeating writes');}catch(e){if(e.code!=='ENOENT')throw e;}
  record={commit,createdAt:new Date().toISOString(),projects:{}};
  for(const name of ['mehyar-web','promptpack']){
    const project=await api(`/pages/projects/${name}`);
    const previous=await api(`/pages/projects/${name}/deployments/${project.canonical_deployment.id}`);
    assert.ok(previous.uses_functions,'Previous deployment must include Functions');
    if(name==='mehyar-web')assert.equal(previous.deployment_trigger.metadata.commit_hash,'d6f742f9d70eb8523d777bfd1b084444815d10ec','Production baseline changed; review before publishing');
    const base=path.join(releaseDir,name), assets=path.join(base,'public');
    await fs.mkdir(assets,{recursive:true});
    const names=Object.keys(previous.files);
    for(let offset=0;offset<names.length;offset+=6){
      await Promise.all(names.slice(offset,offset+6).map(async name=>{
        const target=path.resolve(assets,'.'+name);
        assert.ok(target.startsWith(assets+path.sep),'Unsafe manifest path');
        const response=await fetch(previous.url+name);assert.ok(response.ok,`Asset recovery failed: ${name}`);
        await fs.mkdir(path.dirname(target),{recursive:true});
        await fs.writeFile(target,Buffer.from(await response.arrayBuffer()));
      }));
    }
    record.projects[name]={previousId:previous.id,previousUrl:previous.url,previousFiles:previous.files,compatibilityDate:previous.compatibility_date};
    if(name==='mehyar-web'){
      await fs.cp(path.join(root,'functions'),path.join(base,'functions'),{recursive:true});
    }else{
      const workerPath=names.find(p=>/functionsWorker-.*\.js$/.test(p));
      const routesPath=names.find(p=>/_routes-.*\.json$/.test(p));
      assert.ok(workerPath&&routesPath,'Complete existing Functions bundle and routes required');
      const worker=await fs.readFile(path.join(assets,workerPath.slice(1)));
      assert.ok(worker.toString().includes('pages_template_worker_default'),'Unexpected recovered worker');
      assert.ok(!/sk_live_[A-Za-z0-9]{10}|whsec_[A-Za-z0-9]{10}/.test(worker.toString()),'Possible embedded secret; stop');
      record.projects[name].preservedWorkerSha256=createHash('sha256').update(worker).digest('hex');
      await fs.writeFile(path.join(assets,'_worker.js'),worker);
      await fs.copyFile(path.join(assets,routesPath.slice(1)),path.join(assets,'_routes.json'));
      for(const page of ['success.html','deliverable.html'])await fs.copyFile(path.join(root,'sites/promptpack/overrides',page),path.join(assets,page));
    }
    await save();
  }
  console.log(JSON.stringify({prepared:releaseDir,commit,projects:Object.keys(record.projects)}));
  process.exit();
}
record=JSON.parse(await fs.readFile(recordFile,'utf8'));assert.equal(record.commit,commit);
const cli=async(args,cwd)=>new Promise((resolve,reject)=>{
  const child=spawn(process.env.ComSpec||'cmd.exe',['/d','/s','/c','npx --yes wrangler@4.146.0 '+args.join(' ')],{cwd,windowsHide:true,env:{...process.env,CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_EMAIL:headers['X-Auth-Email'],CLOUDFLARE_API_KEY:headers['X-Auth-Key'],WRANGLER_SEND_METRICS:'false',CI:'true'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{output+=b;});
  child.on('error',reject);child.on('close',code=>code===0?resolve(output):reject(Error('Wrangler failed; inspect private CLI output: '+output.slice(-1500))));
});
if(action==='production'){
  for(const p of Object.values(record.projects))assert.equal(p.previewVerified,true,'Verified previews required');
  // Apply exactly one additive migration; never apply the pending migration
  // backlog or modify existing order/customer rows.
  if(!record.migrationApplied){
    const project=await api('/pages/projects/mehyar-web');
    const id=project.deployment_configs.production.d1_databases.LEADS_DB.id;
    assert.equal(id,'e4f22065-e3e8-4772-87a8-51d4976be042');
    await api(`/d1/database/${id}/query`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sql:await fs.readFile(path.join(root,'migrations/0033_promptpack_email_delivery.sql'),'utf8')})});
    record.migrationApplied=true;await save();
  }
}
for(const name of ['mehyar-web','promptpack']){
  const state=record.projects[name];
  const existingId=state[action+'Id'];
  assert.ok(!state[action+'Intent']||existingId,'Prior uncertain attempt exists; reconcile it before repeating any deployment');
  const current=await api(`/pages/projects/${name}`);
  assert.equal(current.canonical_deployment.id,state.previousId,'Production changed concurrently; stop');
  const branch=action==='production'?'main':'codex-promptpack-readiness';
  if(!existingId&&name==='mehyar-web'){
    await cli(['pages','functions','build','functions','--outfile','worker.bundle','--output-routes-path','worker-routes.json','--compatibility-date',state.compatibilityDate],path.join(releaseDir,name));
  }
  if(!existingId){
  state[action+'Intent']=new Date().toISOString();await save();
  if(name==='mehyar-web'||action==='production'){
    // Route rewrites prevent recovering three original HTML assets via HTTP.
    // Reuse their exact original manifest hashes; the existing asset store
    // already contains them. Upload Wrangler's real multipart Worker bundle,
    // not the legacy ZIP format that can silently omit Functions.
    const form=new FormData();
    form.append('manifest',JSON.stringify(name==='promptpack'?{...state.previousFiles,...state.previewFiles}:state.previousFiles));
    form.append('branch',branch);form.append('commit_hash',commit);
    form.append('commit_dirty','false');form.append('commit_message','PromptPack-readiness');
    if(name==='mehyar-web'){
      form.append('_worker.bundle',new Blob([await fs.readFile(path.join(releaseDir,name,'worker.bundle'))]),'_worker.bundle');
      form.append('_routes.json',new Blob([await fs.readFile(path.join(releaseDir,name,'worker-routes.json'))]),'_routes.json');
    }else{
      const bundle=new FormData();
      bundle.append('metadata',JSON.stringify({main_module:'promptpack-worker.js'}));
      bundle.append('promptpack-worker.js',new Blob([await fs.readFile(path.join(releaseDir,name,'public/_worker.js'))],{type:'application/javascript+module'}),'promptpack-worker.js');
      form.append('_worker.bundle',await new Response(bundle).blob(),'_worker.bundle');
      form.append('_routes.json',new Blob([await fs.readFile(path.join(releaseDir,name,'public/_routes.json'))]),'_routes.json');
    }
    for(const file of name==='mehyar-web'?['_headers','_redirects']:[]){
      const contents=await fs.readFile(path.join(root,'client/public',file));
      form.append(file,new Blob([contents]),file);
    }
    const result=await api(`/pages/projects/${name}/deployments`,{method:'POST',body:form});
    state[action+'Id']=result.id;state[action+'Url']=result.url;await save();
  }else{
    await cli(['pages','deploy','public','--project-name='+name,'--branch='+branch,'--commit-hash='+commit,'--commit-dirty=false','--commit-message=PromptPack-readiness'],path.join(releaseDir,name));
  }
  }
  const deployments=await api(`/pages/projects/${name}/deployments?per_page=10`);
  const match=existingId?{id:existingId}:deployments.find(d=>d.deployment_trigger?.metadata?.commit_hash===commit&&d.deployment_trigger?.metadata?.branch===branch);
  assert.ok(match,'Deployment response must be reconciled; never retry blindly');
  let deployed=await api(`/pages/projects/${name}/deployments/${match.id}`);
  state[action+'Id']=deployed.id;state[action+'Url']=deployed.url;await save();
  for(let attempts=0;deployed.latest_stage?.name!=='deploy'||deployed.latest_stage?.status!=='success';attempts++){
    assert.ok(attempts<24&&deployed.latest_stage?.status!=='failure','Deployment not successful; inspect its saved ID before retrying');
    await new Promise(resolve=>setTimeout(resolve,2000));
    deployed=await api(`/pages/projects/${name}/deployments/${match.id}`);
  }
  assert.ok(deployed.uses_functions,'Functions missing; do not promote');
  const allowedChanges=name==='promptpack'?new Set(['/success.html','/deliverable.html']):new Set();
  // Wrangler excludes its own temporary build directory from preview asset
  // uploads. Production merges the original manifest back in so those four
  // existing public files remain unchanged as well.
  const previewExcluded=action==='preview'&&name==='promptpack'?Object.keys(state.previousFiles).filter(file=>file.startsWith('/.wrangler/tmp/')):[];
  const drift=Object.entries(state.previousFiles).filter(([file,hash])=>!allowedChanges.has(file)&&!previewExcluded.includes(file)&&deployed.files[file]!==hash).map(([file])=>file);
  state[action+'AssetDrift']=drift;await save();assert.deepEqual(drift,[],'Existing asset hashes changed; stop');
  if(action==='preview'){state.previewVerified=true;state.previewFiles=deployed.files;state.previewExcludedBuildArtifacts=previewExcluded;await save();}
  console.log(JSON.stringify({project:name,stage:action,deploymentId:deployed.id,url:deployed.url,usesFunctions:deployed.uses_functions,preservedFiles:Object.keys(state.previousFiles).length-allowedChanges.size,assetDrift:drift,rollbackId:state.previousId}));
}
console.log(JSON.stringify({journal:recordFile,commit}));
