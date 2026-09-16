import {getPlan,TRIAL} from '../catalog';
import {textAccess} from '../billing/text-access';
import type {Actor,Env} from '../env';
import {HttpError} from '../http';
import {OPERATORS,requireMembership,requireTenant} from '../permissions';
import {requireVerifiedGates} from '../billing/service';
import type {ResearchJobs} from './jobs';

/** For a tenant-bound scheduler: never take a replacement actor from its payload. */
export async function researchJobAccess(env:Env,tenantId:string,jobs:ResearchJobs,id:string,paused:()=>boolean){
  const actor=jobs.requester(id);
  if(!actor)throw new HttpError(409,'research_requester_missing','Research needs review because its original requester is unavailable.');
  if(actor.tenantId!==tenantId)throw new HttpError(404,'research_job_missing','Research job not found.');
  await requireResearchReady(env);
  return researchAccess(env,actor,paused);
}

export const RESEARCH_GATES=['network_safety','crawl_permissions','supplier_cost_controls','provider_acceptance','scheduler_recovery'] as const;
export async function requireResearchReady(env:Env){
  if(env.RESEARCH_ENABLED!=='true')throw new HttpError(503,'research_disabled','Website research is not enabled yet. You can add business knowledge manually.');
  try{await requireVerifiedGates(env,'research:crawl',RESEARCH_GATES);}
  catch(error){if(error instanceof HttpError)throw new HttpError(409,'research_not_ready','Website research checks are incomplete. No crawl was started.');throw error;}
}

/** Server-owned allowance derivation, not authorization to contact a website.
 * Network readiness and supplier-cost reservations are additional dispatch gates. */
export async function researchAccess(env:Env,actor:Actor,paused:()=>boolean){
  const tenant=await requireTenant(env,actor);await requireMembership(env,actor,OPERATORS);
  const checkPause=()=>{if(paused())throw new HttpError(409,'agent_paused','Resume your agent before starting website research.');};
  checkPause();
  if(tenant.plan_id==='trial'){
    if(tenant.status!=='trial'||!Number.isFinite(Date.parse(tenant.trial_expires_at))||Date.parse(tenant.trial_expires_at)<=Date.now())
      throw new HttpError(403,'research_trial_unavailable','The website research trial is unavailable.');
    return {period:'trial',allowance:TRIAL.crawlPages,maxJobs:1,resetsAt:null};
  }
  // Share verified subscription/activation gates and anniversary semantics with paid chat.
  const access=await textAccess(env,actor,tenant),plan=getPlan(tenant.plan_id);
  if(!plan)throw new HttpError(403,'research_plan_unavailable','Website research requires an eligible plan.');
  await requireMembership(env,actor,OPERATORS);checkPause();
  return {period:access.period,allowance:plan.allowances.crawlPages,maxJobs:undefined,resetsAt:access.resetsAt??null};
}
