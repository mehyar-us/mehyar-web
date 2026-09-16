import type {Env} from '../env';
import {HttpError} from '../http';
import {requireVerifiedGates} from '../billing/service';
import {CloudflareCrawl} from './cloudflare-crawl';
import type {ResearchJobs} from './jobs';
import {researchJobAccess} from './access';
import {routedResearchScheduler} from './routing';

export const RECOVERY_GATES=['provider_acceptance','scheduler_recovery'] as const;
/** Server-only composition. tenantId must be the owning Agent's identity. */
export async function runResearchWork(env:Env,tenantId:string,jobs:ResearchJobs,paused:()=>boolean,transport:typeof fetch=fetch){
  if(env.RESEARCH_ENABLED!=='true')jobs.stopActive();
  if(env.RESEARCH_ENABLED!=='true'&&env.RESEARCH_RECOVERY_ENABLED!=='true')return [];
  const provider=new CloudflareCrawl(env.RESEARCH_ACCOUNT_ID??'',env.RESEARCH_API_TOKEN??'',transport);
  return routedResearchScheduler(jobs,tenantId,provider,
    async id=>{
      try{await researchJobAccess(env,tenantId,jobs,id,paused);}
      catch(error){
        if(error instanceof HttpError&&['workspace_not_found','permission_denied','agent_paused','research_trial_unavailable','paid_execution_required','subscription_access_expired','research_plan_unavailable'].includes(error.code))jobs.cancel(id);
        throw error;
      }
    },
    async()=>{
      if(env.RESEARCH_RECOVERY_ENABLED!=='true')throw new HttpError(503,'research_recovery_disabled','Research recovery is not enabled.');
      // Cleanup is permitted after membership loss, pause, expiry or offboarding.
      // The directory row and immutable job/account routing must still exist.
      const tenant=await env.AGENT_DB.prepare('SELECT id FROM agent_tenants WHERE id=?').bind(tenantId).first();
      if(!tenant)throw new HttpError(404,'workspace_not_found','This workspace is not available.');
      await requireVerifiedGates(env,`research:recovery:${provider.accountId}`,RECOVERY_GATES);
    }).tick();
}
