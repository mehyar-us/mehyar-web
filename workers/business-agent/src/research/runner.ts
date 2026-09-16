import {HttpError} from '../http';
import type {CloudflareCrawl} from './cloudflare-crawl';
import {ResearchJobs} from './jobs';

type Provider=Pick<CloudflareCrawl,'start'|'results'|'cancel'>;
/** Internal orchestration only. The gate must recheck current tenant authority,
 * entitlement, pause, quota and network release evidence. No customer route yet. */
export class ResearchRunner {
  constructor(private jobs:ResearchJobs,private provider:Provider,private gate:()=>Promise<void>){}
  async submit(id:string) {
    await this.gate();
    const job=this.jobs.beginFunded(id);
    try {
      const result=await this.provider.start({url:job.source,limit:job.page_limit,depth:job.depth});
      return this.jobs.submitted(id,result.id);
    }catch(error){
      if(this.jobs.get(id).status==='submitting')this.jobs.uncertain(id);
      throw error;
    }
  }
  async poll(id:string) {
    await this.gate();
    const job=this.jobs.get(id);
    if(['completed','failed','cancelled'].includes(job.status))return job;
    const lease=this.jobs.claimPoll(id);
    try{
      const result=await this.pollClaimed(id,lease);
      this.jobs.finishPoll(id,lease,true,this.jobs.checkpoint(id).steps?1000:30_000);
      return result;
    }catch(error){this.jobs.finishPoll(id,lease,false,0);throw error;}
  }
  private async pollClaimed(id:string,lease:string) {
    await this.gate();this.jobs.expire();
    const job=this.jobs.get(id);
    if(['completed','failed','cancelled'].includes(job.status))return job;
    if(!job.provider_id||!['running','cancel_requested'].includes(job.status))
      throw new HttpError(409,'research_not_pollable','Research requires a known provider job before polling.');
    const checkpoint=this.jobs.checkpoint(id);
    if(checkpoint.done)return this.jobs.finish(id);
    const result=await this.provider.results(job.provider_id,job.source,checkpoint.steps?checkpoint.cursor:undefined);
    await this.gate();
    this.jobs.assertPoll(id,lease);
    if(result.id!==job.provider_id)throw new HttpError(502,'research_provider_mismatch','The provider returned a different job.');
    this.jobs.observeProviderUsage(id,job.provider_id,result.browserSecondsUsed,result.status!=='running');
    // Read only stable terminal snapshots; running jobs can change record ordering.
    if(result.status==='running'){
      if(checkpoint.steps)throw new HttpError(502,'research_snapshot_changed','The provider completion snapshot changed.');
      return this.jobs.get(id);
    }
    if(result.records.length>1||result.records.some(record=>record.status==='queued'))
      throw new HttpError(502,'research_incomplete_snapshot','The provider did not return a bounded terminal snapshot.');
    for(const record of result.records)if(record.status==='completed'){
      await this.jobs.ingest(id,job.provider_id,record,new Date().toISOString());
      await this.gate();
    }
    const next=this.jobs.advance(id,checkpoint.cursor,result.status,result.cursor);
    return next.done?this.jobs.finish(id):this.jobs.get(id);
  }
  async cancel(id:string) {
    // Caller uses a withdrawal-specific authorization gate, not a paid-access gate.
    await this.gate();const job=this.jobs.cancel(id);
    if(job.status==='cancel_requested'&&job.provider_id)await this.provider.cancel(job.provider_id);
    return this.jobs.get(id);
  }
}
