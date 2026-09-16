import {HttpError} from '../http';
import type {CloudflareCrawl} from './cloudflare-crawl';
import type {ResearchJobs} from './jobs';
import {ResearchRunner} from './runner';
import {ResearchCancellation} from './cancellation';
import {ResearchReconciliation} from './reconciliation';
import {ResearchScheduler} from './scheduler';

/** Composes job-specific gates with immutable provider routing. The caller must
 * supply the actual owning Agent identity, never a tenant from a scheduled payload. */
export function routedResearchScheduler(jobs:ResearchJobs,tenantId:string,
  provider:Pick<CloudflareCrawl,'accountId'|'start'|'results'|'cancel'>,
  execute:(id:string)=>Promise<void>,recover:(id:string)=>Promise<void>){
  const accountId=provider.accountId;
  function check(id:string,allowBinding:boolean){
    const actor=jobs.requester(id);
    if(!actor||actor.tenantId!==tenantId)throw new HttpError(409,'research_routing_unverified','Research ownership needs verification before provider access.');
    if(provider.accountId!==accountId)throw new HttpError(409,'research_routing_changed','Research provider configuration changed during execution.');
    if(allowBinding&&jobs.get(id).status==='reserved')jobs.bindProviderAccount(id,accountId);
    if(jobs.providerAccount(id)!==accountId)throw new HttpError(409,'research_routing_unverified','Research provider routing needs verification.');
  }
  return new ResearchScheduler(jobs,
    id=>new ResearchRunner(jobs,provider,async()=>{await execute(id);check(id,true);}),
    id=>new ResearchCancellation(jobs,provider,async()=>{await recover(id);check(id,false);}),
    id=>new ResearchReconciliation(jobs,provider,async()=>{await recover(id);check(id,false);}));
}
