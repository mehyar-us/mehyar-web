import {z} from 'zod';
import {unwrap,type BusinessAgent} from '../agent';
import type {Actor} from '../env';
import {json,readJson} from '../http';

const source=z.object({streamId:z.string().min(1).max(2048),messageId:z.string().min(1).max(2048),receipt:z.string().uuid()}).strict();
const offer=z.object({offerId:z.string().uuid()}).strict();
type Agent=Pick<BusinessAgent,'reviewMailboxSections'|'confirmMailboxSection'|'reviewMailboxAggregation'|'confirmMailboxAggregation'>;
export const mailboxAnalysisRoutes=new Set(['mailbox-analysis/sections/review','mailbox-analysis/sections/confirm','mailbox-analysis/aggregation/review','mailbox-analysis/aggregation/confirm']);
/** Called only after session, origin, tenant and operator authorization. */
export async function mailboxAnalysisRequest(request:Request,section:string,actor:Actor,agent:Agent){
  if(section.endsWith('/review')){
    const input=source.parse(await readJson(request,8192));
    return json(section==='mailbox-analysis/sections/review'
      ?unwrap(await agent.reviewMailboxSections(actor,input.streamId,input.messageId,input.receipt))
      :unwrap(await agent.reviewMailboxAggregation(actor,input.streamId,input.messageId,input.receipt)));
  }
  if(section==='mailbox-analysis/sections/confirm'){
    const input=offer.extend({sectionIndex:z.number().int().min(0).max(31)}).strict().parse(await readJson(request,1024));
    const result=unwrap(await agent.confirmMailboxSection(actor,input.offerId,input.sectionIndex));
    return json({complete:true,sectionIndex:result.sectionIndex,sectionCount:result.sectionCount,requiresReview:true,authorizesActions:false});
  }
  const input=offer.parse(await readJson(request,1024));
  unwrap(await agent.confirmMailboxAggregation(actor,input.offerId));
  return json({complete:true,availableInMailboxAnalyses:true,requiresReview:true,authorizesActions:false});
}
