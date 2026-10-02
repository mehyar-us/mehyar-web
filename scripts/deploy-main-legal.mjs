import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';import {fileURLToPath,pathToFileURL} from 'node:url';
export const baseline='22cdfb0c-a027-4af7-954e-281b73b211ab',asset='/assets/main-4iNuTZT1.js';
export const originalSha='c863db6a6ecfb05150c154d7f5e52e78e084b656733c0ee2b72f2836ce22c58a',patchedSha='e526e9432420451a13b402ac1d92837265ba4de1dbca4d9c968a66d29234130a';
const sha=b=>createHash('sha256').update(b).digest('hex');
export function manifestDiff(before,after){assert.deepEqual(Object.keys(before).sort(),Object.keys(after).sort());const diff=Object.keys(before).filter(k=>before[k]!==after[k]);assert.deepEqual(diff,[asset]);return diff;}
export function checkBaseline(project,dep){assert.equal(project.name,'mehyar-web');assert.equal(project.canonical_deployment.id,baseline);assert.equal(dep.id,baseline);assert.equal(dep.uses_functions,true);assert.equal(dep.latest_stage?.status,'success');assert.equal(Object.keys(dep.files).length,154);assert.equal(dep.files[asset],'a6ed5b80a5c6a0300d994ff81361b5ae');}
export function allowRequest(endpoint,method,account,mode){
 const prefix=`/accounts/${account}/pages/projects/mehyar-web`;
 if(method==='GET'&&(endpoint===prefix||endpoint===prefix+'/deployments/'+baseline||endpoint===prefix+'/upload-token'||new RegExp('^'+prefix+'/deployments/[a-f0-9-]{36}$').test(endpoint)))return;
 if(mode==='publish'&&method==='POST'&&[prefix+'/deployments','/pages/assets/check-missing','/pages/assets/upload'].includes(endpoint))return;
 throw Error('Request outside exact main legal release scope');
}
export function verifyUpload(payload,hash,content){assert.equal(payload.length,1);assert.deepEqual(payload[0],{key:hash,value:content.toString('base64'),metadata:{contentType:'application/javascript'},base64:true});}
export function assetHash(content,blake3){return blake3(content.toString('base64')+'js').toString('hex').slice(0,32);}
// Cloudflare primary implementation: https://github.com/cloudflare/workers-sdk/blob/main/packages/deploy-helpers/src/deploy/helpers/hash.ts
// Upload protocol: packages/wrangler/src/pages/upload.ts. No package install.
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [mode,expected]=process.argv.slice(2);assert.ok(['dry-run','publish'].includes(mode));assert.equal(expected,baseline);
 const root=fileURLToPath(new URL('../',import.meta.url)),git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();assert.equal(git(['status','--porcelain']),'','Clean isolated committed release required');
 const commit=git(['rev-parse','HEAD']),branch=git(['branch','--show-current']);assert.equal(branch,'codex/main-legal-routing-2026-10-02');
 const changed=git(['diff','--name-only','0b7eafc6f353f5296e2445b3193bafce71e393d4',commit]).split(/\r?\n/);
 const allowed=new Set(['client/src/App.tsx','scripts/deploy-main-legal.mjs','scripts/test-main-legal-mutation.mjs','sites/main-legal/main-4iNuTZT1.js']);assert.equal(changed.length,4);assert.ok(changed.every(x=>allowed.has(x)));
 if(mode==='publish')assert.equal(git(['rev-parse','origin/'+branch]),commit,'Commit must be pushed first');
 const account=process.env.CF_ACCOUNT_ID,auth={'X-Auth-Email':process.env.CF_API_EMAIL,'X-Auth-Key':process.env.CF_API_KEY};assert.ok(account&&auth['X-Auth-Key']&&auth['X-Auth-Email']);
 const api=async(endpoint,method='GET',body,extra={})=>{allowRequest(endpoint,method,account,mode);const r=await fetch('https://api.cloudflare.com/client/v4'+endpoint,{method,headers:{...auth,...extra},body,signal:AbortSignal.timeout(30000)});const j=await r.json();assert.ok(r.ok&&j.success,'Cloudflare request failed; no automatic retry');return j.result;};
 const prefix=`/accounts/${account}/pages/projects/mehyar-web`,project=await api(prefix),dep=await api(prefix+'/deployments/'+baseline);checkBaseline(project,dep);
 const recovered=path.join(os.tmpdir(),'promptpack-release-0b7eafc6f353'),journal=JSON.parse(await fs.readFile(path.join(recovered,'release.json'),'utf8'));assert.equal(journal.projects['mehyar-web'].productionId,baseline);
 const worker=await fs.readFile(path.join(recovered,'mehyar-web/worker.bundle')),routes=await fs.readFile(path.join(recovered,'mehyar-web/worker-routes.json'));assert.equal(sha(worker),'6ff2b03244f4236ca327d90fceca790409396bd3e065ed5ca1513e0aa1725eb8');assert.equal(sha(routes),'a110afa930d69171616e100e830fab2ef4c67dc731006ff48184e26a0876c75c');
 const original=Buffer.from(await(await fetch(dep.url+asset)).arrayBuffer()),content=await fs.readFile(path.join(root,'sites/main-legal/main-4iNuTZT1.js'));assert.equal(sha(original),originalSha);assert.equal(sha(content),patchedSha);
 const require=createRequire(import.meta.url);assert.ok(process.env.PAGES_BLAKE3_MODULE,'Existing cached BLAKE3 module path required');const {hash:blake3}=require(process.env.PAGES_BLAKE3_MODULE);assert.equal(assetHash(original,blake3),dep.files[asset],'Hash implementation must match deployed baseline');const hash=assetHash(content,blake3),manifest={...dep.files,[asset]:hash};manifestDiff(dep.files,manifest);
 const report={commit,branch,mode,baseline,rollbackTarget:baseline,newAssetHash:hash,changedAssets:[asset],unchangedAssets:153,functionsSha256:sha(worker),routesSha256:sha(routes),migrations:0,secretsChanges:0};
 if(mode==='dry-run'){console.log(JSON.stringify(report));process.exit();}
 const receipt=path.join(os.tmpdir(),'main-legal-release-'+commit.slice(0,12)+'.json');try{await fs.access(receipt);throw Error('Existing publication journal: inspect outcome; never retry blindly');}catch(e){if(e.code!=='ENOENT')throw e;}
 checkBaseline(await api(prefix),dep); // Before first remote mutation.
 const {jwt}=await api(prefix+'/upload-token');assert.ok(jwt);
 const missing=await api('/pages/assets/check-missing','POST',JSON.stringify({hashes:[hash]}),{'Content-Type':'application/json',Authorization:'Bearer '+jwt});assert.ok(Array.isArray(missing)&&missing.every(x=>x===hash));
 if(missing.length){const payload=[{key:hash,value:content.toString('base64'),metadata:{contentType:'application/javascript'},base64:true}];verifyUpload(payload,hash,content);await api('/pages/assets/upload','POST',JSON.stringify(payload),{'Content-Type':'application/json',Authorization:'Bearer '+jwt});}
 const form=new FormData();form.append('manifest',JSON.stringify(manifest));form.append('branch','main');form.append('commit_hash',commit);form.append('commit_dirty','false');form.append('commit_message','Restore existing legal page routing');form.append('_worker.bundle',new Blob([worker]),'_worker.bundle');form.append('_routes.json',new Blob([routes]),'_routes.json');
 for(const name of ['_headers','_redirects']){const old=execFileSync('git',['show','0b7eafc6f353f5296e2445b3193bafce71e393d4:client/public/'+name],{cwd:root});const current=await fs.readFile(path.join(root,'client/public',name));assert.deepEqual(current,old);form.append(name,new Blob([old]),name);}
 checkBaseline(await api(prefix),dep); // Immediately before publication; abort drift.
 await fs.writeFile(receipt,JSON.stringify({...report,status:'publication-intent; unknown until reconciled'},null,2));
 const created=await api(prefix+'/deployments','POST',form);assert.ok(created.id);report.deploymentId=created.id;await fs.writeFile(receipt,JSON.stringify(report,null,2));
 let current;for(let i=0;i<30;i++){current=await api(prefix+'/deployments/'+created.id);if(current.latest_stage?.status==='failure')throw Error('Deployment failed; inspect journal');if(current.latest_stage?.name==='deploy'&&current.latest_stage.status==='success')break;assert.ok(i<29,'Deployment pending; inspect journal');await new Promise(r=>setTimeout(r,2000));}
 assert.equal(current.uses_functions,true);assert.deepEqual(current.files,manifest);assert.equal((await api(prefix)).canonical_deployment.id,created.id);report.status='deployed-verified-manifest';report.url=current.url;await fs.writeFile(receipt,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,journal:receipt}));
}
