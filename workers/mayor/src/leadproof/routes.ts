import {HttpError,json} from '../http';
import {rawBody} from '../billing/stripe';
import type {Actor,Env} from '../env';
const nowISO=()=>new Date().toISOString();
import {getLeadProofPack,listLeadProofPacks} from './packs';
import {applyRunnerResults,failPackFromRunner,type RunnerResults} from './pipeline';
import {renderLeadProofExport} from './export';

/* LeadProof routes (integration spec §4.3/§5.3). Two doors:
 *  - The RUNNER door (Harvey on the Mayor's PC): a dedicated bearer
 *    token (LEADPROOF_RUNNER_TOKEN, its own secret) that can do
 *    exactly three things — list queued jobs (job fields only, never
 *    tenant data beyond the job), post results for a job, report a
 *    job failed. No token configured → the door fails closed (503):
 *    Harvey simply has no contract until the secret lands.
 *  - The OWNER door (signed-in tenant): pack list/get + the export.
 *    EXPORT ONLY — no route here, or anywhere in this domain, sends. */
export interface LeadProofEnv extends Env{LEADPROOF_RUNNER_TOKEN?:string}
function timingSafeEqual(a:string,b:string):boolean{
 if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;
}
function requireRunner(request:Request,env:LeadProofEnv):void{
 const expected=env.LEADPROOF_RUNNER_TOKEN;
 if(!expected)throw new HttpError(503,'leadproof_runner_unconfigured','The LeadProof runner contract is not configured.');
 const presented=request.headers.get('authorization')??'';
 if(!timingSafeEqual(presented,`Bearer ${expected}`))throw new HttpError(401,'leadproof_runner_unauthorized','The runner token did not match.');
}
export async function handleLeadProofRunnerRequest(request:Request,env:LeadProofEnv):Promise<Response|null>{
 const url=new URL(request.url);
 if(url.pathname==='/api/leadproof/jobs'&&request.method==='GET'){
  requireRunner(request,env);
  if((url.searchParams.get('status')??'queued')!=='queued')throw new HttpError(400,'leadproof_jobs_filter','Only the queued job list is available to the runner.');
  const rows=await env.AGENT_DB.prepare("SELECT id,icp_text,icp_params_json,created_at FROM mayor_leadproof_packs WHERE status='queued' ORDER BY created_at LIMIT 20").all<{id:string;icp_text:string;icp_params_json:string;created_at:string}>();
  /* Claiming a job moves it to discovering, so two runner passes never
   * work the same pack twice. */
  if(rows.results.length)await env.AGENT_DB.prepare("UPDATE mayor_leadproof_packs SET status='discovering',updated_at=? WHERE status='queued' AND id IN (SELECT id FROM mayor_leadproof_packs WHERE status='queued' ORDER BY created_at LIMIT 20)").bind(nowISO()).run();
  return json({jobs:rows.results.map(row=>({id:row.id,icpText:row.icp_text,icpParams:JSON.parse(row.icp_params_json),createdAt:row.created_at}))});
 }
 const resultsRoute=url.pathname.match(/^\/api\/leadproof\/jobs\/([a-f0-9-]{36})\/(results|fail)$/);
 if(resultsRoute&&request.method==='POST'){
  requireRunner(request,env);
  const bytes=await rawBody(request);
  let body:Record<string,unknown>={};try{body=JSON.parse(new TextDecoder().decode(bytes)) as Record<string,unknown>;}catch{throw new HttpError(400,'invalid_json','Send a JSON body.');}
  if(resultsRoute[2]==='fail')return json(await failPackFromRunner(env,resultsRoute[1],typeof body.reason==='string'?body.reason:'runner_failed'));
  return json(await applyRunnerResults(env,resultsRoute[1],body as unknown as RunnerResults));
 }
 return null;
}
export async function handleLeadProofOwnerRequest(request:Request,env:Env,actor:Actor):Promise<Response|null>{
 const url=new URL(request.url);
 if(url.pathname==='/api/billing/leadproof/packs'&&request.method==='GET')return json({packs:await listLeadProofPacks(env.AGENT_DB,actor.tenantId)});
 const packRoute=url.pathname.match(/^\/api\/billing\/leadproof\/packs\/([a-f0-9-]{36})$/);
 if(packRoute&&request.method==='GET'){const pack=await getLeadProofPack(env.AGENT_DB,actor.tenantId,packRoute[1]);if(!pack)throw new HttpError(404,'leadproof_pack_not_found','That pack does not exist.');return json({pack});}
 const exportRoute=url.pathname.match(/^\/api\/billing\/leadproof\/packs\/([a-f0-9-]{36})\/export$/);
 if(exportRoute&&request.method==='GET'){
  const format=url.searchParams.get('format')==='json'?'json':'csv';
  const rendered=await renderLeadProofExport(env,actor,exportRoute[1],format);
  return new Response(rendered.body,{headers:{'content-type':rendered.contentType,'content-disposition':`attachment; filename="${rendered.filename}"`,'cache-control':'no-store'}});
 }
 return null;
}
