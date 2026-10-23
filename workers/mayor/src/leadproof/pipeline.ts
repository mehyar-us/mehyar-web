import {HttpError} from '../http';
import type {Env} from '../env';
import {LEADPROOF_PACK_LEAD_TARGET,LEADPROOF_PACK_MIN_LEADS} from '../billing/plans';
const nowISO=()=>new Date().toISOString();

/* LeadProof pipeline (integration spec §4.3/§4.4): Harvey's results
 * land through the token-gated job contract and are finished IN THE
 * WORKER — Harvey never drafts (§5.4: its drafting half never ran).
 * The evidence gate is mechanical and runs before any drafting: a
 * company with no observation is dropped, and a company whose source
 * does not resolve to the business (its own site, or the OpenStreetMap
 * node it was discovered on) is dropped. Drafting (Workers AI, the
 * house audit-drafting model class) writes why_now + first_line FROM
 * THE EVIDENCE ONLY; the citation check requires the draft to name an
 * observation that exists in the lead's evidence — a draft citing a
 * fact not in evidence regenerates ONCE, then the lead ships WITHOUT
 * a first line (spec §4.3) rather than shipping an unverified one.
 * Fewer than the guaranteed minimum admitted → the pack fails in the
 * open and the credit restores automatically (§4.4). Cost is metered
 * per pack (the §8.6-pattern internal meter on the pack row). */
export const LEADPROOF_DRAFT_MODEL='@cf/moonshotai/kimi-k2.6';
export interface RunnerObservation{ text:string; sourceUrl?:string; observedAt?:string }
export interface RunnerCompany{ name:string; website?:string; phone?:string; contactName?:string; sourceUrl:string; score?:number; observations:RunnerObservation[] }
export interface RunnerResults{ companies:RunnerCompany[] }
export interface DraftResult{ whyNow:string; firstLine:string|null; observationId:string }
export type Drafter=(input:{company:string;icpText:string;observations:Array<{id:string;text:string}>})=>Promise<DraftResult|null>;

interface PackRow{id:string;tenant_id:string;status:string;icp_text:string;icp_params_json:string;created_at:string;drafting_calls:number}

function hostOf(url:string):string|null{try{return new URL(url).hostname.replace(/^www\./,'');}catch{return null;}}
/* The §10 automated pre-check, mechanical half: a lead's source must
 * resolve to the business — its own website's host, or the OSM node
 * page it was discovered on (Harvey's discovery provenance). */
