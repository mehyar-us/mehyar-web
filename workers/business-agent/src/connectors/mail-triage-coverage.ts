import {z} from 'zod';
import {HttpError} from '../http';
import {sourceSchema,type MailTriageSource} from './mail-triage';
import {planMailTriageChunks,parseMailTriageChunk} from './mail-triage-chunks';

const sectionResult=z.object({version:z.literal(1),source:z.record(z.string(),z.unknown()),category:z.string(),priority:z.string(),summary:z.string(),
  evidence:z.array(z.object({excerpt:z.string(),start:z.number().int().nonnegative(),end:z.number().int().nonnegative()}).strict()).min(1).max(5),
  basis:z.literal('model_suggestion'),requiresReview:z.literal(true),extractionOmissions:z.array(z.string()),historicalContext:z.boolean(),authorizesActions:z.literal(false),
  partial:z.literal(true),sectionIndex:z.number().int().min(0).max(31),sectionCount:z.number().int().min(1).max(32)}).strict();
const mismatch=()=>new HttpError(409,'triage_coverage_incomplete','The message sections are incomplete or no longer match this observation.');

/** Validate every persisted section against a newly derived plan and the current
 * observation/context. This proves coverage of extracted text, not semantic
 * accuracy, omitted attachments, or permission to send a reply. No model calls. */
export function validateMailTriageCoverage(input:MailTriageSource,values:unknown[]){
  const source=sourceSchema.parse(input),plan=planMailTriageChunks(source);
  if(!Array.isArray(values)||values.length!==plan.analysisCredits)throw mismatch();
  const results=new Map<number,ReturnType<typeof parseMailTriageChunk>>();
  for(const value of values){
    const parsed=sectionResult.safeParse(value);if(!parsed.success)throw mismatch();
    const stored=parsed.data,chunk=plan.chunks[stored.sectionIndex];
    if(!chunk?.request||stored.sectionCount!==plan.chunks.length||results.has(stored.sectionIndex)||Object.hasOwn(stored.source,'projection'))throw mismatch();
    const claimed=sourceSchema.safeParse({...stored.source,projection:chunk.source.projection});
    if(!claimed.success||JSON.stringify(claimed.data)!==JSON.stringify(sourceSchema.parse(chunk.source)))throw mismatch();
    let canonical:ReturnType<typeof parseMailTriageChunk>;
    try{canonical=parseMailTriageChunk(JSON.stringify({category:stored.category,priority:stored.priority,summary:stored.summary,evidence:stored.evidence.map(e=>({excerpt:e.excerpt}))}),chunk);}
    catch{throw mismatch();}
    if(JSON.stringify(stored.evidence)!==JSON.stringify(canonical.evidence)||stored.historicalContext!==canonical.historicalContext
      ||JSON.stringify(stored.extractionOmissions)!==JSON.stringify(canonical.extractionOmissions))throw mismatch();
    results.set(stored.sectionIndex,canonical);
  }
  for(const chunk of plan.chunks)if(chunk.request&&!results.has(chunk.index))throw mismatch();
  return {version:1 as const,extractedTextCoverageComplete:true as const,sectionCount:plan.chunks.length,
    sections:plan.chunks.filter(c=>c.request!==null).map(c=>results.get(c.index)!),
    whitespaceSections:plan.chunks.filter(c=>c.request===null).map(c=>({index:c.index,start:c.start,end:c.end})),
    extractionOmissions:source.projection.omissions,wholeMessageConclusionAvailable:false as const,authorizesActions:false as const};
}
