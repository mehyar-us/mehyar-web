import {HttpError} from '../http';
import {mailTriageRequest,parseMailTriage,sourceSchema,type MailTriageSource} from './mail-triage';

type Chunk={index:number;start:number;end:number;source:MailTriageSource;request:ReturnType<typeof mailTriageRequest>|null};
/** Plan complete coverage of extracted text, not of omitted MIME/attachments.
 * Every nonempty section uses its own standard credit; whitespace-only sections
 * need no inference. Planning never reserves credit or dispatches a model. */
export function planMailTriageChunks(input:MailTriageSource){
  const source=sourceSchema.parse(input);
  if(source.coverage)throw new HttpError(400,'triage_nested_coverage','Plan sections from the complete extracted message.');
  const text=source.projection.text;
  if(!text.trim())throw new HttpError(422,'triage_no_text','Mailbox text is unavailable for triage.');
  const points=Array.from(text),offsets=[0];
  for(const point of points)offsets.push(offsets[offsets.length-1]+point.length);
  const chunks:Chunk[]=[];
  let point=0;
  while(point<points.length){
    if(chunks.length>=32)throw new HttpError(422,'triage_section_limit','This message needs extended analysis review.');
    const start=offsets[point];
    const candidate=(endPoint:number)=>{
      const end=offsets[endPoint],section=text.slice(start,end);
      if(new TextEncoder().encode(section).length>6000)return null;
      const chunkSource:MailTriageSource={...source,projection:{...source.projection,text:section},coverage:{start,end,total:text.length}};
      if(!section.trim())return {index:chunks.length,start,end,source:chunkSource,request:null};
      try{return {index:chunks.length,start,end,source:chunkSource,request:mailTriageRequest(chunkSource)};}
      catch(error){if(error instanceof HttpError&&error.code==='triage_long_message')return null;throw error;}
    };
    // Serialized request size grows with every code point, including escaping.
    let low=point+1,high=Math.min(points.length,point+6000),best:Chunk|null=null,bestPoint=point;
    while(low<=high){const mid=Math.floor((low+high)/2),value=candidate(mid);if(value){best=value;bestPoint=mid;low=mid+1;}else high=mid-1;}
    if(!best)throw new HttpError(422,'triage_context_too_large','Business context leaves no room for this message section.');
    chunks.push(best);point=bestPoint;
  }
  return {version:1 as const,total:text.length,chunks,analysisCredits:chunks.filter(c=>c.request!==null).length,
    aggregationCreditsIncluded:false as const,extractionOmissions:source.projection.omissions};
}

/** Section evidence is converted back to absolute offsets in the original
 * extracted message. This result is partial, not a whole-message conclusion. */
export function parseMailTriageChunk(raw:string,chunk:Chunk){
  if(!chunk.request||chunk.source.coverage?.start!==chunk.start||chunk.source.coverage.end!==chunk.end)
    throw new HttpError(409,'triage_section_mismatch','This analysis section does not match its source.');
  const result=parseMailTriage(raw,chunk.source);
  return {...result,evidence:result.evidence.map(item=>({...item,start:item.start+chunk.start,end:item.end+chunk.start})),
    partial:true as const,sectionIndex:chunk.index};
}