export function sourceResolvesToBusiness(company:RunnerCompany):boolean{
 const sourceHost=hostOf(company.sourceUrl);if(!sourceHost)return false;
 if(sourceHost.endsWith('openstreetmap.org'))return true;
 const siteHost=company.website?hostOf(company.website):null;
 return !!siteHost&&sourceHost===siteHost;
}
export interface AdmittedLead{company:RunnerCompany;observations:RunnerObservation[];dropped?:never}
export interface DroppedLead{company:RunnerCompany;reason:'no_observation'|'source_unresolved'}
export function evidenceGate(companies:RunnerCompany[]):{admitted:AdmittedLead[];dropped:DroppedLead[]}{
 const admitted:AdmittedLead[]=[],dropped:DroppedLead[]=[];
 for(const company of companies){
  if(!Array.isArray(company.observations)||company.observations.length===0){dropped.push({company,reason:'no_observation'});continue;}
  if(!sourceResolvesToBusiness(company)){dropped.push({company,reason:'source_unresolved'});continue;}
  admitted.push({company,observations:company.observations});
 }
 return {admitted,dropped};
}
const STOP=new Set(['the','a','an','of','in','on','at','to','and','for','with','their','its','is','are','was','were','has','have','had','this','that','it']);
function contentTokens(text:string):Set<string>{return new Set(text.toLowerCase().replace(/[^a-z0-9 ]+/g,' ').split(/\s+/).filter(word=>word.length>=5&&!STOP.has(word)));}
export function draftCitesEvidence(draft:DraftResult,observations:Array<{id:string;text:string}>):boolean{
 const cited=observations.find(item=>item.id===draft.observationId);if(!cited)return false;
 const evidence=contentTokens(cited.text);if(evidence.size===0)return false;
 const drafted=contentTokens(`${draft.whyNow} ${draft.firstLine??''}`);
 for(const token of drafted)if(evidence.has(token))return true;
 return false;
}
async function workersAiDrafter(env:Env):Promise<Drafter>{
 return async input=>{
  const ai=env.AI as unknown as {run:(model:string,options:Record<string,unknown>)=>Promise<{response?:string}|string>};
  const prompt=`You write ONE short, true opener for a local business outreach note. Use ONLY the evidence below — every claim in your answer must come from it. Never invent awards, dates, ratings, or facts.\nBusiness: ${input.company}\nWho the buyer sells to: ${input.icpText}\nEvidence (each line starts with its id):\n${input.observations.map(item=>`[${item.id}] ${item.text}`).join('\n')}\nReply with JSON only: {"observationId":"<the id of the single observation you used>","whyNow":"<one sentence: why this business fits right now, from that observation>","firstLine":"<one friendly opening sentence that mentions the observed fact>"}`;
  const out=await ai.run(LEADPROOF_DRAFT_MODEL,{messages:[{role:'user',content:prompt}],max_tokens:300});
  const text=typeof out==='string'?out:(out.response??'');
  const parsed=JSON.parse(text.slice(text.indexOf('{'),text.lastIndexOf('}')+1)) as Partial<DraftResult>;
  if(typeof parsed.whyNow!=='string'||!parsed.whyNow.trim()||typeof parsed.observationId!=='string')return null;
  return {whyNow:parsed.whyNow.trim(),firstLine:typeof parsed.firstLine==='string'&&parsed.firstLine.trim()?parsed.firstLine.trim():null,observationId:parsed.observationId};
 };
}
async function restoreCreditAndFail(env:Env,pack:PackRow,reason:string,extra:Record<string,unknown>):Promise<Record<string,unknown>>{
 const now=nowISO();
 await env.AGENT_DB.batch([
  env.AGENT_DB.prepare("UPDATE mayor_leadproof_pack_credits SET consumed_by_pack_id=NULL WHERE consumed_by_pack_id=?").bind(pack.id),
  env.AGENT_DB.prepare("UPDATE mayor_leadproof_packs SET status='failed',shortfall_reason=?,updated_at=? WHERE id=?").bind(reason,now,pack.id),
 ]);
 return {packId:pack.id,status:'failed',shortfallReason:reason,...extra};
}
export async function applyRunnerResults(env:Env,packId:string,results:RunnerResults,injectedDrafter?:Drafter):Promise<Record<string,unknown>>{
 const pack=await env.AGENT_DB.prepare('SELECT * FROM mayor_leadproof_packs WHERE id=?').bind(packId).first<PackRow>();
 if(!pack)throw new HttpError(404,'leadproof_pack_not_found','That pack does not exist.');
 /* Idempotent by job id: a pack that already finished takes no second
  * application — the runner can safely retry its POST. */
 if(pack.status==='ready'||pack.status==='exported'||pack.status==='failed')
  return {packId,status:pack.status,idempotent:true};
 if(!['queued','discovering','profiling','drafting'].includes(pack.status))
  throw new HttpError(409,'leadproof_pack_state','That pack is not awaiting results.');
 const companies=Array.isArray(results?.companies)?results.companies:[];
 const {admitted,dropped}=evidenceGate(companies);
 const now=nowISO();
 await env.AGENT_DB.prepare("UPDATE mayor_leadproof_packs SET status='drafting',updated_at=? WHERE id=?").bind(now,packId).run();
 if(admitted.length<LEADPROOF_PACK_MIN_LEADS){
  return restoreCreditAndFail(env,pack,'shortfall_evidence_gate',{admitted:admitted.length,dropped:dropped.map(item=>({name:item.company.name,reason:item.reason}))});
 }
 const drafter=injectedDrafter??await workersAiDrafter(env);
 const chosen=admitted.slice(0,LEADPROOF_PACK_LEAD_TARGET);
 let draftingCalls=pack.drafting_calls??0;
 const statements:D1PreparedStatement[]=[];
 for(const lead of chosen){
  const evidence=lead.observations.map((observation,index)=>({id:`obs-${index+1}`,text:observation.text,sourceUrl:observation.sourceUrl??lead.company.sourceUrl,observedAt:observation.observedAt??null}));
  let draft=await drafter({company:lead.company.name,icpText:pack.icp_text,observations:evidence.map(({id,text})=>({id,text}))});draftingCalls++;
  if(!draft||!draftCitesEvidence(draft,evidence)){draft=await drafter({company:lead.company.name,icpText:pack.icp_text,observations:evidence.map(({id,text})=>({id,text}))});draftingCalls++;}
  const verified=draft&&draftCitesEvidence(draft,evidence)?draft:null;
  const cited=verified?evidence.find(item=>item.id===verified.observationId)??evidence[0]:evidence[0];
  statements.push(env.AGENT_DB.prepare(`INSERT INTO mayor_leadproof_leads(id,pack_id,tenant_id,company_name,website,phone,contact_name,source_url,evidence_json,why_now,first_line,score,created_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(pack_id,source_url) DO NOTHING`).bind(
   crypto.randomUUID(),packId,pack.tenant_id,lead.company.name,lead.company.website??null,lead.company.phone??null,lead.company.contactName??null,lead.company.sourceUrl,
   JSON.stringify(evidence),verified?verified.whyNow:cited.text,verified?verified.firstLine:null,typeof lead.company.score==='number'?lead.company.score:null,now));
 }
 statements.push(env.AGENT_DB.prepare("UPDATE mayor_leadproof_packs SET status='ready',lead_count=?,ready_at=?,drafting_calls=?,updated_at=? WHERE id=?").bind(chosen.length,now,draftingCalls,now,packId));
 await env.AGENT_DB.batch(statements);
 return {packId,status:'ready',leadCount:chosen.length,dropped:dropped.map(item=>({name:item.company.name,reason:item.reason}))};
}
export async function failPackFromRunner(env:Env,packId:string,reason:string):Promise<Record<string,unknown>>{
 const pack=await env.AGENT_DB.prepare('SELECT * FROM mayor_leadproof_packs WHERE id=?').bind(packId).first<PackRow>();
 if(!pack)throw new HttpError(404,'leadproof_pack_not_found','That pack does not exist.');
 if(pack.status==='ready'||pack.status==='exported'||pack.status==='failed')return {packId,status:pack.status,idempotent:true};
 return restoreCreditAndFail(env,pack,`runner:${reason}`.slice(0,200),{});
}
/* The 24-hour promise (§4.3): a pack not ready within 24 hours fails
 * in the open and the credit restores — the cron leg sweeps it. */
export async function sweepLeadProofTimeouts(env:Env,nowMs=Date.now()):Promise<{timedOut:number}>{
 const cutoff=new Date(nowMs-24*3600_000).toISOString();
 const stale=await env.AGENT_DB.prepare("SELECT * FROM mayor_leadproof_packs WHERE status IN ('queued','discovering','profiling','drafting') AND created_at<?").bind(cutoff).all<PackRow>();
 let timedOut=0;
 for(const pack of stale.results){await restoreCreditAndFail(env,pack,'timeout_24h',{});timedOut++;}
 return {timedOut};
}
