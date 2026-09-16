import {HttpError} from '../http';
import type {CloudflareCrawl} from './cloudflare-crawl';
import type {ResearchJobs} from './jobs';

/** Internal stop-only capability. Its gate checks the owning tenant/object and
 * provider configuration, not a subscription or the original requester's access.
 * It cannot create cancellation intent, fetch evidence or start provider work. */
export class ResearchCancellation {
  constructor(private jobs:ResearchJobs,private provider:Pick<CloudflareCrawl,'cancel'>,
    private gate:(id:string)=>Promise<void>){}

  async deliver(id:string){
    await this.gate(id);
    const job=this.jobs.get(id);
    if(['completed','failed','cancelled'].includes(job.status))return job;
    if(job.status!=='cancel_requested'||!job.provider_id)
      throw new HttpError(409,'research_stop_not_ready','Research needs a recorded stop request and a known provider job.');
    const lease=this.jobs.claimStop(id);
    if(!lease)return this.jobs.get(id);
    try{
      const response=await this.provider.cancel(job.provider_id);
      if(response.requested!==true)throw new HttpError(502,'research_stop_unconfirmed','The provider did not acknowledge the stop request.');
      this.jobs.finishStop(id,lease,true);
    }catch(error){this.jobs.finishStop(id,lease,false);throw error;}
    // DELETE acceptance is not terminal evidence and cannot release reservations.
    return this.jobs.get(id);
  }
}
