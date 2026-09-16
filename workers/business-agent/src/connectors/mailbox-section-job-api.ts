import {z} from 'zod';
import {unwrap,type BusinessAgent} from '../agent';
import type {Actor} from '../env';
import {HttpError,json,readJson} from '../http';
type Agent=Pick<BusinessAgent,'startMailboxSectionJob'|'mailboxSectionJob'|'mailboxSectionJobs'|'cancelMailboxSectionJob'>;
/** Session, origin, tenant and operator checks are required at the Worker entry. */
export async function mailboxSectionJobRequest(request:Request,section:string,actor:Actor,agent:Agent){
  if(section==='mailbox-analysis/section-jobs'){
    if(request.method==='GET'){
      const query=new URL(request.url).searchParams,view=z.enum(['all','active']).parse(query.get('view')??'all');
      return json(unwrap(await agent.mailboxSectionJobs(actor,query.get('after')??undefined,view)));
    }
    if(request.method==='POST'){
      const input=z.object({offerId:z.string().uuid(),backgroundApproval:z.object({version:z.literal(1),maximumHours:z.literal(24),includesAggregation:z.literal(false)}).strict()}).strict().parse(await readJson(request,1024));
      return json(unwrap(await agent.startMailboxSectionJob(actor,input.offerId)),202);
    }
  }
  const match=section.match(/^mailbox-analysis\/section-jobs\/([a-f0-9-]{36})(\/cancel)?$/);
  if(match&&z.string().uuid().safeParse(match[1]).success){
    if(!match[2]&&request.method==='GET')return json(unwrap(await agent.mailboxSectionJob(actor,match[1])));
    if(match[2]&&request.method==='POST'){
      z.object({}).strict().parse(await readJson(request,1024));
      return json(unwrap(await agent.cancelMailboxSectionJob(actor,match[1])));
    }
  }
  throw new HttpError(404,'not_found','This address is not available.');
}
