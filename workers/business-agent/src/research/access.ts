import {getPlan,TRIAL} from '../catalog';
import {textAccess} from '../billing/text-access';
import type {Actor,Env} from '../env';
import {HttpError} from '../http';
import {OPERATORS,requireMembership,requireTenant} from '../permissions';

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
