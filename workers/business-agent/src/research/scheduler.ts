import {HttpError} from '../http';
import type {ResearchJobs} from './jobs';
import type {ResearchRunner} from './runner';
import type {ResearchCancellation} from './cancellation';

/** One bounded internal scheduling pass. Factories must bind authorization to the
 * supplied job and owning business; selection is never permission to execute.
 * The deployment scheduler and verified provider configuration are separate. */
export class ResearchScheduler {
  constructor(private jobs:ResearchJobs,
    private runner:(id:string)=>Pick<ResearchRunner,'submit'|'poll'>,
    private stopper:(id:string)=>Pick<ResearchCancellation,'deliver'>){}

  async tick(limit=5){
    const outcomes:{id:string;operation:'submit'|'poll'|'stop';ok:boolean;code?:string}[]=[];
    for(const work of this.jobs.dueWork(limit)){
      // Persist rotation before awaiting a provider, including denied/failed jobs.
      // The operation itself still claims its durable dispatch/poll/stop lease.
      this.jobs.visitedWork(work.id);
      try{
        if(work.operation==='stop')await this.stopper(work.id).deliver(work.id);
        else await this.runner(work.id)[work.operation](work.id);
        outcomes.push({id:work.id,operation:work.operation,ok:true});
      }catch(error){
        outcomes.push({id:work.id,operation:work.operation,ok:false,code:error instanceof HttpError?error.code:'research_work_failed'});
      }
    }
    return outcomes;
  }
}
