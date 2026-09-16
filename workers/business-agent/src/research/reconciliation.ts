import {HttpError} from '../http';
import type {CloudflareCrawl} from './cloudflare-crawl';
import type {ResearchJobs} from './jobs';

/** Accounting-only reconciliation of recorded stops. The gate binds the owning
 * business and provider; it must not require permission to import new evidence. */
export class ResearchReconciliation {
  constructor(private jobs:ResearchJobs,private provider:Pick<CloudflareCrawl,'results'>,private gate:(id:string)=>Promise<void>){}
  async poll(id:string){
    await this.gate(id);
    const job=this.jobs.get(id);
    if(['completed','failed','cancelled'].includes(job.status))return job;
    if(job.status!=='cancel_requested'||!job.provider_id)throw new HttpError(409,'research_reconcile_not_ready','Only known stopped research can be reconciled.');
    const lease=this.jobs.claimPoll(id);
    try{
      const checkpoint=this.jobs.checkpoint(id);
      if(checkpoint.done){const result=this.jobs.finish(id);this.jobs.finishPoll(id,lease,true,0);return result;}
      const result=await this.provider.results(job.provider_id,job.source,checkpoint.steps?checkpoint.cursor:undefined);
      await this.gate(id);this.jobs.assertPoll(id,lease);
      if(result.id!==job.provider_id)throw new HttpError(502,'research_provider_mismatch','The provider returned a different job.');
      this.jobs.observeProviderUsage(id,job.provider_id,result.browserSecondsUsed,result.status!=='running');
      if(result.status==='running'){
        if(checkpoint.steps)throw new HttpError(502,'research_snapshot_changed','The provider completion snapshot changed.');
      }else{
        if(result.records.length>1||result.records.some(record=>record.status==='queued'))throw new HttpError(502,'research_incomplete_snapshot','The provider did not return a bounded terminal snapshot.');
        for(const record of result.records)if(record.status==='completed')this.jobs.accountStoppedPage(id,job.provider_id,record);
        const next=this.jobs.advance(id,checkpoint.cursor,result.status,result.cursor);
        if(next.done)this.jobs.finish(id);
      }
      this.jobs.finishPoll(id,lease,true,this.jobs.checkpoint(id).steps?1000:30_000);
      return this.jobs.get(id);
    }catch(error){this.jobs.finishPoll(id,lease,false,0);throw error;}
  }
}
